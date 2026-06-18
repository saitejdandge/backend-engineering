# NoSQL Systems

## Why NoSQL

NoSQL databases trade some ACID guarantees and query flexibility for:
- Horizontal scalability (sharding built-in)
- Flexible schemas (no migration required for new fields)
- Optimized data models for specific access patterns
- High write throughput

**Not a replacement for RDBMS** — use the right tool for the job. Most production systems use both.

---

## DynamoDB (Wide-Column / Key-Value)

AWS managed, serverless, millisecond latency at any scale.

### Data Model

Every item has a **Partition Key** (PK) and optionally a **Sort Key** (SK).

- **PK alone (simple key):** Like a hash map. Each key maps to one item.
- **PK + SK (composite key):** PK groups related items together. SK enables range queries within the partition.

```
Table: Orders
PK: USER#123        SK: ORDER#2024-01-15#abc
PK: USER#123        SK: ORDER#2024-01-20#def
PK: ORDER#abc       SK: ITEM#product-1
PK: ORDER#abc       SK: ITEM#product-2
```

This is the **single-table design** pattern — store multiple entity types in one table using PK/SK conventions.

### Access Patterns First

DynamoDB is **access-pattern driven**. Design the data model around how you'll query it, not around entities.

Define all access patterns before designing the schema:
- Get all orders for a user → PK = `USER#<id>`, query by PK
- Get a specific order → PK = `USER#<id>`, SK = `ORDER#<id>`
- Get all items in an order → PK = `ORDER#<id>`, SK begins with `ITEM#`

### Global Secondary Indexes (GSI)

Alternative access patterns via separate indexes:
```
Base table PK: USER#<id>, SK: ORDER#<id>
GSI1 PK: STATUS#pending, SK: ORDER#<id>   -- Query all pending orders
```

Limits: max 20 GSIs per table. Each GSI replicates data (costs extra).

### Throughput and Capacity

- **Provisioned capacity:** Set read/write capacity units (RCUs/WCUs). Predictable cost. Risk of throttling.
- **On-demand capacity:** Pay per request. No throttling. ~7x more expensive at steady load.

Recommendation: On-demand for dev/test. Provisioned + Auto Scaling for production.

### Consistency

- **Eventually consistent reads (default):** Cheaper (0.5 RCU per 4KB). May read stale data.
- **Strongly consistent reads:** Always reads latest value. Costs 1 RCU per 4KB. Higher latency.

### DynamoDB Transactions

`TransactWriteItems` / `TransactGetItems` — all-or-nothing writes/reads across up to 100 items (even across tables):

```python
dynamodb.transact_write_items(
    TransactItems=[
        {'Put': {'TableName': 'orders', 'Item': {'PK': 'ORDER#123', ...}}},
        {'Update': {'TableName': 'inventory', 'Key': {'PK': 'PRODUCT#456'}, ...}},
    ]
)
```

2x cost vs non-transactional. Still eventual consistency across regions in global tables.

---

## Cassandra (Wide-Column)

Open-source, distributed, masterless, optimized for write-heavy workloads.

### Architecture

- **Masterless (P2P):** No single point of failure. Any node can accept reads/writes.
- **Consistent hashing:** Data distributed across nodes using token ring.
- **Replication factor:** Each row stored on N nodes.
- **Tunable consistency:** `ONE`, `QUORUM`, `ALL` per query.

### Data Model

```sql
-- Partition key: determines which node stores the data
-- Clustering columns: sorted within the partition, enable range queries

CREATE TABLE orders_by_user (
    user_id UUID,
    order_id TIMEUUID,
    status TEXT,
    total DECIMAL,
    PRIMARY KEY (user_id, order_id)  -- (partition key, clustering column)
) WITH CLUSTERING ORDER BY (order_id DESC);

-- Query: most recent orders for a user
SELECT * FROM orders_by_user WHERE user_id = ? LIMIT 10;
```

**Rule:** You can only query on the partition key (equality) and clustering columns (equality or range). No arbitrary WHERE clauses.

### Write Path

1. Write goes to **CommitLog** (WAL for durability) and **Memtable** (in-memory)
2. Memtable flushed to disk as **SSTable** when full
3. SSTables compacted periodically (merge, remove tombstones)

Cassandra is **write-optimized**: writes are sequential (fast). Reads are more expensive (may read multiple SSTables).

### Tombstones

Deletes in Cassandra write a **tombstone** (a deletion marker). Tombstones accumulate until compaction runs. Too many tombstones → read performance degrades badly. Design to minimize deletes.

### When to Use Cassandra

- Time-series data (IoT, metrics, logs)
- Write-heavy workloads (> 50K writes/sec)
- Multi-datacenter active-active
- Predictable, well-defined query patterns
- Data that grows forever (append-only)

