# ProxySQL Best Practices, Pitfalls & Operations

## Best Practices

### 1. Always Save Config to Disk

ProxySQL has three config layers: memory → runtime → disk.

```
MEMORY (edited via SQL) → RUNTIME (active) → DISK (persisted)
```

**Trap:** If you only `LOAD TO RUNTIME` and not `SAVE TO DISK`, a restart wipes your config.

```sql
-- After ANY change, always do both:
LOAD MYSQL SERVERS TO RUNTIME;    SAVE MYSQL SERVERS TO DISK;
LOAD MYSQL USERS TO RUNTIME;      SAVE MYSQL USERS TO DISK;
LOAD MYSQL QUERY RULES TO RUNTIME; SAVE MYSQL QUERY RULES TO DISK;
LOAD MYSQL VARIABLES TO RUNTIME;  SAVE MYSQL VARIABLES TO DISK;
```

### 2. Use Separate Monitoring User

```sql
-- Create a dedicated monitoring user on MySQL (minimal privileges)
-- On MySQL primary:
CREATE USER 'proxysql_monitor'@'%' IDENTIFIED BY 'strong_password';
GRANT REPLICATION CLIENT ON *.* TO 'proxysql_monitor'@'%';
-- (REPLICATION CLIENT needed for SHOW SLAVE STATUS)

-- Configure in ProxySQL
UPDATE global_variables SET variable_value = 'proxysql_monitor' 
WHERE variable_name = 'mysql-monitor_username';

UPDATE global_variables SET variable_value = 'strong_password' 
WHERE variable_name = 'mysql-monitor_password';
```

### 3. Tune Health Check Intervals

```sql
-- Monitor interval (ms) — how often ProxySQL checks backend health
UPDATE global_variables SET variable_value = '2000' 
WHERE variable_name = 'mysql-monitor_connect_interval';

UPDATE global_variables SET variable_value = '2000' 
WHERE variable_name = 'mysql-monitor_ping_interval';

-- Replication lag check interval
UPDATE global_variables SET variable_value = '1000' 
WHERE variable_name = 'mysql-monitor_replication_lag_interval';

-- How many consecutive failures before shunning
UPDATE global_variables SET variable_value = '3' 
WHERE variable_name = 'mysql-monitor_max_failures';
```

### 4. Set Sensible Timeouts

```sql
-- Frontend (app → ProxySQL) timeouts
UPDATE global_variables SET variable_value = '3600000'   -- 1 hour
WHERE variable_name = 'mysql-wait_timeout';

-- Backend (ProxySQL → MySQL) timeouts
UPDATE global_variables SET variable_value = '10000'     -- 10 seconds
WHERE variable_name = 'mysql-connect_timeout_server';

UPDATE global_variables SET variable_value = '3600000'   -- 1 hour
WHERE variable_name = 'mysql-connection_timeout_server_max';

-- Kill long-running queries
UPDATE global_variables SET variable_value = '60000'    -- 60 seconds
WHERE variable_name = 'mysql-default_query_timeout';
```

### 5. Use Hostgroup 0 as Fallback

Never delete hostgroup 0 configuration. It acts as a catch-all for connections not matched by rules.

```sql
-- Keep a server in HG 0 as safety net
INSERT INTO mysql_servers(hostgroup_id, hostname, port)
VALUES (0, 'mysql-primary', 3306);
```

### 6. Version Your Query Rules

Add comments to rules so you know why they exist:

```sql
INSERT INTO mysql_query_rules(
    rule_id, active, match_pattern, destination_hostgroup, apply, comment
) VALUES (
    1, 1, '^SELECT.*FOR UPDATE', 10, 1,
    'Locking reads must go to primary - JIRA-1234'
);
```

### 7. Test Rules with `PROXYSQL SIMULATE QUERY`

```sql
-- Before deploying a rule, check what it would match:
SELECT rule_id, match_pattern, destination_hostgroup
FROM mysql_query_rules 
WHERE active = 1
ORDER BY rule_id;

-- Check rule hit counts after enabling:
SELECT rule_id, hits FROM stats_mysql_query_rules ORDER BY rule_id;
```

