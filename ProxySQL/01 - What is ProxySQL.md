# What is ProxySQL

## The Problem it Solves

Without a proxy, your application connects directly to MySQL:

```
App Server 1 ──────────────────── MySQL Primary (writes)
App Server 2 ──────────────────── MySQL Primary (writes)
App Server 3 ──────────────────── MySQL Primary (writes)

Problems:
- Every write goes to primary (no read scaling)
- App must know which server is primary (failover is manual)
- Connection overhead: 500 app servers × 10 pool connections = 5000 MySQL connections
- No query visibility, no routing intelligence
```

With ProxySQL:

```
App Server 1 ─┐
App Server 2 ─┤── ProxySQL ──── MySQL Primary  (writes)
App Server 3 ─┘           └──── MySQL Replica 1 (reads)
                          └──── MySQL Replica 2 (reads)

Benefits:
- Read/write splitting transparently
- App always connects to ProxySQL (proxy handles failover)
- Connection multiplexing (5000 app connections → 50 MySQL connections)
- Query routing, rewriting, caching
- Full query statistics and monitoring
```

## What ProxySQL Is

ProxySQL is a **high-performance MySQL proxy** that sits between your application and MySQL servers. It:

- Speaks the **MySQL protocol** on both sides (apps think it IS MySQL)
- Runs as a daemon on port `6033` (admin on `6032`)
- Stores all config in **SQLite** internally — configured via SQL queries
- Handles **millions of queries per second** with microsecond overhead (~0.5ms added latency)
- Written in C++ for maximum performance

**Not just MySQL:** ProxySQL also supports Percona XtraDB Cluster, Galera Cluster, MySQL Group Replication, and Amazon Aurora.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────-┐
│                          ProxySQL                                │
│                                                                  │
│   ┌──────────────┐     ┌──────────────┐     ┌───────────────┐    │
│   │ Client-Facing│     │   Query      │     │  Backend      │    │
│   │ Listener     │────▶│   Processor  │────▶│  Connection   │    │
│   │ Port: 6033   │     │              │     │  Pool         │    │
│   └──────────────┘     │ - Auth       │     │               │    │
│                        │ - Parse SQL  │     │  HG 10: Write │    │
│   ┌──────────────┐     │ - Match rules│     │  HG 20: Read  │    │
│   │ Admin        │     │ - Route      │     └───────────────┘    │
│   │ Interface    │     │ - Multiplex  │                          │
│   │ Port: 6032   │     └──────────────┘                          │
│   └──────────────┘                                               │
│                        ┌──────────────┐                          │
│                        │ SQLite Config│                          │
│                        │ DB           │                          │
│                        └──────────────┘                          │
└─────────────────────────────────────────────────────────────────-┘
```

### Key Internal Tables (configured via SQL)

```sql
-- Backend MySQL servers
mysql_servers

-- User credentials and default routing
mysql_users

-- Query routing rules
mysql_query_rules

-- Replication lag monitoring
mysql_replication_hostgroups

-- Global settings
global_variables
```

---

## How ProxySQL Intercepts Queries

1. App connects to ProxySQL on port 6033 (looks like MySQL)
2. ProxySQL authenticates using `mysql_users` table
3. App sends `SELECT * FROM orders WHERE user_id = 123`
4. ProxySQL parses the SQL
5. Matches against `mysql_query_rules` (first matching rule wins)
6. Routes to appropriate hostgroup (e.g., reads → HG20, writes → HG10)
7. Gets a connection from the backend pool for that hostgroup
8. Forwards query to MySQL, gets result
9. Returns result to app
10. Returns connection to pool

**The app has no idea any of this happened.** It just gets a result.

---

## ProxySQL vs PgBouncer vs Nginx

| Feature | ProxySQL (MySQL) | PgBouncer (PostgreSQL) | Nginx (HTTP) |
|---|---|---|---|
| Protocol | MySQL | PostgreSQL | HTTP |
| Query routing | Yes (SQL rules) | No | Yes (URL paths) |
| Read/write split | Yes | No (needs Pgpool) | N/A |
| Connection multiplex | Yes | Yes | Yes (keepalive) |
| Query rewrite | Yes | No | Yes (rewrite module) |
| Query cache | Yes (basic) | No | Yes |
| Admin interface | SQL on port 6032 | Config file | Config file |
| Failover detection | Yes (built-in) | No | With upstream checks |

---

## Installation

```bash
# Ubuntu/Debian
apt-get install -y proxysql

# CentOS/RHEL
yum install proxysql

# Docker
docker run -d \
  --name proxysql \
  -p 6033:6033 \
  -p 6032:6032 \
  -v /etc/proxysql.cnf:/etc/proxysql.cnf \
  proxysql/proxysql:2.6.3

# Start/stop
systemctl start proxysql
systemctl enable proxysql

# Connect to admin interface
mysql -u admin -padmin -h 127.0.0.1 -P 6032
```

---

## Minimum Working Config

```bash
# /etc/proxysql.cnf — minimal config to get started
datadir="/var/lib/proxysql"
admin_variables=
{
    admin_credentials="admin:admin"   # change in production!
    mysql_ifaces="0.0.0.0:6032"
}
mysql_variables=
{
    interfaces="0.0.0.0:6033"
    default_query_delay=0
    default_query_timeout=36000000
    max_connections=2048
}
```

After starting, configure everything via SQL on port 6032:

```sql
-- Add backend servers
INSERT INTO mysql_servers(hostgroup_id, hostname, port) 
VALUES (10, 'mysql-primary', 3306);

INSERT INTO mysql_servers(hostgroup_id, hostname, port) 
VALUES (20, 'mysql-replica-1', 3306);

-- Add app user
INSERT INTO mysql_users(username, password, default_hostgroup) 
VALUES ('appuser', 'password', 10);

-- Add read/write split rule
INSERT INTO mysql_query_rules(rule_id, active, match_pattern, destination_hostgroup, apply)
VALUES (1, 1, '^SELECT', 20, 1);

-- Apply all changes
LOAD MYSQL SERVERS TO RUNTIME;
LOAD MYSQL USERS TO RUNTIME;
LOAD MYSQL QUERY RULES TO RUNTIME;

-- Persist to disk (survive restarts)
SAVE MYSQL SERVERS TO DISK;
SAVE MYSQL USERS TO DISK;
SAVE MYSQL QUERY RULES TO DISK;
```


---

## Related

[[02 - Connection Pooling]]
