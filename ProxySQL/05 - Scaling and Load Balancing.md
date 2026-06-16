# Scaling ProxySQL

## ProxySQL's Own Limits

Before scaling out, understand what a single ProxySQL instance can handle:

| Resource | Limit | Notes |
|---|---|---|
| Frontend connections | ~100,000 | Per instance, configurable |
| Backend connections | ~65,536 | Per instance |
| Queries/sec | ~500,000–1,000,000 | Depends on query complexity |
| CPU | Single-threaded query processing | Multiple threads for I/O |
| Memory | ~2–4GB typical | Scales with connections + cache |
| Added latency | ~0.1–0.5ms | Per-query overhead |

**One ProxySQL instance handles most production workloads.** Scale out only when you hit these limits or need HA.

---

## Why Scale ProxySQL

1. **High Availability** — single ProxySQL = SPOF
2. **Throughput** — >1M QPS needs multiple instances
3. **Geographic distribution** — one proxy per region/datacenter
4. **Isolation** — separate proxy per service or tier

---

## Architecture Patterns

### Pattern 1: Active/Passive (HA, No Scale)

The simplest HA setup. Two ProxySQL instances share a Virtual IP (VIP). If the active one fails, the VIP moves to the passive.

```
                 VIP: 10.0.1.100 (Keepalived)
                        │
        ┌───────────────┴───────────────┐
        │                               │
  ProxySQL-1 (ACTIVE)           ProxySQL-2 (PASSIVE)
  10.0.1.101                    10.0.1.102
        │
        ├── MySQL Primary (HG 10)
        └── MySQL Replica 1,2 (HG 20)
```

**Failover time:** 2–5 seconds (Keepalived detection + VIP switchover)

**Config (Keepalived on ProxySQL-1):**
```bash
# /etc/keepalived/keepalived.conf on ProxySQL-1
global_defs {
    router_id PROXYSQL_HA
}

vrrp_script chk_proxysql {
    script "/usr/bin/mysql -u admin -padmin -h 127.0.0.1 -P 6032 -e 'select 1' 2>/dev/null"
    interval 2      # check every 2 seconds
    fall    3        # 3 failures = DOWN
    rise    2        # 2 successes = UP
    timeout 1
}

vrrp_instance VI_1 {
    state MASTER        # BACKUP on ProxySQL-2
    interface eth0
    virtual_router_id 51
    priority 101        # 100 on ProxySQL-2 (lower = backup)
    advert_int 1

    authentication {
        auth_type PASS
        auth_pass proxysql_secret
    }

    virtual_ipaddress {
        10.0.1.100/24   # VIP — apps connect here
    }

    track_script {
        chk_proxysql
    }

    # When this instance becomes MASTER
    notify_master "/etc/keepalived/notify.sh MASTER"
    # When this instance becomes BACKUP
    notify_backup "/etc/keepalived/notify.sh BACKUP"
}
```

```bash
# /etc/keepalived/notify.sh
#!/bin/bash
STATE=$1
logger "Keepalived: ProxySQL transitioning to $STATE"

if [ "$STATE" = "MASTER" ]; then
    # Optional: reload ProxySQL config, send alert
    mysql -u admin -padmin -h 127.0.0.1 -P 6032 -e "PROXYSQL RELOAD TLS"
fi
```

**Apps connect to VIP:**
```yaml
spring:
  datasource:
    url: jdbc:mysql://10.0.1.100:6033/mydb  # VIP, not individual ProxySQL IPs
```

---

### Pattern 2: Active/Active with DNS Round-Robin

Multiple active ProxySQL instances, DNS rotates between them.

```
DNS: proxy.internal → [10.0.1.101, 10.0.1.102, 10.0.1.103]
                              │              │              │
                         ProxySQL-1     ProxySQL-2     ProxySQL-3
                              │              │              │
                         ─────┴──────────────┴──────────────┴─────
                              │
                         MySQL Primary + Replicas
```

**DNS TTL:** 10–30 seconds (low enough for fast failover detection)

**Limitation:** DNS client caching means failover isn't instant. Apps may keep trying a failed ProxySQL for up to TTL seconds.