---

## Common Pitfalls

### Pitfall 1: Read Your Own Writes

**Symptom:** App writes data, immediately reads it, gets stale data.

```
App: UPDATE orders SET status='shipped' WHERE id=1  → primary
App: SELECT status FROM orders WHERE id=1           → replica (lagging!)
App sees: status='pending' ← WRONG
```

**Fix options:**

```sql
-- Option A: Route writes and immediate reads to primary using hints
-- In app code:
conn.prepareStatement("/* PRIMARY */ SELECT status FROM orders WHERE id=?")

-- Query rule to honor the hint:
INSERT INTO mysql_query_rules(rule_id, active, match_pattern, destination_hostgroup, apply)
VALUES (1, 1, '/\*.*PRIMARY.*\*/', 10, 1);

-- Option B: Use transaction (stays on primary)
BEGIN;
UPDATE orders SET status='shipped' WHERE id=1;
SELECT status FROM orders WHERE id=1;  -- same connection, same server
COMMIT;

-- Option C: Set max replication lag limit (shun lagging replicas)
UPDATE mysql_servers SET max_replication_lag = 2  -- shun if >2s behind
WHERE hostgroup_id = 20;
```

### Pitfall 2: Forgetting Regex Anchors

```sql
-- WRONG: matches any query containing "SELECT" anywhere
match_pattern = 'SELECT'

-- This also matches:
-- UPDATE /* SELECT comment */ orders ...  ← goes to replica accidentally!
-- INSERT INTO select_cache ...            ← goes to replica!

-- RIGHT: anchor at start
match_pattern = '^SELECT'

-- Even better: case-insensitive anchor
match_pattern = '^(?i)SELECT'
-- Or use match_digest which is already normalized to uppercase
match_digest = '^SELECT'
```

### Pitfall 3: Not Handling Transactions on Replicas

```sql
-- If a rule sends UPDATE to a replica: MySQL error: "The MySQL server is running 
-- with the --read-only option so it cannot execute this statement"

-- Fix: ensure writes always go to primary
-- Default_hostgroup for app user = 10 (primary)
-- Only override for explicit SELECT statements
```

### Pitfall 4: ProxySQL as SPOF

ProxySQL itself can become a single point of failure.

```
App → ProxySQL → MySQL   ← if ProxySQL dies, everything dies
```

**Fix: Run multiple ProxySQL instances**

```
               ┌──── ProxySQL-1 ────┐
App servers ───┤                    ├─── MySQL Primary
               └──── ProxySQL-2 ────┘    MySQL Replica
                         ↑
                  Keepalived VIP (192.168.1.100)
                  Active/passive failover
```

```bash
# Keepalived config (one per ProxySQL host)
vrrp_instance VI_1 {
    state MASTER       # or BACKUP on second ProxySQL
    interface eth0
    virtual_router_id 51
    priority 101       # higher = preferred; BACKUP uses 100
    virtual_ipaddress {
        192.168.1.100  # VIP that apps connect to
    }
    track_script {
        chk_proxysql
    }
}

vrrp_script chk_proxysql {
    script "mysql -u admin -padmin -h 127.0.0.1 -P 6032 -e 'select 1' > /dev/null 2>&1"
    interval 2
    fall 3
    rise 2
}
```

**Alternative: DNS round-robin between ProxySQL instances**

### Pitfall 5: Application Pool + ProxySQL Pool = Double Pooling

```
App (HikariCP, 50 connections) → ProxySQL → MySQL

Problem: HikariCP opens 50 connections to ProxySQL
ProxySQL opens 50 connections to MySQL per app server
With 20 app servers: 20 × 50 = 1000 MySQL connections

You didn't reduce connections at all!
```

**Fix:** Reduce HikariCP pool size when using ProxySQL

```yaml
# application.yml - reduced because ProxySQL handles pooling
spring:
  datasource:
    hikari:
      maximum-pool-size: 5  # instead of 50, ProxySQL handles the rest
      minimum-idle: 2
```

### Pitfall 6: Wrong MySQL Version Declared

