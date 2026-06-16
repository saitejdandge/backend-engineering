# How Kafka Works

## Message Structure

A Kafka message (also called a **record**) has four fields — all technically optional:

| Field | Purpose | Notes |
|---|---|---|
| **Value** | The payload | The actual data |
| **Key** | Determines which partition | Same key → same partition → ordering guaranteed |
| **Timestamp** | When message was created/ingested | Ordering within partition is by **offset**, not timestamp |
| **Headers** | Key-value metadata | Like HTTP headers — trace IDs, content type, etc. |

```
┌─────────────────────────────────────────────-┐
│                 Kafka Record                 │
│  ┌──────────┬────────┬───────────┬────────┐  │
│  │   Key    │ Value  │ Timestamp │Headers │  │
│  │ "game-5" │{...}   │ 1700000000│ {...}  │  │
│  └──────────┴────────┴───────────┴────────┘  │
└──────────────────────────────────────────-───┘
```

---

## Publishing a Message — Step by Step

When a producer sends a message:

### Step 1: Partition Determination

Kafka hashes the message key to assign it to a partition:

```
partition = hash(key) % num_partitions
```

- **With a key:** Same key always → same partition (ordering preserved for that key)
- **Without a key:** Modern Kafka clients use a **sticky partitioner** — batches messages to one partition, then rotates. Roughly even distribution over time, but no ordering guarantee.

### Step 2: Broker Assignment

Once the partition is determined, Kafka identifies which broker holds that partition's **leader replica** via cluster metadata. The producer sends directly to that broker.

```
Producer ──[message with key="game-5"]──▶

  1. hash("game-5") % 3 = partition 2
  2. Partition 2 leader = Broker 1
  3. Send to Broker 1:Partition2

Broker 1 ──[replicate]──▶ Broker 2 (follower)
         ──[replicate]──▶ Broker 3 (follower)
```

---

## The Append-Only Log

Each partition is an **append-only log file**. Messages are written sequentially at the end. They are never modified in-place.

```
Partition 2 on Broker 1:

Offset:  0       1       2       3       4
       ┌─────┬───────┬───────┬───────┬───────┐
       │ msg │  msg  │  msg  │  msg  │  msg  │ ← new messages appended here
       └─────┴───────┴───────┴───────┴───────┘
                                              ↑
                                        next write
```

### Why Append-Only?

- **Immutability:** Messages never change → simpler replication, no consistency bugs
- **Efficiency:** Sequential writes minimize disk seek times (major bottleneck in storage)
- **Scalability:** Simple to replicate, easy to add partitions

---

## Replication — Leader/Follower Model

Each partition has one **leader replica** and N **follower replicas** on different brokers.

```
                    ┌────────────────────────────────────────┐
                    │         Replication for Partition 2    │
                    │                                        │
Producer ──writes──▶│  Broker 1: Partition 2 (LEADER)        │
                    │  ┌──────────────────────────────────┐  │
                    │  │ offset 0 │ offset 1 │ offset 2   │  │
                    │  └──────────────────────────────────┘  │
                    │         │ replicate                    │
                    │         ▼                              │
                    │  Broker 2: Partition 2 (FOLLOWER)      │
                    │  Broker 3: Partition 2 (FOLLOWER)      │
                    └────────────────────────────────────────┘
```

- **Leader** handles all writes (and reads by default, though Kafka 2.4+ allows follower reads)
- **Followers** passively replicate from leader — act as hot standbys
- **ISR (In-Sync Replicas):** Followers that are fully caught up. If the leader dies, a new leader is elected from the ISR

### Producer Acknowledgments (acks setting)

| Setting | Behavior | Durability |
|---|---|---|
| `acks=0` | Fire and forget — no wait | Lowest (can lose messages) |
| `acks=1` | Wait for leader ACK | Medium (lose if leader crashes before replication) |
| `acks=all` | Wait for all ISR ACKs | Highest — use this for critical data |

---

## Consuming Messages — Pull Model

Kafka consumers **pull** data from brokers. Consumers actively poll for new messages at intervals they control.