**AWS Route 53 with health checks:**
```
Route 53 health check: TCP port 6033 on each ProxySQL
If health check fails → remove from DNS response
```

---

### Pattern 3: Load Balancer in Front of ProxySQL (Recommended at Scale)

Put an L4 load balancer in front of multiple ProxySQL instances.

```
Apps → L4 Load Balancer (NLB / HAProxy) → ProxySQL Pool → MySQL
         10.0.1.100:6033                    10.0.1.101:6033
                                            10.0.1.102:6033
                                            10.0.1.103:6033
```

**Why L4, not L7?** ProxySQL speaks MySQL protocol, not HTTP. L4 routes TCP connections without inspecting content.

**HAProxy in front of ProxySQL:**
```
# /etc/haproxy/haproxy.cfg

global
    maxconn 100000
    log /dev/log local0

defaults
    mode tcp              # L4 — pass-through, no HTTP inspection
    timeout connect 3s
    timeout client  30s
    timeout server  30s
    option tcp-check

frontend proxysql_frontend
    bind *:6033
    default_backend proxysql_backend

backend proxysql_backend
    balance leastconn     # least connections — important for MySQL!
    option tcp-check
    tcp-check connect
    tcp-check send-binary 00000001  # MySQL greeting check
    
    server proxysql-1 10.0.1.101:6033 check inter 2s fall 3 rise 2 weight 100
    server proxysql-2 10.0.1.102:6033 check inter 2s fall 3 rise 2 weight 100
    server proxysql-3 10.0.1.103:6033 check inter 2s fall 3 rise 2 weight 100

# Admin interface load balancing (optional)
frontend proxysql_admin_frontend
    bind *:6032
    default_backend proxysql_admin_backend

backend proxysql_admin_backend
    balance roundrobin
    server proxysql-1 10.0.1.101:6032 check
    server proxysql-2 10.0.1.102:6032 check
```

**AWS NLB in front of ProxySQL:**
```
Target group: proxysql-tg
  - Protocol: TCP
  - Port: 6033
  - Health check: TCP on port 6033
  - Targets: EC2 instances running ProxySQL

NLB listener:
  - Port: 6033
  - Protocol: TCP
  - Forward to: proxysql-tg
```

---

### Pattern 4: Sidecar ProxySQL (Per-App-Server)

Run ProxySQL on the same host as each application server.

```
App Server 1                App Server 2
┌────────────────────┐      ┌────────────────────┐
│  App Process       │      │  App Process       │
│  ↓ localhost:6033  │      │  ↓ localhost:6033  │
│  ProxySQL          │      │  ProxySQL          │
│  ↓                 │      │  ↓                 │
└────────────────────┘      └────────────────────┘
           │                          │
           └────────── MySQL ─────────┘
```

**Pros:**
- No network hop to ProxySQL (localhost = ~0.1ms instead of ~0.5ms)
- Each app server has its own pool (no ProxySQL bottleneck)
- App connects to `127.0.0.1:6033` — simple config

**Cons:**
- Must deploy and manage ProxySQL on every app server
- Config changes must be pushed to all instances (use Ansible/Puppet/Terraform)
- More ProxySQL processes = more MySQL connections total

**When to use:** Kubernetes (ProxySQL as sidecar container), high-performance apps where 0.5ms matters.

**Kubernetes sidecar:**
```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: order-service
spec:
  template:
    spec:
      containers:
      - name: order-service
        image: order-service:latest
        env:
        - name: DB_HOST
          value: "127.0.0.1"        # connect to sidecar
        - name: DB_PORT
          value: "6033"

      - name: proxysql
        image: proxysql/proxysql:2.6.3
        ports:
        - containerPort: 6033
        - containerPort: 6032
        volumeMounts:
        - name: proxysql-config
          mountPath: /etc/proxysql.cnf
          subPath: proxysql.cnf

      volumes:
      - name: proxysql-config
        configMap:
          name: proxysql-config
```

---

### Pattern 5: ProxySQL Cluster (Native Clustering)

ProxySQL 2.x supports native clustering — multiple ProxySQL nodes sync config automatically.

