# ProxySQL Connection Pooling

## The Multiplexing Problem

Without ProxySQL, every app connection = one MySQL connection:

```
100 app servers × 50 pool connections each = 5,000 MySQL connections
MySQL max_connections = 1000 → CRASH
```

MySQL connections are expensive:
- Each holds ~1MB RAM on the MySQL server
- Thread creation + authentication overhead
- MySQL's thread scheduler degrades with many threads

ProxySQL solves this with **connection multiplexing** — many app connections share a small pool of MySQL connections.

```
5,000 app connections → ProxySQL → 50 MySQL connections
```

---

## Three Pooling Modes

### 1. Connection Multiplexing (Default — `connection_pool_type=0`)

The most aggressive mode. ProxySQL reuses MySQL connections across different app sessions.

```
App connection A sends query → gets MySQL conn #3 → query executes → conn #3 returns to pool
App connection B sends query → gets MySQL conn #3 → query executes → conn #3 returns to pool
```

**How it works:** When a query finishes, ProxySQL checks if the connection is "clean" (no open transactions, no session state). If clean, it returns to the pool for another app to use.

**Limitation:** MySQL connections carry session state. ProxySQL must reset state between uses:
- `SET NAMES utf8` → must be replayed
- `SET SESSION var = value` → must be replayed
- Open transactions → connection cannot be multiplexed until committed/rolled back
- Prepared statements → connection is "reserved" until deallocated

**When multiplexing is disabled (connection is pinned):**
- Active transaction (`BEGIN` ... not yet `COMMIT/ROLLBACK`)
- `LOCK TABLES`
- `GET_LOCK()`
- User variables (`@var = value`)
- Temporary tables
- `SQL_CALC_FOUND_ROWS`

### 2. Connection Pool (No Multiplexing — `connection_pool_type=1`)

Each app connection gets a dedicated MySQL backend connection for its lifetime. No sharing.

Simpler but less efficient. Like traditional connection pooling (HikariCP behavior).

### 3. Transaction-Level Multiplexing

Default in newer versions. Connection released back to pool after each transaction (not each query). Better compatibility than query-level multiplexing.

---

## Configuring the Connection Pool

```sql
-- Global pool settings
UPDATE global_variables SET variable_value = '200' 
WHERE variable_name = 'mysql-max_connections';
-- Max connections from APPS to ProxySQL (frontend)

UPDATE global_variables SET variable_value = '50' 
WHERE variable_name = 'mysql-connection_max_age_ms';
-- Recycle backend connections older than 50ms (prevent stale conn)

UPDATE global_variables SET variable_value = '10000'
WHERE variable_name = 'mysql-connection_timeout';
-- Timeout for idle backend connections (ms)

LOAD MYSQL VARIABLES TO RUNTIME;
SAVE MYSQL VARIABLES TO DISK;
```

### Per-Hostgroup Pool Size

```sql
-- max_connections per server limits how many MySQL connections ProxySQL opens
-- to that specific backend
UPDATE mysql_servers 
SET max_connections = 100
WHERE hostname = 'mysql-primary' AND hostgroup_id = 10;

UPDATE mysql_servers 
SET max_connections = 200  -- replicas can handle more reads
WHERE hostname = 'mysql-replica-1' AND hostgroup_id = 20;

LOAD MYSQL SERVERS TO RUNTIME;
SAVE MYSQL SERVERS TO DISK;
```

### Connection Pool Sizing Formula

```
backend_connections_per_server = 
    (queries_per_second × avg_query_duration_ms) / 1000

Example:
  QPS = 5000
  avg_query = 10ms
  needed = 5000 × 0.01 = 50 connections

Add 20% headroom: max_connections = 60
```

---

## Session State Tracking

ProxySQL tracks session state to know when it can multiplex a connection.

### Multiplexing-Safe Behaviors

```sql
-- These are tracked and replayed when connection is reused:
SET NAMES utf8mb4;                -- charset (replayed automatically)
SET character_set_client = utf8;  -- tracked
SET time_zone = '+05:30';         -- tracked
```

### Multiplexing-Unsafe Behaviors (Connection Gets Pinned)