```sql
-- ProxySQL needs to know MySQL version for protocol compatibility
UPDATE global_variables 
SET variable_value = '8.0.28'  -- match your actual MySQL version
WHERE variable_name = 'mysql-server_version';

-- Wrong version can cause authentication failures or protocol errors
```

### Pitfall 7: Not Whitelisting ProxySQL IP on MySQL

```sql
-- MySQL users must allow connections from ProxySQL's IP
-- On MySQL:
CREATE USER 'appuser'@'10.0.1.100' IDENTIFIED BY 'password';  -- ProxySQL IP
GRANT SELECT, INSERT, UPDATE, DELETE ON mydb.* TO 'appuser'@'10.0.1.100';

-- If using multiple ProxySQL nodes:
CREATE USER 'appuser'@'10.0.1.%' IDENTIFIED BY 'password';   -- subnet
```

### Pitfall 8: Prepared Statements Pin Connections

```sql
-- Prepared statements created and not closed pin the connection
-- until the statement is explicitly deallocated or connection closes

-- BAD:
PREPARE stmt FROM 'SELECT * FROM orders WHERE id = ?';
-- Connection is now "reserved" for this session

-- GOOD: Always deallocate when done
PREPARE stmt FROM 'SELECT * FROM orders WHERE id = ?';
EXECUTE stmt USING @order_id;
DEALLOCATE PREPARE stmt;
-- Connection can now be multiplexed
```

---

## Operations Playbook

### Adding a New Replica

```sql
-- 1. Add server in OFFLINE_SOFT state first (won't receive traffic yet)
INSERT INTO mysql_servers(hostgroup_id, hostname, port, status)
VALUES (20, 'mysql-replica-4', 3306, 'OFFLINE_SOFT');

LOAD MYSQL SERVERS TO RUNTIME;

-- 2. Wait for replication to catch up
-- Check on MySQL: SHOW SLAVE STATUS\G → Seconds_Behind_Master = 0

-- 3. Enable the server
UPDATE mysql_servers 
SET status = 'ONLINE' 
WHERE hostname = 'mysql-replica-4' AND hostgroup_id = 20;

LOAD MYSQL SERVERS TO RUNTIME;
SAVE MYSQL SERVERS TO DISK;

-- 4. Verify traffic is hitting new replica
SELECT hostname, ConnUsed, Queries 
FROM stats_mysql_connection_pool 
WHERE srv_host = 'mysql-replica-4';
```

### Gracefully Removing a Server

```sql
-- 1. Drain connections (existing queries finish, no new connections)
UPDATE mysql_servers 
SET status = 'OFFLINE_SOFT' 
WHERE hostname = 'mysql-replica-2';

LOAD MYSQL SERVERS TO RUNTIME;

-- 2. Wait for connections to drain
SELECT ConnUsed FROM stats_mysql_connection_pool 
WHERE srv_host = 'mysql-replica-2';
-- Wait until ConnUsed = 0

-- 3. Remove completely
DELETE FROM mysql_servers 
WHERE hostname = 'mysql-replica-2';

LOAD MYSQL SERVERS TO RUNTIME;
SAVE MYSQL SERVERS TO DISK;
```

### Primary Failover

```sql
-- New primary has been promoted. Update ProxySQL:

-- 1. Remove old primary from writer hostgroup
UPDATE mysql_servers 
SET status = 'OFFLINE_HARD'
WHERE hostname = 'old-primary' AND hostgroup_id = 10;

-- 2. Add new primary to writer hostgroup
INSERT INTO mysql_servers(hostgroup_id, hostname, port)
VALUES (10, 'new-primary', 3306);

-- 3. Move old primary to reader (if it recovers as replica)
UPDATE mysql_servers 
SET hostgroup_id = 20, status = 'OFFLINE_SOFT'
WHERE hostname = 'old-primary';

LOAD MYSQL SERVERS TO RUNTIME;
SAVE MYSQL SERVERS TO DISK;
```

---

## Monitoring & Alerting

### Key Queries for Dashboards

