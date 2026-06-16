# PostgreSQL Internals & Optimization

## Storage Architecture

### Heap Files

PostgreSQL stores table data in **heap files** — each row (tuple) stored in 8KB pages. Pages contain a header, item pointers, and tuples packed from both ends.

A tuple contains:
- **Header (23 bytes):** `xmin`, `xmax`, `cmin/cmax`, null bitmap, padding
- **Data:** Actual column values

This is why `SELECT *` is expensive for wide tables — all columns must be read even if you need one.

### TOAST (The Oversized-Attribute Storage Technique)

Values larger than ~2KB are automatically compressed and/or stored out-of-line in a separate TOAST table. Transparent to the user but impacts:
- Wide text/JSON columns → stored in TOAST → slower to retrieve
- `pg_column_size()` shows the actual stored size

```sql
-- Check TOAST usage
SELECT pg_size_pretty(pg_total_relation_size('large_table')) AS total,
       pg_size_pretty(pg_relation_size('large_table')) AS main,
       pg_size_pretty(pg_total_relation_size('large_table') - pg_relation_size('large_table')) AS toast;
```

---

## Vacuuming and Bloat

### Why Bloat Happens

MVCC creates dead tuples on every UPDATE and DELETE. These accumulate as **table bloat**. VACUUM reclaims them.

```sql
-- Check bloat
SELECT schemaname, tablename,
       n_dead_tup,
       n_live_tup,
       round(n_dead_tup::numeric / nullif(n_live_tup, 0) * 100, 2) AS dead_ratio,
       last_autovacuum
FROM pg_stat_user_tables
ORDER BY n_dead_tup DESC;
```

### Autovacuum Tuning

Default autovacuum settings are conservative. For high-write tables, tune per-table:

```sql
ALTER TABLE orders SET (
  autovacuum_vacuum_scale_factor = 0.01,   -- Trigger at 1% dead tuples (default 20%)
  autovacuum_analyze_scale_factor = 0.005, -- Analyze at 0.5% changes
  autovacuum_vacuum_cost_delay = 2         -- Less aggressive throttling
);
```

### VACUUM FULL vs VACUUM

- `VACUUM`: Marks dead space as reusable. Doesn't return space to OS. Fast, runs concurrently.
- `VACUUM FULL`: Rewrites entire table. Returns space to OS. Takes exclusive lock — blocks reads and writes. Use only when bloat is extreme and you can afford downtime.
- `pg_repack`: Third-party extension that does VACUUM FULL equivalent without locking. Use this in production.

---

## Table Partitioning

Split large tables into smaller physical partitions while presenting a single logical table.

### Range Partitioning

```sql
CREATE TABLE orders (
    id BIGINT,
    created_at TIMESTAMP,
    user_id BIGINT,
    status TEXT
) PARTITION BY RANGE (created_at);

CREATE TABLE orders_2024_q1 PARTITION OF orders
    FOR VALUES FROM ('2024-01-01') TO ('2024-04-01');

CREATE TABLE orders_2024_q2 PARTITION OF orders
    FOR VALUES FROM ('2024-04-01') TO ('2024-07-01');
```

**Benefits:**
- Partition pruning: queries with date filters only scan relevant partitions
- Drop old partitions instantly (vs. `DELETE` which is slow and creates bloat)
- VACUUM runs per partition (faster, less blocking)

### Hash Partitioning

```sql
PARTITION BY HASH (user_id)
-- Creates N partitions, each holding hash(user_id) % N rows
```

Good for even distribution when there's no natural range key.

### Partition Pruning

For partition pruning to work, the partition key must appear in the WHERE clause:

```sql
-- Pruning works: only scans 2024-Q1 partition
SELECT * FROM orders WHERE created_at BETWEEN '2024-01-01' AND '2024-03-31';

-- NO pruning: scans all partitions
SELECT * FROM orders WHERE user_id = 123;
```

---

## Query Optimization Patterns

### Query Planning Statistics

```sql
-- Check statistics freshness
SELECT tablename, last_analyze, last_autoanalyze
FROM pg_stat_user_tables WHERE tablename = 'orders';

-- Manually collect statistics
ANALYZE orders;

-- Increase statistics target for columns with skewed distributions
ALTER TABLE orders ALTER COLUMN status SET STATISTICS 500;
```

### Partial Index for Common Filters

```sql
-- Instead of: CREATE INDEX idx_orders_status ON orders(status);
-- Which must index ALL statuses including 'completed' (99% of rows)

-- Only index the small, frequently-queried subset:
CREATE INDEX idx_orders_pending ON orders(user_id, created_at)
WHERE status = 'pending';
```

This index is tiny and fast. Queries filtering by `status = 'pending'` use it automatically.

### Expression Index

```sql
-- Query: WHERE lower(email) = lower($1)
-- Normal index on email doesn't help (different case)

CREATE INDEX idx_users_email_lower ON users(lower(email));
-- Now the index is used
```

### Index-Only Scans

PostgreSQL can satisfy a query entirely from the index without touching the heap if:
1. All needed columns are in the index (via `INCLUDE`)
2. The row's visibility is known (tracked in the visibility map — updated by VACUUM)

