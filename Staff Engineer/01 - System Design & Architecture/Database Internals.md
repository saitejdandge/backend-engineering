# Database Internals

## How a Query Executes (PostgreSQL)

Understanding the journey of a query helps you optimize it.

1. **Parser:** Converts SQL text into an Abstract Syntax Tree (AST)
2. **Rewriter:** Applies rules (e.g., expands views)
3. **Planner/Optimizer:** Generates candidate query plans, estimates costs using table statistics, picks the cheapest plan
4. **Executor:** Executes the chosen plan, returns rows

Run `EXPLAIN ANALYZE` to see the plan the optimizer chose and actual runtime stats.

```sql
EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT * FROM orders WHERE user_id = 123 AND status = 'pending';
```

Key things to look for:
- **Seq Scan vs Index Scan:** Seq Scan on a large table = missing index
- **Rows estimate vs actual:** Large mismatch = stale statistics → run `ANALYZE`
- **Hash Join vs Nested Loop vs Merge Join:** Each optimal for different data sizes
- **Buffers hit vs read:** High "read" = data not in buffer cache = I/O bound

---

## Indexing Deep Dive

### B-Tree Index (Default)

- Balanced tree structure. O(log n) lookup.
- Supports: `=`, `<`, `>`, `<=`, `>=`, `BETWEEN`, `LIKE 'prefix%'`
- Does NOT support: `LIKE '%suffix'`, full-text search
- Used for: Most general-purpose indexing

**Multi-column (composite) index:**
```sql
CREATE INDEX idx_orders_user_status ON orders(user_id, status);
```
Column order matters. Index on `(user_id, status)` supports:
- `WHERE user_id = ?`
- `WHERE user_id = ? AND status = ?`
- But NOT efficiently: `WHERE status = ?` alone

**Rule:** Put the highest-cardinality column first, unless your query always filters on both.

### Hash Index

- O(1) average lookup for equality only (`=`)
- Does not support range queries
- In PostgreSQL, WAL-logged since v10
- Rarely used — B-Tree is usually better unless you have very specific equality-only workloads

### GIN Index (Generalized Inverted Index)

- For multi-valued data: arrays, JSONB, full-text search
- Stores mapping from each element to its containing rows
- Slower to write (each element indexed), fast to read

```sql
-- Full-text search
CREATE INDEX idx_articles_search ON articles USING gin(to_tsvector('english', body));

-- JSONB
CREATE INDEX idx_events_tags ON events USING gin(tags);
```

### BRIN Index (Block Range Index)

- Stores min/max values per block range
- Very small, very fast to build
- Only useful when physical storage order correlates with query order (e.g., append-only time-series tables)
- Not useful for random data

### Partial Index

Index only a subset of rows:
```sql
-- Only index pending orders (not completed/cancelled)
CREATE INDEX idx_orders_pending ON orders(user_id) WHERE status = 'pending';
```
Much smaller, faster, only helps queries with the matching WHERE clause.

### Covering Index (Index-Only Scan)

Include all columns needed by a query in the index to avoid fetching the actual table rows:
```sql
CREATE INDEX idx_orders_covering ON orders(user_id) INCLUDE (status, total);
-- Query can be satisfied entirely from the index
SELECT status, total FROM orders WHERE user_id = 123;
```

---

## MVCC (Multi-Version Concurrency Control)

PostgreSQL uses MVCC to allow readers and writers to not block each other.

**How it works:**
- Every row has `xmin` (transaction that created it) and `xmax` (transaction that deleted/updated it)
- Each transaction gets a snapshot of which transactions were committed at the time it started
- A row is "visible" to a transaction if its `xmin` is committed and in the past, and `xmax` is either empty or in the future
- Writes create new row versions, not in-place updates

**Implications:**
- Reads never block writes, writes never block reads
- UPDATE = INSERT new version + mark old as deleted
- Old row versions (dead tuples) accumulate → need VACUUM to reclaim space

**VACUUM:** Reclaims dead tuples. `AUTOVACUUM` runs automatically. If VACUUM can't keep up (e.g., long-running transactions hold back the horizon), tables bloat.

**Transaction ID Wraparound:** PostgreSQL uses 32-bit transaction IDs. After ~2 billion transactions, IDs wrap around — catastrophic if not handled. `VACUUM` marks old rows as "frozen" to avoid this. Monitor `age(relfrozenxid)`.

