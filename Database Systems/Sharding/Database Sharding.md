# Database sharding 

When there is so much data or such a high write throughput that a single node cannot handle it, the data is split into smaller **shards** (also called partitions), and different shards are stored on different nodes.

Each shard is a **database on its own**, though some systems support operations that touch multiple shards simultaneously.

> **Same concept, different names across systems:**
> Kafka: Partition | CockroachDB: Range | HBase/TiDB: Region | Couchbase: vBucket | Riak: vnode | Cassandra: Token-range | Bigtable: Tablet

---

## Why and When to Shard

The **primary reason** for sharding is scalability — specifically write scalability and data volume.

- Use sharding when data volume or write throughput has outgrown a single node
- **If read throughput is the problem, you don't need sharding** — use read scaling with replication instead
- If a single machine can handle your workload, **avoid sharding** — it adds significant complexity

---

## Shards with Replication

Sharding is almost always **combined with replication** so that copies of each shard exist on multiple nodes.

- Each shard has **one leader** and one or more **followers**
- Each shard's leader is assigned to a different node
- A single node may be the leader for some shards and a follower for other shards
- Spread shard leaders across nodes — you don't want to lose all leaders at once

```
Node A: Leader(Shard 1), Follower(Shard 2), Follower(Shard 3)
Node B: Follower(Shard 1), Leader(Shard 2), Follower(Shard 3)
Node C: Follower(Shard 1), Follower(Shard 2), Leader(Shard 3)
```

---

## Challenges

**Distributed Transactions** — a write may need to update related records in several shards. Single-node transactions are common, but consistency across multiple shards requires a distributed transaction protocol, which is expensive and complex.

**Rebalancing Overhead** — moving data when nodes are added or removed puts additional load on the system, potentially making an already hot shard worse.

**Hot Spots** — uneven write distribution can cause one shard to be overwhelmed while others are idle.

**Request Routing** — clients need to know which shard holds which data. See the Request Routing section below.

---

## Sharding Strategies

### Key-Range Sharding

Assign a **contiguous range of partition keys** to each shard (like volumes of an encyclopaedia: A-F, G-M, N-Z). Keys are **sorted within each shard**.

Used by: Vitess (MySQL), BigTable, HBase, CockroachDB (ranges)

**Advantages:**
- Fast range scans — keys in the same range are on the same shard
- The key acts as a concatenated index for fetching several records in one query
- Dynamic split/merge: shards adapt as data grows

**Problems:**
- Data may not be evenly distributed — some ranges may have far more data
- **Hot spots** with monotonically increasing keys (e.g. timestamps) — all current writes land on the same shard
- Fix: prefix the key with a unique ID or another field before the timestamp, but this means you can't do a single range query across multiple prefixes
-  Splitting a hot shard adds load precisely when the shard is already overloaded

**Rebalancing Key-Range Shards:**
- Initially no key ranges exist; some systems allow configuring an initial set (pre-splitting)
- Shards split or merge dynamically based on data volume (e.g. HBase splits at 10 GB) or write throughput
- The number of shards adapts to data volume over time

### Hash-Based Sharding

Apply a **hash function** to the partition key to get a uniformly distributed value, then map that value to a shard.

```
hashFunction(key) → [0, 2³²-1]  (uniformly distributed)
```

Even if input strings are similar, their hashes are evenly distributed. Same input always produces same output.

- MongoDB: MD5
- Cassandra / ScyllaDB: Murmur3

**Advantages:**
- Even data distribution across shards
- Eliminates hot spots caused by key patterns

**Problems:**
-  **Range queries are inefficient** — related keys are now scattered across different shards
- Plan your data model so range queries happen *within* a partition (e.g. use a composite key where the hash part is a tenant ID and the range part is a timestamp)

### Key-Range vs Hash-Based

| | Key-Range | Hash-Based |
|---|---|---|
| Data distribution | Uneven (skew risk) | Even |
| Range scans | Efficient | Inefficient |
| Hot spots | Yes (monotonic keys) | No |
| Use case | Time-series, alphabetical | Tenant IDs, user IDs |

**Rule of thumb:** use key-range when nearby keys should be grouped together; use hash when key proximity doesn't matter.

---

