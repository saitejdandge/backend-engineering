# Database Replication

Copying and synchronising data from a **primary** (leader) to one or more **replicas** (followers) to ensure consistency, high availability, and fault tolerance.

---

## Why Replicate

- **Reduce access latency** — serve reads from replicas closer to users
- **High availability** — if primary goes down, a replica takes over
- **High durability** — multiple copies mean data survives node failures
- **Scale read throughput** — distribute read traffic across replicas



> **Backups ≠ Replicas.** Backups are periodic snapshots of the database used to rollback to a prior state or to seed a new replica. Replicas are live, continuously updated copies.

---

## Replication Propagation

The two fundamental strategies for how writes travel from leader to followers:

**Synchronous** — leader waits for a subset (quorum) of replicas to acknowledge the write before confirming success to the client. We cannot wait for *all* replicas — if one fails to ACK, all writes would block.

**Asynchronous** — leader writes to local storage and confirms to the client immediately. Replicas catch up independently in the background.

---

## Single Leader Replication

The simplest and most common model. One node is designated the **leader** (also called primary, master, source). All writes go to the leader first. Followers are **read-only** from the client's perspective.

*Also known as: primary-secondary, leader-follower, active-passive*
```
Client WRITE → Leader → propagates → Follower 1
                                   → Follower 2
Client READ  → Leader OR any Follower
```

### Synchronous Replication

Leader waits for quorum ACK before confirming the write.
-  No data loss — high durability
-  Lower availability — any sync follower failure blocks all writes
- Use when: durability is critical and you can tolerate some write latency
### Asynchronous Replication
Leader does not wait for any follower ACK.

-  High availability — leader is never blocked
-  Risk of data loss — if leader dies before replication, those writes are lost
- Use when: availability matters more than strict durability

### Write Acknowledgement

We wait for a **subset (quorum/majority)** of replicas to ACK — not all. Waiting for all would mean a single slow or failed replica blocks the system.

### Follower Recovery (Catch-up)

When a follower crashes and comes back:

1. Replay from the **last known log entry** it processed before the fault
2. Connect to the leader and request all data changes that occurred during disconnect
3. If too far behind — spin up from a **backup snapshot**, then replay changes from that snapshot's timestamp forward

>  If the follower is too far behind and write throughput is high, the replication logs from that period may no longer exist.

### Leader Failover

When the leader fails, a follower must be **promoted** to become the new leader.

**Challenge — Detecting leader failure:** Usually through timeouts. Tune carefully:
- Too long → writes are blocked for too long during outage
- Too short → unnecessary failovers during transient slowness

**Challenge — Leader election:** Leader is chosen by majority of replicas. Best candidate = replica with the most up-to-date writes (consensus algorithms).

**Challenge — Post-failover reconfiguration:**
- Clients must send writes to the new leader
- Old leader must come back as a *follower*, not a leader
-  **Split-brain** — if the old leader comes back and also acts as leader, two nodes accept writes independently → data diverges. Systems will shut down one node if split-brain is detected. There is no perfect solution to this.
-  **Non-durable writes** — writes that were ACKed by the old leader but not yet replicated may need to be discarded. This can violate durability guarantees.

---

## Multi Leader Replication

A natural extension of single-leader: **more than one node accepts writes**. Each leader replicates its writes to all other leaders. Each leader simultaneously acts as a follower to the others.

*Also known as: active/active, bidirectional replication*

> Rarely makes sense to have multiple leaders within the same data centre. Primarily useful for geo-distributed systems.

### Synchronous Multi-Leader

One leader (e.g. B) is the actual leader; the other (A) simply forwards write requests to B. Provides leader redundancy but not parallel write scaling. Consistent, similar to single-leader.

### Asynchronous Multi-Leader

Leaders accept writes independently and resolve conflicts afterward. This is the more common and practical form.

-  Write throughput scales with number of leaders
-  Tolerance of regional outages (other leaders keep accepting writes)
-  Tolerance of network problems (each leader works independently)
-  Consistency is hard
-  Conflicting writes require resolution

### Use Cases

**Geo-replicated systems** — each data centre has its own leader. Writes go to the nearest leader. Asynchronous replication between data centres.