```sql
CREATE INDEX idx_orders_user_status ON orders(user_id, status) INCLUDE (total, created_at);

-- This query can now use index-only scan:
SELECT user_id, status, total, created_at FROM orders WHERE user_id = 123;
```

### CTE Performance (Optimization Fence vs Inlining)

In PostgreSQL 12+, CTEs are inlined by default (optimizer can push conditions into them).

```sql
-- Before PG12: CTE was an optimization fence — subquery always executed fully
-- After PG12: CTE is inlined — optimizer can push predicates

-- Force materialization (old behavior) when CTE is expensive and reused:
WITH expensive_query AS MATERIALIZED (
    SELECT ... FROM large_table WHERE ...
)
SELECT * FROM expensive_query WHERE ...
```

### Window Functions vs Subqueries

```sql
-- Subquery approach (may scan table multiple times)
SELECT id, total,
       (SELECT avg(total) FROM orders WHERE user_id = o.user_id) AS avg_user_total
FROM orders o;

-- Window function approach (single pass)
SELECT id, total,
       avg(total) OVER (PARTITION BY user_id) AS avg_user_total
FROM orders;
```

Window functions: `ROW_NUMBER()`, `RANK()`, `DENSE_RANK()`, `LAG()`, `LEAD()`, `FIRST_VALUE()`, `LAST_VALUE()`, `NTILE()`.

---

## Locking and Concurrency

### Lock Levels (lightest to heaviest)

| Lock | Conflicts With | Use |
|---|---|---|
| ACCESS SHARE | ACCESS EXCLUSIVE only | SELECT |
| ROW SHARE | EXCLUSIVE, ACCESS EXCLUSIVE | SELECT FOR UPDATE |
| ROW EXCLUSIVE | SHARE, SHARE ROW EX, EXCLUSIVE, ACCESS EX | INSERT, UPDATE, DELETE |
| SHARE UPDATE EXCLUSIVE | SRE, SHARE, EX, ACCESS EX | VACUUM, CREATE INDEX CONCURRENTLY |
| SHARE | ROW EX, SRE, EX, ACCESS EX | CREATE INDEX |
| EXCLUSIVE | All except ACCESS SHARE | — |
| ACCESS EXCLUSIVE | Everything | DROP TABLE, TRUNCATE, ALTER TABLE |

**Most dangerous:** `ALTER TABLE` takes `ACCESS EXCLUSIVE` — blocks all reads and writes.

### Safe Schema Changes (Zero Downtime)

```sql
-- DANGEROUS: blocks reads and writes
ALTER TABLE orders ADD COLUMN discount DECIMAL DEFAULT 0 NOT NULL;

-- SAFE approach (3 steps):
-- Step 1: Add nullable column (fast, minimal lock)
ALTER TABLE orders ADD COLUMN discount DECIMAL;

-- Step 2: Backfill in batches
UPDATE orders SET discount = 0 WHERE id BETWEEN 1 AND 10000;
-- Repeat in batches to avoid lock contention

-- Step 3: Add NOT NULL constraint with a default (PG 11+: skips table rewrite)
ALTER TABLE orders ALTER COLUMN discount SET DEFAULT 0;
ALTER TABLE orders ALTER COLUMN discount SET NOT NULL;
```

### Advisory Locks

Application-level locks managed by PostgreSQL:

```sql
-- Session-level advisory lock (released on disconnect)
SELECT pg_advisory_lock(12345);
-- ... do work ...
SELECT pg_advisory_unlock(12345);

-- Transaction-level advisory lock (auto-released on commit/rollback)
SELECT pg_advisory_xact_lock(12345);
```

Use cases: distributed cron job leader election, ensuring only one instance processes a specific entity.

---

## Monitoring Queries to Run Regularly

```sql
-- Long-running queries
SELECT pid, age(clock_timestamp(), query_start) AS age, query
FROM pg_stat_activity
WHERE query != '<IDLE>' AND query NOT ILIKE '%pg_stat_activity%'
ORDER BY age DESC;

-- Blocking queries
SELECT blocked.pid, blocking.pid AS blocking_pid,
       blocked.query AS blocked_query, blocking.query AS blocking_query
FROM pg_stat_activity blocked
JOIN pg_stat_activity blocking ON blocking.pid = ANY(pg_blocking_pids(blocked.pid));

-- Index usage stats
SELECT indexrelname, idx_scan, idx_tup_read, idx_tup_fetch
FROM pg_stat_user_indexes
ORDER BY idx_scan;

-- Unused indexes (candidates for removal)
SELECT schemaname, tablename, indexname, idx_scan
FROM pg_stat_user_indexes
WHERE idx_scan = 0 AND indexrelname NOT LIKE 'pk_%'
ORDER BY pg_relation_size(indexrelid) DESC;

-- Table sizes
SELECT tablename,
       pg_size_pretty(pg_total_relation_size(tablename::regclass)) AS total_size
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY pg_total_relation_size(tablename::regclass) DESC;
```