```
ProxySQL-1 ─── proxysql_servers table ─── ProxySQL-2
     │                                          │
     │          Auto-sync every 1s              │
     │                                          │
     └──────────── ProxySQL-3 ─────────────────┘
```

**How it works:**
1. Each ProxySQL node knows about all other nodes via `proxysql_servers` table
2. Config changes on any node are automatically propagated to all others
3. Nodes use checksums to detect config divergence

```sql
-- Configure on each ProxySQL node:
INSERT INTO proxysql_servers(hostname, port, weight, comment)
VALUES 
    ('proxysql-1', 6032, 1, 'node 1'),
    ('proxysql-2', 6032, 1, 'node 2'),
    ('proxysql-3', 6032, 1, 'node 3');

LOAD PROXYSQL SERVERS TO RUNTIME;
SAVE PROXYSQL SERVERS TO DISK;

-- Configure cluster credentials
UPDATE global_variables 
SET variable_value = 'cluster_user' 
WHERE variable_name = 'admin-cluster_username';

UPDATE global_variables 
SET variable_value = 'cluster_pass' 
WHERE variable_name = 'admin-cluster_password';

-- Sync interval (ms)
UPDATE global_variables 
SET variable_value = '1000'
WHERE variable_name = 'cluster_check_interval_ms';

LOAD ADMIN VARIABLES TO RUNTIME;
SAVE ADMIN VARIABLES TO DISK;
```

**What gets synced:**
- `mysql_servers`
- `mysql_users`
- `mysql_query_rules`
- `mysql_variables` (selected ones)

**What doesn't sync:**
- `proxysql_servers` (managed separately per node)
- `scheduler` entries
- Monitoring config

---

## Capacity Planning

### How Many ProxySQL Instances Do You Need?

```
Required capacity = peak_QPS / single_instance_QPS × safety_factor

Example:
  Peak QPS = 200,000
  Single ProxySQL QPS = 500,000
  Safety factor = 2 (for redundancy)
  
  Required = 200,000 / 500,000 × 2 = 0.8 → 2 instances minimum
  (always run at least 2 for HA)
```

### Sizing a ProxySQL Instance

```
# CPU: ProxySQL is mostly CPU-bound for query parsing
# Recommend: 4-8 vCPUs per ProxySQL instance

# Memory estimate:
# - Base: ~500MB
# - Per frontend connection: ~10KB
# - Per backend connection: ~10KB
# - Query cache (if used): configurable
# 
# With 10,000 frontend + 500 backend connections:
# 500MB + (10,000 × 10KB) + (500 × 10KB) = ~605MB
# Round up: 2GB RAM per instance is comfortable

# Network: at 100,000 QPS with avg 1KB query+response = 100MB/s
# 1Gbps NIC handles ~125MB/s → sufficient
# At 500,000 QPS: need 10Gbps NIC
```

---

## Config Management at Scale

When running multiple ProxySQL instances, config drift is the enemy.

### Option 1: ProxySQL Cluster (Native)

As described above — changes propagate automatically.

### Option 2: Config as Code with Ansible

```yaml
# ansible/proxysql-config.yml
- name: Configure ProxySQL servers
  hosts: proxysql_nodes
  tasks:
    - name: Add MySQL servers
      community.proxysql.proxysql_backend_servers:
        login_user: admin
        login_password: admin
        login_host: 127.0.0.1
        login_port: 6032
        hostgroup_id: 10
        hostname: mysql-primary
        port: 3306
        state: present
        load_to_runtime: true
        save_to_disk: true

    - name: Add query rules
      community.proxysql.proxysql_query_rules:
        login_user: admin
        login_password: admin
        rule_id: 1
        active: 1
        match_pattern: '^SELECT.*FOR UPDATE'
        destination_hostgroup: 10
        apply: 1
        state: present
        load_to_runtime: true
        save_to_disk: true
```

### Option 3: Terraform

```hcl
# proxysql.tf
resource "proxysql_mysql_server" "primary" {
  hostgroup_id    = 10
  hostname        = "mysql-primary.internal"
  port            = 3306
  max_connections = 100
}

resource "proxysql_mysql_server" "replica_1" {
  hostgroup_id    = 20
  hostname        = "mysql-replica-1.internal"
  port            = 3306
  max_connections = 200
}

resource "proxysql_query_rule" "select_for_update" {
  rule_id               = 1
  active                = true
  match_pattern         = "^SELECT.*FOR UPDATE"
  destination_hostgroup = 10
  apply                 = true
}
```

