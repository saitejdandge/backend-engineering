# Fault Tolerance and Durability

## "Kafka is Always Available, Sometimes Consistent"

This is a common saying in the Kafka world. Kafka is designed to be **always available** — a single broker failure does not take down the cluster. The more realistic failure scenario to design around is a **consumer going down**, not Kafka itself.

> In an interview, if asked "what happens if Kafka goes down?" — gently push back. The more realistic question is "what happens if a consumer fails?"

---

## Durability — How Kafka Protects Your Data

### Replication

Every partition has one leader and N followers across different brokers.

```
Replication Factor = 3:

Broker 1: Partition 0 (LEADER)    ← all writes go here
Broker 2: Partition 0 (FOLLOWER)  ← syncs from leader
Broker 3: Partition 0 (FOLLOWER)  ← syncs from leader

If Broker 1 fails:
  → Controller detects failure
  → Elects new leader from ISR (e.g., Broker 2)
  → Broker 3 now syncs from Broker 2
  → Producers/consumers redirect to new leader
  → Downtime: seconds
```

### In-Sync Replicas (ISR)

The ISR is the set of replicas that are fully caught up with the leader.

```
Leader offset: 1000
Broker 2 synced to offset: 1000 → IN ISR ✓
Broker 3 synced to offset: 995  → LAGGING → removed from ISR temporarily
```

When `acks=all`, the producer only gets an ACK after **all ISR replicas** have written the message. This is the strongest durability guarantee.

### Producer Acknowledgment Settings

```javascript
// acks=0: Fire and forget (fastest, highest risk)
producer.send({ topic: 'events', messages: [...] })
// → no wait for any ACK, messages can be lost silently

// acks=1: Wait for leader ACK (default)
// → safe as long as leader doesn't crash before replication

// acks=all (or -1): Wait for all ISR ACKs (strongest)
// → guaranteed durable even if leader crashes immediately after
const producer = kafka.producer({
  producerConfig: { 'acks': 'all' }
})
```

| Setting | Risk | Latency |
|---|---|---|
| `acks=0` | Can lose messages | Lowest |
| `acks=1` | Loses messages if leader crashes pre-replication | Low |
| `acks=all` | No data loss (unless entire ISR fails) | Higher |

---

## What Happens When a Consumer Goes Down

This is the most realistic failure scenario.

### Scenario

```
Consumer A is processing messages from Partition 0.
It processed offset 50 and committed.
It processes offset 51 and CRASHES before committing.
```

### Recovery via Offset Management

```
Kafka stores committed offsets in an internal topic: __consumer_offsets

Consumer A restarts:
  1. Reads last committed offset from Kafka → offset 50
  2. Resumes polling from offset 51
  3. Reprocesses offset 51 (at-least-once delivery)

Offset 51 is processed again — this is expected behavior.
```

### At-Least-Once vs Exactly-Once

| Semantic | How | Risk |
|---|---|---|
| **At-least-once** (default) | Commit offset after processing | Message reprocessed on crash — must make consumers idempotent |
| **At-most-once** | Commit offset before processing | Message can be lost if consumer crashes mid-processing |
| **Exactly-once** | Idempotent producer + transactional API | Complex config, performance cost |

**Making consumers idempotent (practical approach):**

```kotlin
// Pattern: use a unique message ID + idempotency check
fun processEvent(event: ClickEvent) {
    if (eventRepository.exists(event.eventId)) {
        return  // already processed, skip
    }
    // process...
    eventRepository.markProcessed(event.eventId)
}
```

### Consumer Group Rebalancing on Failure

```
Before failure (3 consumers, 6 partitions):
  Consumer A → P0, P1
  Consumer B → P2, P3
  Consumer C → P4, P5

Consumer B crashes:

Rebalancing triggered:
  Consumer A → P0, P1, P2, P3  ← takes over B's partitions
  Consumer C → P4, P5

During rebalancing: consumption pauses briefly
After rebalancing: all partitions are being consumed again
```

---

## The Offset Commit Timing Trade-off

**When to commit offsets** is a critical design decision. Too early = data loss. Too late = redundant work.

### The Web Crawler Example

```
Web Crawler consumes URLs from Kafka, downloads HTML, stores in S3.

Option A: Commit offset before storing to S3
  → If crash happens between commit and S3 write: URL never crawled ← data loss!

Option B: Commit offset after storing to S3
  → If crash happens between S3 write and offset commit: URL crawled twice ← wasted work (but idempotent)

Correct choice: Option B (at-least-once, idempotent re-processing)
```

### General Principle

The more work a consumer does per message, the more expensive a reprocessing is. **Keep consumer work small and fast.** Break complex pipelines into multiple consumer stages:

```
Stage 1 Consumer: Download HTML → store in S3 → commit offset
Stage 2 Consumer: Parse HTML from S3 → extract links → commit offset
Stage 3 Consumer: Deduplicate links → enqueue new URLs → commit offset
```

Each stage is fast, and failures only force a retry of that one small stage.

---

## Configuring Replication Factor

```sql
-- Create topic with replication factor 3
kafka-topics --create \
  --bootstrap-server localhost:9092 \
  --topic critical-events \
  --partitions 6 \
  --replication-factor 3

-- Verify
kafka-topics --describe \
  --bootstrap-server localhost:9092 \
  --topic critical-events
```

Production recommendations:
- **Critical data** (payments, orders): replication factor = 3, `acks=all`
- **Analytics / logs**: replication factor = 2, `acks=1` (some loss acceptable)
- **Dev/test**: replication factor = 1 (no redundancy needed)

---

## Broker Failure Recovery

```
Normal state (3 brokers, Partition 0):
  Broker 1 (LEADER)  ← serving reads/writes
  Broker 2 (ISR)     ← synced
  Broker 3 (ISR)     ← synced

Broker 1 fails:

  Controller detects failure via heartbeat timeout
  Elects Broker 2 as new leader (it's in ISR)
  Updates cluster metadata
  Producers/consumers reconnect to Broker 2

Broker 1 recovers:
  Rejoins as follower (not automatically leader)
  Syncs catch-up from Broker 2
  Re-enters ISR
  May become leader again via preferred leader election
```

**Recovery time:** Typically 5–30 seconds depending on detection timeout settings.

---

## Monitoring Fault Tolerance Health

```sql
-- Check ISR size (should equal replication factor)
kafka-topics --describe --topic my-topic
-- Look for: Isr: 1,2,3  ← all 3 brokers in ISR
-- Bad sign: Isr: 1       ← only leader in ISR, followers lagging

-- Check under-replicated partitions (should be 0)
kafka-topics --describe --under-replicated-partitions

-- Consumer lag (how far behind consumers are)
kafka-consumer-groups \
  --bootstrap-server localhost:9092 \
  --describe \
  --group my-consumer-group
-- Look for LAG column — sustained high lag = consumer falling behind
```

**Key alerts to set:**
- `UnderReplicatedPartitions > 0` → broker health issue
- `Consumer lag > threshold` → consumer too slow or crashing
- `OfflinePartitionsCount > 0` → critical — partitions unavailable