```sql
-- 1. User variables
SET @user_id = 123;  -- connection pinned until reset

-- 2. Temporary tables
CREATE TEMPORARY TABLE tmp_orders (...);  -- pinned until dropped/disconnected

-- 3. Open transactions
BEGIN;
UPDATE orders SET status = 'shipped' WHERE id = 1;
-- connection is pinned until COMMIT or ROLLBACK

-- 4. Table locks
LOCK TABLES orders WRITE;  -- pinned until UNLOCK TABLES

-- 5. LAST_INSERT_ID()
INSERT INTO orders (...);
SELECT LAST_INSERT_ID();  -- pinned because state is connection-specific

-- 6. SQL_CALC_FOUND_ROWS
SELECT SQL_CALC_FOUND_ROWS * FROM orders LIMIT 10;
SELECT FOUND_ROWS();  -- must stay on same connection
```

### Detecting Pinned Connections

```sql
-- Check connection pool status
SELECT * FROM stats_mysql_connection_pool;

-- If free_connections is 0 and used > max_connections → pool exhausted
-- Pinned connections show up as "used" connections that don't return to pool
```

---

## Connection Lifecycle

```
App connects to ProxySQL (port 6033)
    ↓
ProxySQL authenticates from mysql_users table
    ↓
App sends query
    ↓
ProxySQL checks: is there a free backend connection in the pool?
    YES → reuse it (reset session state if needed)
    NO → open new connection to MySQL backend
    ↓
Query executes on MySQL
    ↓
Result returned to app
    ↓
Is connection multiplex-safe?
    YES → return to pool (available for next query from any app)
    NO → keep for this app session (pinned)
    ↓
App disconnects
    → pinned connections returned to pool (or closed if max_connections reached)
    → session state cleared (SET NAMES reset, variables cleared)
```

---

## Connection Pool Monitoring

```sql
-- Real-time connection pool stats
SELECT 
    hostgroup,
    srv_host,
    status,
    ConnUsed,       -- connections currently executing queries
    ConnFree,       -- idle connections in pool
    ConnOK,         -- successfully opened connections
    ConnERR,        -- failed connection attempts
    MaxConnUsed,    -- peak concurrent connections
    Queries,        -- total queries served
    Bytes_data_sent,
    Bytes_data_recv
FROM stats_mysql_connection_pool;

-- Example output:
-- hostgroup | srv_host      | ConnUsed | ConnFree | ConnOK
-- 10        | mysql-primary | 12       | 8        | 1500
-- 20        | mysql-replica | 5        | 45       | 8000

-- Per-second stats
SELECT * FROM stats_mysql_connection_pool_reset;
-- (resets counters after reading)
```

### Key Metrics to Watch

| Metric | Concern if... |
|---|---|
| `ConnUsed / (ConnUsed + ConnFree)` | > 80% → pool near exhaustion |
| `ConnERR` | > 0 sustained → backend connectivity issue |
| `Latency_us` | > 10,000 → backend is slow |
| `ConnFree = 0` | Pool exhausted — queries queuing |

---

## Practical: Testing Connection Multiplexing

```sql
-- From the admin port, verify multiplexing is working:

-- Before: run 100 concurrent queries from 100 app connections
-- After: check if MySQL saw 100 or just a few connections

-- On MySQL primary:
SHOW STATUS LIKE 'Threads_connected';  -- should be much less than app connections

-- In ProxySQL stats:
SELECT hostgroup, srv_host, ConnUsed, ConnFree 
FROM stats_mysql_connection_pool;
```

---

## Connection Pool Anti-Patterns

### App Opening Too Many Connections to ProxySQL

```
Problem: 500 app servers × 100 connections = 50,000 connections to ProxySQL
ProxySQL can handle it but wastes memory

Fix: Reduce app-side pool size when ProxySQL is in the middle
# HikariCP config: if you have ProxySQL, you don't need large app pools
maximum-pool-size: 10  # instead of 50
# ProxySQL handles the heavy lifting
```

### Not Committing Transactions Promptly

```sql
-- BAD: Long-running transactions pin connections
BEGIN;
-- App does some computation for 30 seconds...
-- Connection is pinned for 30 seconds during computation!
UPDATE orders SET status = 'shipped' WHERE id = 1;
COMMIT;

-- GOOD: Keep transactions short
-- Do computation before BEGIN
UPDATE orders SET status = 'shipped' WHERE id = 1;  -- auto-committed
```

### Using User Variables for State

```sql
-- BAD: Pins connection
SET @current_user = 123;
SELECT * FROM orders WHERE user_id = @current_user;

-- GOOD: Pass value directly
SELECT * FROM orders WHERE user_id = 123;
```


---

## Related

[[01 - What is ProxySQL]]  [[03 - Query Routing]]