---

## Isolation Levels

Weaker isolation = better performance, more anomalies possible.

| Level | Dirty Read | Non-Repeatable Read | Phantom Read |
|---|---|---|---|
| Read Uncommitted | Possible | Possible | Possible |
| Read Committed | No | Possible | Possible |
| Repeatable Read | No | No | Possible (in theory) |
| Serializable | No | No | No |

PostgreSQL defaults to **Read Committed**. Its Repeatable Read actually prevents phantoms too (via MVCC snapshot). Serializable uses Serializable Snapshot Isolation (SSI) — detects and aborts conflicting transactions.

**Anomalies:**
- **Dirty Read:** Read uncommitted data from another transaction that later rolls back
- **Non-Repeatable Read:** Re-reading same row returns different value (another tx committed an update in between)
- **Phantom Read:** Re-running a range query returns different rows (another tx inserted rows)
- **Write Skew:** Two transactions read overlapping data, make decisions based on it, and write non-overlapping data — combined effect violates a constraint

---

## Sharding

Horizontal partitioning: split data across multiple database nodes (shards). Each shard holds a subset of rows.

### Sharding Strategies

**Range-based sharding:**
```
Shard 1: user_id 1–1,000,000
Shard 2: user_id 1,000,001–2,000,000
```
- Simple routing
- Risk of hot shards (e.g., new users all go to the last shard)

**Hash-based sharding:**
```
shard = hash(user_id) % num_shards
```
- Even distribution
- Hard to do range queries
- Resharding requires moving data

**Directory-based sharding:**
- Lookup service maps entity to shard
- Most flexible but introduces lookup bottleneck and single point of failure

### Sharding Challenges

- **Cross-shard queries:** JOINs and aggregations across shards are expensive/complex
- **Cross-shard transactions:** No ACID across shards without distributed transaction protocol
- **Schema changes:** Must apply to all shards
- **Resharding:** Adding shards requires data migration

### Alternatives to Sharding

Before sharding, exhaust:
1. Read replicas for read scalability
2. Vertical scaling (bigger instance)
3. Better indexing and query optimization
4. Caching
5. Partitioning (same node, multiple tables)
6. Table archiving (move old data elsewhere)

---

## Replication in Practice (PostgreSQL)

### Streaming Replication

- Primary ships WAL (Write-Ahead Log) records to replicas in real time
- Replicas replay WAL to stay in sync
- Replicas are read-only
- Replication lag: measure with `pg_stat_replication`

### Logical Replication

- Replicates at the row level (not WAL)
- Can replicate to different PostgreSQL versions
- Can replicate specific tables or rows
- Used for zero-downtime migrations, read scaling, cross-version upgrades

### Failover

When primary fails:
1. Promote a replica to primary (`pg_promote()` or `pg_ctl promote`)
2. Other replicas repoint to new primary
3. Old primary (if it recovers) must not accept writes → fencing

Tools: Patroni (manages failover automatically using DCS like etcd/ZooKeeper), repmgr.

---

## Database Connection Pooling

Applications open many connections but DB has limited capacity. Connection pools reuse connections.

- **PgBouncer:** Most popular for PostgreSQL. Session mode, transaction mode, statement mode.
  - **Transaction mode:** Connection returned to pool after each transaction (most efficient). Incompatible with some features (prepared statements, advisory locks, `SET` variables).
  - **Session mode:** Connection held for entire client session. Less efficient but fully compatible.
- **HikariCP:** Java-side connection pool. Very efficient. Default in Spring Boot.

**Key settings:**
- `max_connections` in PostgreSQL: default 100. Each connection uses ~5-10MB RAM.
- Pool size: `(number of cores * 2) + effective_spindle_count` — start here, tune from there.

---

## Write-Ahead Log (WAL)

Every change in PostgreSQL is written to WAL before it's applied to data files. This ensures durability (D in ACID) — if a crash occurs, WAL is replayed on recovery.

WAL is also the mechanism for:
- Point-in-time recovery (PITR)
- Streaming replication
- Logical replication
- Change Data Capture (CDC) tools like Debezium read WAL

**WAL archiving:** Ship WAL segments to S3/GCS for backup and PITR. Essential for disaster recovery.


---

## Related

[[Caching Strategies]]  [[Distributed Systems Fundamentals]]
