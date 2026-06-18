# Distributed Systems Fundamentals

## CAP Theorem

The CAP theorem states that a distributed system can only guarantee **two of three** properties simultaneously:

- **Consistency (C):** Every read receives the most recent write or an error. All nodes see the same data at the same time.
- **Availability (A):** Every request receives a (non-error) response — but without guarantee it contains the most recent write.
- **Partition Tolerance (P):** The system continues to operate despite arbitrary network partitions between nodes.

In practice, **network partitions are unavoidable** in any distributed system. So the real trade-off is always **C vs A** during a partition event.

### Practical Implications

| System Type | Trade-off | Examples |
|---|---|---|
| CP | Sacrifices availability under partition | HBase, Zookeeper, etcd |
| AP | Sacrifices consistency under partition | Cassandra, DynamoDB, CouchDB |
| CA | Only works without partitions (not real distributed) | Single-node RDBMS |

**Key insight for staff engineers:** CAP is a *theoretical model*. Real systems exist on a spectrum. Tools like DynamoDB let you tune consistency per-operation (eventually consistent reads vs. strongly consistent reads). Design decisions should be framed around *which guarantees matter for which operations*, not "we picked CP."

---

## PACELC Theorem (CAP Extension)

CAP only covers behavior during a partition. **PACELC** extends it to also consider latency vs. consistency trade-offs even when the network is healthy:

> If Partition → choose between Availability and Consistency.  
> Else (no partition) → choose between Latency and Consistency.

Example: Cassandra is PA/EL — it favors availability during partitions and low latency otherwise. DynamoDB with strong reads is PA/EC.

---

## Eventual Consistency

Eventual consistency means: *given no new updates, all replicas will eventually converge to the same value.*

It does **not** mean data is always correct or that reads are always fresh. It means the system will repair itself over time.

### Conflict Resolution Strategies

- **Last Write Wins (LWW):** The write with the highest timestamp wins. Simple but loses data on concurrent writes. Used by Cassandra.
- **Vector Clocks:** Track causality between operations. Each node has a logical clock. Allows detecting conflicts. Used historically by Dynamo.
- **CRDTs (Conflict-free Replicated Data Types):** Data structures that can be merged deterministically. Great for counters, sets, registers. No coordination needed.
- **Application-level resolution:** Let the application decide (e.g., merge shopping carts instead of overwriting).

---

## Consensus Algorithms

Consensus is the problem of getting multiple nodes to agree on a single value, even in the presence of failures.

### Raft

Raft is a consensus algorithm designed for understandability. It underpins etcd (used in Kubernetes), CockroachDB, and TiKV.

### key concepts

- **Leader election:** One node becomes leader. If it fails, an election occurs. A node wins with majority votes.
- **Log replication:** All writes go to the leader, which replicates to followers. A write is "committed" once a majority acknowledges it.
- **Terms:** Logical time unit. Each election starts a new term.
- **Split-brain prevention:** A node can only win if it has the most up-to-date log among the majority.

**Safety guarantee:** At most one leader per term. Committed entries are never lost.

### Paxos

The original consensus algorithm. More complex than Raft, but the conceptual foundation of many systems.

Phases:
1. **Prepare phase:** Proposer sends a ballot number to Acceptors. Acceptors promise not to accept older ballots.
2. **Accept phase:** Proposer sends the value. Acceptors accept if they haven't promised a newer ballot.
3. **Learn phase:** Learners are notified of the accepted value.

**Multi-Paxos:** Optimizes for repeated decisions (like a replicated log) by electing a stable leader to skip the prepare phase.

### When Consensus is Needed

- Leader election
- Distributed locks
- Atomic broadcast
- Configuring cluster membership
- Coordination across microservices requiring exactly-once semantics

---

## Replication

### Synchronous vs Asynchronous Replication

- **Synchronous:** Leader waits for at least one follower to acknowledge before confirming write. Strong durability guarantee. Higher latency.
- **Asynchronous:** Leader confirms immediately. Lower latency but risk of data loss if leader crashes before replication.
- **Semi-synchronous (MySQL):** One follower is synchronous, others are async. Balance between durability and performance.

### Replication Topologies

- **Single-leader (master-replica):** All writes go to leader, reads can go anywhere. Simple but write bottleneck.
- **Multi-leader:** Multiple leaders accept writes. Useful for multi-datacenter setups. Conflict resolution required.
- **Leaderless (Dynamo-style):** Any node can accept writes. Quorum reads/writes (W + R > N) for consistency guarantees.

### Quorum Reads and Writes

With N replicas, W write acknowledgments required, R read replicas queried:

- **W + R > N** guarantees reading the latest write (overlap is guaranteed)
- **W = N** → strong durability, slow writes
- **R = 1** → fast reads, stale data possible
- Typical: N=3, W=2, R=2

---

## Consistency Models (Spectrum)

From strongest to weakest:

1. **Linearizability (strongest):** Operations appear instantaneous and in a total order. Reads always return latest write. Very expensive.
2. **Sequential Consistency:** All operations appear in some order consistent with each process's program order. Doesn't require real-time ordering.
3. **Causal Consistency:** Operations causally related appear in order. Concurrent operations can be seen in different orders.
4. **Monotonic Read Consistency:** You never see older data than you've already seen (no going backward in time).
5. **Read Your Writes:** After writing, you'll always read your own write.
6. **Eventual Consistency (weakest):** No real-time guarantee; convergence over time.

---

## Distributed Transactions

### Two-Phase Commit (2PC)

A protocol for atomic commits across multiple nodes:

1. **Phase 1 (Prepare):** Coordinator asks all participants to prepare. Each locks resources and votes yes/no.
2. **Phase 2 (Commit/Abort):** If all vote yes, coordinator sends commit. Otherwise, sends abort.

**Problems:**
- Coordinator is a single point of failure
- Blocking: if coordinator crashes after prepare, participants are stuck holding locks
- Not tolerant of network partitions

### Saga Pattern

An alternative to 2PC for long-lived transactions across microservices. Instead of ACID across services, each step has a **compensating transaction** to undo it.

- **Choreography-based:** Each service publishes events. Next service listens and reacts. No central coordinator.
- **Orchestration-based:** A saga orchestrator tells each service what to do and handles failures.

**Example:** Book travel (flight + hotel + car). If car booking fails, cancel hotel and flight via compensating transactions.

---

## Clocks in Distributed Systems

Physical clocks drift. You cannot rely on wall clock time for ordering events across nodes.

### Logical Clocks (Lamport Timestamps)

- Each node maintains a counter
- Increment on every event
- On send: attach current counter
- On receive: `max(local, received) + 1`
- Establishes causal ordering. Doesn't tell you about concurrent events.

### Vector Clocks

- Each node maintains a vector of counters (one per node)
- Enables detecting concurrent events (neither happened-before the other)
- Used in Dynamo-style systems for conflict detection

### Hybrid Logical Clocks (HLC)

- Combines physical time with logical time
- Stays close to wall clock time while providing causal ordering
- Used in CockroachDB

---

## Key Interview / Design Questions to Practice

- Design a distributed key-value store
- How would you implement a distributed rate limiter?
- How do you handle split-brain in a leader election system?
- What happens to your system during a network partition?
- How do you ensure exactly-once delivery in a message queue?


---

## Related

[[Database Internals]]  [[Event-Driven Architecture]]