**Sync Engines / Local-first storage** — a local leader on the user's device syncs to a remote leader asynchronously. Examples:
- WhatsApp: write locally, sync to server
- Offline-first apps: work without network, sync when reconnected
- Real-time collaboration (similar infrastructure to offline-first)
- Gaming: the equivalent of sync engine is *net code*

Pros of local-first: faster UI, works offline, FE writes never fail locally
Cons: not suitable for large datasets, must handle conflicts

**When to use multi-leader:** when the system must stay highly available for writes even if a leader fails — another leader continues accepting writes.

### Topologies for Replication

How write changes propagate between multiple leaders:
- **Circular** — each leader forwards to the next in a ring
- **Star** — all leaders forward through a designated central node
- **All-to-all** — every leader replicates directly to every other leader (most resilient)

### Conflict Resolution

Conflicts occur when two leaders accept writes to the same record simultaneously.

**Conflict Avoidance** — route all writes for a given record to the same leader (e.g. same region). Prevents conflicts from occurring. Not always possible for local-first systems.

**Last Write Wins (LWW)** — attach a timestamp to each write; keep the one with the highest timestamp. Simple but unreliable — clocks are not always accurate.

**Manual Resolution** — like a Git merge conflict. CouchDB can return multiple values for the same key; the application picks the right one. Problems: data skewness, awkward for frontends, merging can introduce new conflicts.

**Automatic Resolution (CRDT / OT):**
- Goal: data converges eventually → *strong eventual consistency*
- **CRDT** (Conflict-free Replicated Datatypes) — data structures that merge automatically: text (insert/delete ops), arrays (merge elements), integers (add values)
- **OT** (Operational Transformation) — used in collaborative editors
- Best for offline-first applications

**Business Conflicts** — some conflicts can't be resolved automatically. Example: two leaders from different regions book the same last available slot. Requires application-level logic.

---

## Leaderless Replication

No leader-follower distinction. **Every node is equal** — any node can accept reads and writes. No failover needed.

The client (or a coordinator node) sends requests directly to several replicas in parallel. Unlike a leader database, the coordinator does not enforce a particular write ordering.

### Writing to the Database

Client sends write requests to **all nodes** simultaneously. The write is considered successful once **enough nodes** (quorum) ACK it. Some nodes may miss the write (e.g. if temporarily unavailable).

### Reading from the Database

Client sends read requests to **all nodes** simultaneously. Because some nodes may have stale data, the client reads from multiple and picks the value with the latest version (LWW or version vectors). The read also helps detect which nodes are behind.

>  LWW on read is unreliable because clocks are not always accurate.

### Repair Mechanisms

Nodes that missed a write must eventually catch up:

**Read Repair** — when a client reads from multiple nodes and detects a stale value on one, it writes the updated value back to that node. Works well for frequently read data.

**Hinted Handoff** — when a node is unavailable, another node temporarily accepts the write as a "hint" and forwards it to the original node once it recovers.

**Anti-Entropy** — a background process that constantly checks for differences between replicas and copies any missing data. Unlike replication logs, anti-entropy does not copy writes in any particular order and may have significant delay.

### Quorum Reads and Writes

```
w + r > n
```

- **n** = number of replicas storing this particular data (in sharded systems, this = partition replica count)
- **w** = minimum write ACKs required
- **r** = minimum nodes to read from

As long as `w + r > n`, we expect to get an up-to-date value. `r` and `w` are the *minimum votes* required for the operation to be valid.

**Typical configuration:** choose n as an odd number; set `w = r = (n+1)/2`

**Tuning for workload:**
- Read-heavy: set `w = n, r = 1` → reads are fast, but one failed node blocks all writes

### Problems with Quorum

Quorum does **not** always guarantee absolute consistency:

- If a node with new data fails and is restored from a stale replica, the quorum condition for the new value breaks
- During rebalancing, nodes may have an inconsistent view
- A read concurrent with a write may see new value then old value on subsequent read
- A write that succeeds on some nodes but fails on others is not rolled back — subsequent reads may or may not return that value
- Unreliable timestamps make LWW decisions wrong
- Concurrent writes to the same key → conflict (must use LWW or similar)

---

## Leaderless vs Multi-Leader vs Single Leader