---

## MongoDB (Document)

Flexible JSON-like documents. Supports rich queries, secondary indexes, and aggregations.

### Data Model

```json
{
  "_id": "order-123",
  "userId": "user-456",
  "status": "pending",
  "items": [
    {"productId": "prod-789", "quantity": 2, "price": 29.99},
    {"productId": "prod-101", "quantity": 1, "price": 49.99}
  ],
  "shippingAddress": {
    "street": "123 Main St",
    "city": "San Francisco"
  },
  "createdAt": "2024-01-15T10:30:00Z"
}
```

**Embed vs Reference:**
- **Embed:** Store related data in the same document. Fast reads (one query). Document size limit: 16MB. Use when data is always accessed together.
- **Reference:** Store IDs and look up separately. Flexible, avoids document bloat. Use when related data is large or accessed independently.

### Aggregation Pipeline

MongoDB's answer to SQL GROUP BY, JOIN, and complex transformations:

```javascript
db.orders.aggregate([
  { $match: { status: "completed", createdAt: { $gte: new Date("2024-01-01") } } },
  { $group: { _id: "$userId", totalRevenue: { $sum: "$total" }, orderCount: { $count: {} } } },
  { $sort: { totalRevenue: -1 } },
  { $limit: 10 }
]);
```

### Indexing in MongoDB

```javascript
// Compound index
db.orders.createIndex({ userId: 1, createdAt: -1 });

// Partial index (like PostgreSQL)
db.orders.createIndex({ userId: 1 }, { partialFilterExpression: { status: "pending" } });

// Text index for full-text search
db.products.createIndex({ name: "text", description: "text" });

// Explain a query
db.orders.find({ userId: "user-123" }).explain("executionStats");
```

### Transactions in MongoDB

MongoDB 4.0+ supports multi-document ACID transactions:

```javascript
const session = client.startSession();
session.startTransaction();
try {
    db.orders.insertOne({...}, { session });
    db.inventory.updateOne({...}, {$inc: {stock: -1}}, { session });
    await session.commitTransaction();
} catch (error) {
    await session.abortTransaction();
}
```

Performance: transactions have overhead. Use only when necessary.

---

## Redis (In-Memory)

Already covered in Caching Strategies, but Redis is also a full data store.

### Use as Primary Store

- **Sessions:** Fast read/write, built-in TTL
- **Leaderboards:** Sorted sets for real-time rankings
- **Rate limiting:** Atomic increment with TTL
- **Pub/Sub:** Real-time messaging
- **Distributed locks:** SETNX + expiry (or Redlock for distributed)
- **Job queues:** Redis Streams or BullMQ/Celery

### Redis Persistence

- **RDB (snapshots):** Point-in-time snapshot at intervals. Fast restart. Data loss between snapshots.
- **AOF (Append Only File):** Log every write. Can replay to any point. Slower but safer.
- **Both:** Recommended for production — RDB for fast restart, AOF for data safety.

### Redis Cluster

Automatic data sharding across multiple nodes. 16,384 hash slots divided across masters. Each master has replicas.

**Limitation:** Multi-key commands only work if all keys map to the same slot. Use hash tags `{user:123}` to force co-location.

---

## Elasticsearch (Search Engine)

Apache Lucene-based distributed search and analytics engine.

### Concepts

- **Index:** Like a database table. Stores JSON documents.
- **Document:** A JSON object stored in an index.
- **Shard:** A Lucene index. Each index split into N primary shards + replicas.
- **Mapping:** Schema definition. Field types: `text`, `keyword`, `integer`, `date`, `nested`, `geo_point`.

### Text vs Keyword

```json
{
  "name": { "type": "text" },     // analyzed: tokenized, lowercased, stemmed → full-text search
  "status": { "type": "keyword" } // not analyzed → exact match, aggregations, sorting
}
```

### Query DSL

```json
GET /orders/_search
{
  "query": {
    "bool": {
      "must": [
        { "match": { "description": "laptop computer" } }
      ],
      "filter": [
        { "term": { "status": "pending" } },
        { "range": { "createdAt": { "gte": "2024-01-01" } } }
      ]
    }
  },
  "sort": [{ "_score": "desc" }],
  "aggs": {
    "by_status": { "terms": { "field": "status" } }
  }
}
```

### When to Use Elasticsearch

- Full-text search (product search, log search)
- Complex filtering and faceting
- Aggregations and analytics at scale
- Geospatial queries

**Not a primary database.** Data durability is lower than PostgreSQL. Use as a secondary store synced from your primary DB.


---

## Related

[[PostgreSQL Internals & Optimization]]