## Managing Shard Count

### Fixed Number of Shards

Create **many more shards than there are nodes** upfront, and assign several shards to each node.

Example: 10 nodes → 1,000 shards → ~100 shards per node

When a node is added, a few shards are moved from existing nodes to the new one. Shard boundaries don't change — only shard-to-node assignment changes.

Used by: **Citus (PostgreSQL)**

-  Simple rebalancing — move whole shards
-  Shard count must be estimated well upfront
-  Doesn't scale well if the app grows rapidly beyond the initial estimate

### Dynamic Number of Shards

The **number of shards adapts** to the workload. Used in systems that combine key-range sharding with a hash function so each shard holds a range of hash values (not a range of actual keys).

DynamoDB example — assigns random range boundaries:
```
Hash range [0..1024]:
  Node 1: [0..10]
  Node 2: [10..200]   ← bigger partition
  ...
```

Used by: **DynamoDB**

-  Adapts to data volume automatically
-  Range queries are inefficient (data scattered)
-  Exponential app growth → heavy rebalancing → puts load on existing traffic
- Plan range queries to happen within a single partition

---

## Consistent Hashing

An algorithm used with dynamic sharding to **minimise data movement** when nodes are added or removed.

In a simple hash scheme, adding a node would require remapping almost all keys. Consistent hashing ensures only `K/n` keys need remapping (K = total keys, n = number of nodes).

Nodes and keys are mapped to positions on a conceptual "ring". When a node is added or removed, only the keys between it and its neighbour on the ring are moved.

Used in: Cassandra, DynamoDB, Riak — combined with dynamic shard count to keep rebalancing cost low.

---

## Request Routing

When a client wants to read or write, how does it know which node holds the relevant shard?

**Option 1 — Client-level routing:** The client knows the shard map and connects directly to the correct node. Not recommended — shard maps change during rebalancing and every client must be updated.

**Option 2 — Coordinator node (recommended):** Requests go to a coordinator that knows the current shard map. The coordinator uses **ZooKeeper** or **etcd** (distributed consensus systems) to track shard assignment and routes the request to the right node.

**Option 3 — Node-level routing:** Any node can accept a request. If it doesn't own the shard, it forwards to the correct node internally (gossip protocol). Cassandra and Riak use this approach.

---

## Indexes

### Local Secondary Index (LSI)

An index scoped to a **single partition/shard**. Used for range queries *within* a partition.

-  No extra write throughput (index is local)
-  Can't query across partitions using this index
- Rarely needed but useful to know

### Global Secondary Index (GSI)

An index that **spans all shards** — it is itself sharded separately. Supports querying data across all partitions by a non-primary key.

-  Supports multiple query patterns
-  Uses sort key to do efficient range queries
-  Increases write throughput (every write must also update the GSI)
-  Can have stale data — DynamoDB replicates GSI asynchronously, so GSI may lag behind the main table

---

## Sharding for Multi-Tenancy

In multi-tenant systems, each tenant has a self-contained dataset separate from others. Sharding strategy:

- Give each tenant a **dedicated shard**, OR
- **Group small tenants** into a larger shared shard (physical or logical)

**Advantages:**
- Resource isolation per tenant
- Permission isolation per tenant
- Cell-based architecture (blast radius limited per tenant)
- Per-tenant backup and restore
- Regulatory compliance and data residency
- Gradual schema rollout (roll out schema changes tenant by tenant)

**Disadvantages:**
- A single large tenant may itself outgrow one shard — you'd need to re-shard within that tenant
- Grouped tenants: if one grows large, creating a new shard for it while it's grouped is painful
- Cross-tenant joins are difficult or impossible

---

## Sharding for Key-Value Data

The goal is to spread data and query load **evenly** across nodes.

- Theoretically: 10 nodes → 10× the data capacity and 10× the throughput
- Add or remove nodes → rebalance so load is evenly distributed across the new set

The challenge is choosing a sharding strategy (key-range vs hash) that achieves this balance for your specific access patterns.

**Hot-spot avoidance techniques:**
- Hash the partition key before assigning to a shard
- Prefix hot keys with a random prefix (trades some range-scan ability for distribution)
- Use composite keys that spread writes across shards