| | Single Leader | Multi Leader | Leaderless |
|---|---|---|---|
| Write path | One node only | Multiple nodes | All nodes |
| Read path | Leader or replica | Any leader | All nodes |
| Consistency | Strongest | Moderate | Weakest (eventual) |
| Write availability | Low (leader failure = blocked) | High | High (no failover) |
| Failover | Required | Partial (other leaders) | None |
| Conflict resolution | Not needed | Required | Sometimes required |
| Best for | OLTP, strong consistency | Geo-distribution, offline-first | High availability, resilience |

**Request hedging** — leaderless systems send to multiple replicas and use the fastest response, significantly reducing tail latency.

**Resilience:** the strength of leaderless comes from not distinguishing between normal and failure cases.

**Multi-Leader vs Leaderless for network partitions:** Multi-leader can offer greater resilience because reads/writes need communication with only one co-located leader, whereas leaderless reads/writes need to contact multiple replicas across the network.

---

## How Replication Works

### Statement-Based Replication

The leader logs the **SQL statement** itself (e.g. `UPDATE users SET name = 'Alice' WHERE id = 1`). Replicas re-execute the statement.

-  No version dependency between primary and secondary
-  Non-deterministic functions produce different results on replicas (`RAND()`, `NOW()`, `UUID()`)
-  Auto-incrementing columns must execute in exactly the same order
-  Triggers and stored procedures cause side effects

### Write-Ahead Log (WAL) Shipping

The leader ships its **physical WAL** (low-level storage engine log) to replicas.

-  Complete, precise record of every change
-  Strong version dependency — primary and replica must run the exact same database version
-  Cannot use for zero-downtime upgrades (rolling version upgrades)

Used by: PostgreSQL (physical WAL shipping)

### Logical / Row-Based Replication

Log **row-level changes** (before and after images of each affected row) rather than SQL statements or physical bytes.

-  No version dependency — primary and replica can run different versions
-  Can be used with external systems → **Change Data Capture (CDC)**
- MySQL: binlog replication
- PostgreSQL: converts physical WAL into row-based logical logs, also used for CDC integration

---

## Problems with Replication Lag

In asynchronous replication, replicas may lag behind the leader. This causes several consistency anomalies:

### Read-After-Write Consistency

**Problem:** User writes data, then immediately reads from a replica that hasn't caught up yet — they don't see their own write.

**Solutions:**
- When reading data the user may have modified, read from the leader (or a synchronously updated follower)
- Track the timestamp of the user's last write; for some time window, route reads to the leader
- **Cross-device:** if a user switches devices, route all of that user's devices to the same region, since a device timestamp stored locally isn't visible to another device
- **Geo-distributed:** requests that need to be served by the leader must be routed to the region containing the leader

### Monotonic Reads

**Problem:** A user makes multiple reads and sees data "go back in time" — seeing a newer value on one read, then an older value on the next (because different replicas served each request).

**Solution:** Ensure each user always reads from the same replica. One approach: assign replica based on a hash of the user ID.

### Consistent Prefix Reads

**Problem:** A sequence of causally related writes appears out of order to a reader (e.g. a reply appears before the original message). This typically happens when the two writes go to different shards.

**Solution:** Ensure causally related writes go to the same shard so their ordering is preserved.

---

## CAP Theorem

In the presence of a network partition, a distributed system must choose between:

- **Consistency (C)** — all nodes see the same data at the same time
- **Availability (A)** — every request receives a response, even if stale
- **Partition Tolerance (P)** — the system continues operating despite network failures

**Synchronous replication** → CP (consistency over availability)
**Asynchronous replication** → AP (availability over consistency)

---

## Quick Reference — Replication in Popular Databases

| Database | Model | Key Feature |
|---|---|---|
| PostgreSQL | Primary–Replica | Streaming replication, logical replication, WAL shipping |
| MySQL | Primary–Replica | Binary log (binlog), semi-sync replication |
| MongoDB | Replica Sets | Automatic failover via Raft consensus |
| Cassandra | Leaderless | Tunable consistency (ONE, QUORUM, ALL), Murmur3 hashing |
| Redis | Primary–Replica | Async replication + Sentinel for failover |
| CockroachDB | Multi-Primary (Raft) | Strong consistency via distributed Raft |
| DynamoDB | Leaderless | Quorum reads/writes, eventual consistency by default |


---

## Related

[[Database Sharding]]