```sql
-- 1. Query rate and latency by hostgroup
SELECT 
    hostgroup,
    COUNT(*) as queries_per_sec,
    AVG(time_to_wait_ms) as avg_latency_ms,
    MAX(time_to_wait_ms) as max_latency_ms
FROM stats_mysql_processlist
GROUP BY hostgroup;

-- 2. Slow queries (> 1 second)
SELECT 
    digest_text,
    count_star,
    sum_time / count_star / 1000000 AS avg_seconds,
    sum_time / 1000000 AS total_seconds,
    hostgroup
FROM stats_mysql_query_digest
WHERE sum_time / count_star / 1000000 > 1
ORDER BY sum_time DESC
LIMIT 20;

-- 3. Top queries by volume
SELECT 
    digest_text,
    count_star,
    sum_time,
    hostgroup
FROM stats_mysql_query_digest
ORDER BY count_star DESC
LIMIT 20;

-- 4. Connection pool health
SELECT 
    hostgroup, srv_host, 
    ConnUsed, ConnFree, ConnERR,
    ROUND(ConnUsed * 100.0 / (ConnUsed + ConnFree), 1) AS utilization_pct
FROM stats_mysql_connection_pool
WHERE status = 'ONLINE';

-- 5. Error rates
SELECT 
    hostgroup, srv_host,
    ConnERR,
    Queries,
    ROUND(ConnERR * 100.0 / NULLIF(Queries, 0), 2) AS error_rate_pct
FROM stats_mysql_connection_pool;
```

### Alerts to Set Up

| Alert | Condition | Severity |
|---|---|---|
| Pool utilization high | `ConnUsed / (ConnUsed + ConnFree) > 80%` | Warning |
| Pool exhausted | `ConnFree = 0` | Critical |
| Backend errors | `ConnERR > 0` sustained | Warning |
| All replicas shunned | All HG 20 servers `OFFLINE` | Critical |
| Replication lag | `Seconds_Behind_Master > 10s` | Warning |
| Query latency | `avg_latency_ms > 1000` | Warning |
| ProxySQL process down | Health check fails | Critical |

---

## ProxySQL with Kotlin/Spring Boot

```kotlin
// application.yml — connect to ProxySQL, not MySQL directly
spring:
  datasource:
    url: jdbc:mysql://proxysql-host:6033/mydb?useSSL=false&allowPublicKeyRetrieval=true
    username: appuser
    password: secret
    hikari:
      maximum-pool-size: 10    # small pool — ProxySQL handles multiplexing
      minimum-idle: 2
      connection-timeout: 3000 # 3s — fail fast if ProxySQL is down
      validation-query: SELECT 1
      connection-test-query: SELECT 1

// Forcing a query to primary (for read-your-writes scenarios)
@Repository
class OrderRepository(private val jdbcTemplate: JdbcTemplate) {
    
    fun findById(id: Long): Order {
        return jdbcTemplate.queryForObject(
            "/* PRIMARY */ SELECT * FROM orders WHERE id = ?",
            OrderRowMapper(),
            id
        ) ?: throw NotFoundException("Order $id not found")
    }
    
    fun findByIdFromReplica(id: Long): Order {
        return jdbcTemplate.queryForObject(
            "SELECT * FROM orders WHERE id = ?",  // goes to replica via query rule
            OrderRowMapper(),
            id
        ) ?: throw NotFoundException("Order $id not found")
    }
}
```

---

## ProxySQL vs Alternatives

| | ProxySQL | PgBouncer | Vitess | AWS RDS Proxy |
|---|---|---|---|---|
| Database | MySQL | PostgreSQL | MySQL | MySQL/PostgreSQL |
| Read/write split | Yes | No | Yes | Yes |
| Connection multiplex | Yes | Yes | Yes | Yes |
| Query routing | Powerful (regex) | No | Powerful | Basic |
| Query rewrite | Yes | No | Yes | No |
| Open source | Yes | Yes | Yes | No |
| Hosted option | No | No | No | Yes (AWS) |
| Ops complexity | Medium | Low | High | Low |
| Best for | MySQL at scale | Postgres pool | Sharded MySQL | AWS-native |


---

## Related

[[03 - Query Routing]]  [[05 - Scaling and Load Balancing]]