Why pull vs push?
- Consumers control their own pace — no overwhelming slow consumers
- Efficient batching — pull when ready, get many at once
- Simpler failure handling

### Offset Tracking

Each consumer tracks its position in each partition using an **offset**.

```
Partition 2:
Offset:  0       1       2       3       4       5
       ┌─────┬───────┬───────┬───────┬───────┬───────┐
       │ msg │  msg  │  msg  │  msg  │  msg  │  msg  │
       └─────┴───────┴───────┴───────┴───────┴───────┘
                                       ↑
                              Consumer committed here
                              (last processed = offset 3)
                              Next poll starts at offset 4
```

- Consumers **commit** offsets back to Kafka periodically
- On restart, consumer reads its last committed offset and resumes
- This is **at-least-once delivery** by default — if a consumer crashes before committing, it reprocesses the last message

> **Exactly-once semantics** are possible but require additional configuration: idempotent producers + transactional APIs.

---

## Consumer Groups and Partition Assignment

Within a consumer group, each partition is assigned to **exactly one consumer**.

```
Topic: "soccer" — 6 partitions, Consumer Group: "website-updaters" — 3 consumers

Partition 0 ──▶ Consumer A
Partition 1 ──▶ Consumer A
Partition 2 ──▶ Consumer B
Partition 3 ──▶ Consumer B
Partition 4 ──▶ Consumer C
Partition 5 ──▶ Consumer C
```

Rules:
- **More consumers than partitions:** Some consumers are idle
- **More partitions than consumers:** Some consumers handle multiple partitions
- **Optimal:** num_consumers = num_partitions (maximum parallelism)

### Rebalancing

When a consumer joins or leaves the group, Kafka **rebalances** — redistributes partition assignments among the active consumers. During rebalance, consumption pauses briefly.

---

## Code Examples

### Producer (Node.js / KafkaJS)

```javascript
const kafka = new Kafka({
  clientId: 'my-app',
  brokers: ['localhost:9092']
})

const producer = kafka.producer()
await producer.connect()

await producer.send({
  topic: 'my_topic',
  messages: [
    { key: 'game-5', value: JSON.stringify({ event: 'goal', player: 'Messi' }) },
    { key: 'game-7', value: JSON.stringify({ event: 'yellow_card', player: 'Ronaldo' }) }
  ],
})
```

### Consumer (Node.js / KafkaJS)

```javascript
const consumer = kafka.consumer({ groupId: 'website-updaters' })
await consumer.connect()
await consumer.subscribe({ topic: 'my_topic' })

await consumer.run({
  eachMessage: async ({ topic, partition, message }) => {
    const event = JSON.parse(message.value.toString())
    const key = message.key.toString()
    console.log(`Partition ${partition}, offset ${message.offset}: [${key}]`, event)
    // Offset is auto-committed after this handler returns
  },
})
```

### CLI Quick Reference

```bash
# Produce messages with keys
kafka-console-producer \
  --bootstrap-server localhost:9092 \
  --topic my_topic \
  --property "parse.key=true" \
  --property "key.separator=:"
> game-5: {"event":"goal","player":"Messi"}

# Consume from beginning
kafka-console-consumer \
  --bootstrap-server localhost:9092 \
  --topic my_topic \
  --from-beginning \
  --property print.key=true \
  --property "key.separator=: "
```

---

## End-to-End Flow Summary

```
Producer
  │
  │  1. Format message (key, value, headers, timestamp)
  │  2. Hash key → determine partition
  │  3. Find broker hosting partition leader
  │  4. Send message to leader broker
  ▼
Leader Broker (Partition P on Broker B)
  │
  │  5. Append message to partition log at next offset
  │  6. Replicate to follower brokers (ISR)
  │  7. ACK producer (depending on acks setting)
  ▼
Follower Brokers (ISR)
  │
  │  8. Sync from leader continuously
  ▼
Consumer (in Consumer Group)
  │
  │  9.  Poll broker for new messages (pull model)
  │  10. Process message
  │  11. Commit offset back to Kafka
  └──▶ Repeat from step 9
```