---

## Health Checks and Monitoring at Scale

### ProxySQL Exporter (Prometheus)

```yaml
# docker-compose.yml
services:
  proxysql-exporter:
    image: percona/proxysql-exporter:latest
    environment:
      DATA_SOURCE_NAME: "admin:admin@tcp(proxysql:6032)/"
    ports:
      - "42004:42004"  # Prometheus scrape port

# prometheus.yml
scrape_configs:
  - job_name: 'proxysql'
    static_configs:
      - targets: 
          - 'proxysql-1:42004'
          - 'proxysql-2:42004'
          - 'proxysql-3:42004'
```

**Key Prometheus metrics:**
```
proxysql_mysql_connection_pool_conn_used        # used connections
proxysql_mysql_connection_pool_conn_free        # free connections
proxysql_mysql_connection_pool_queries_total    # query rate
proxysql_mysql_connection_pool_latency_us       # query latency
proxysql_mysql_status_active_transactions       # open transactions
```

### Grafana Dashboard Panels

```
Panel 1: QPS per hostgroup (rate over 1m)
Panel 2: Connection pool utilization % (ConnUsed / (ConnUsed + ConnFree))
Panel 3: Query latency p50/p95/p99
Panel 4: Active connections per ProxySQL instance
Panel 5: Backend server status (ONLINE/SHUNNED/OFFLINE)
Panel 6: Replication lag per replica
Panel 7: Cache hit rate (if query cache enabled)
Panel 8: Top 10 slowest queries (sum_time)
```

---

## Scaling the Full Stack

Here's how ProxySQL fits into the complete scaling picture:

```
Traffic: 1M req/sec

                    ┌─────── DNS Round Robin ────────┐
                    │                                 │
              ProxySQL-1                        ProxySQL-2
              (500K QPS)                        (500K QPS)
                    │                                 │
              ──────┴──────── MySQL Cluster ──────────┘
                    │
          ┌─────────┴──────────┐
          │                    │
    MySQL Primary         MySQL Replicas (3×)
    (all writes)          (all reads, LB by weight)
    
Config sync: ProxySQL Cluster (native)
Monitoring:  Prometheus + Grafana
Deployment:  Terraform + Ansible
Failover:    HAProxy health checks remove failed ProxySQL nodes
```

### Scaling Decision Tree

```
QPS < 100K and HA needed?
  → 2× ProxySQL + Keepalived VIP

QPS 100K-500K?
  → 2-3× ProxySQL + HAProxy/NLB in front

QPS > 500K?
  → 4+ ProxySQL + NLB + ProxySQL Cluster for config sync

Kubernetes?
  → Sidecar ProxySQL per pod, or shared ProxySQL Deployment (3+ replicas) 
    behind a ClusterIP Service

Multi-region?
  → One ProxySQL cluster per region, each pointing to regional MySQL
```

---

## Rollout Strategy for Config Changes

Changing query rules or server config on a production ProxySQL cluster requires care.

```
1. Test in staging (identical ProxySQL + MySQL setup)

2. Verify new rules with stats (enable rule, watch hits for 10 min):
   SELECT rule_id, hits FROM stats_mysql_query_rules WHERE rule_id = NEW_RULE;

3. Rolling update if using multiple ProxySQL instances:
   a. Update ProxySQL-1, monitor for 5 minutes
   b. Update ProxySQL-2, monitor for 5 minutes
   c. Update ProxySQL-3, monitor for 5 minutes
   
   (With ProxySQL Cluster, changes propagate automatically — 
    but verify each node with SHOW MYSQL QUERY RULES\G)

4. Rollback plan:
   mysql -u admin -padmin -h proxysql-1 -P 6032
   DELETE FROM mysql_query_rules WHERE rule_id = NEW_RULE;
   LOAD MYSQL QUERY RULES TO RUNTIME;
   SAVE MYSQL QUERY RULES TO DISK;
```
