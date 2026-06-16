# What is Kafka

Apache Kafka is an open-source distributed event streaming platform that can be used either as a **message queue** or as a **stream processing system**. It's engineered to handle vast volumes of data in real-time, and when configured properly (with appropriate replication and acknowledgment settings), it can provide strong guarantees against message loss.

> According to Kafka's website, it's used by **80% of the Fortune 100**.

---

## A Motivating Example

Imagine a World Cup website providing real-time match statistics. Each time a goal is scored, a player is booked, or a substitution is made, the site must update instantly.

### Step 1 — Basic Queue

Events are placed on a queue when they occur. The server that puts events on the queue is the **producer**. The server that reads events and updates the website is the **consumer**.

```
                  ┌─────────────────────────┐
Goal Scored  ───▶ │                         │ ───▶  Consumer
Player Booked───▶ │         Queue           │       (updates website)
Sub Made     ───▶ │                         │
                  └─────────────────────────┘
```

### Step 2 — The Scale Problem

Expand the World Cup to 1,000 teams playing simultaneously. One queue server can't keep up. We need to distribute the queue across multiple servers.

**Problem:** If we randomly distribute events, a goal for Game 5 might be processed before kick-off. Order is lost.

```
Event A (Game 5) ──▶  Server 1  ──▶  Consumer 1
Event B (Game 5) ──▶  Server 2  ──▶  Consumer 2   ← ORDERING BROKEN
Event C (Game 5) ──▶  Server 3  ──▶  Consumer 3
```

### Step 3 — Partitioning by Key

Distribute events based on the game they belong to. All events for Game 5 → same partition → processed in order.

```
Game 1 events ──▶  Partition 1  ──▶  Consumer A
Game 2 events ──▶  Partition 2  ──▶  Consumer B
Game 5 events ──▶  Partition 3  ──▶  Consumer C   ← ORDER PRESERVED
```

This is one of Kafka's fundamental ideas: **messages are distributed across partitions using a partitioning strategy based on a key**.

### Step 4 — Consumer Groups

Consumers are overwhelmed. Add more consumers — but each event should only be processed once. Solution: **consumer groups**.

With a consumer group, each partition is assigned to exactly one consumer in the group. Under normal operation, each event is delivered to a single consumer.

```
Partition 1 ──▶ Consumer A ─┐
Partition 2 ──▶ Consumer B  ├── Consumer Group "website-updaters"
Partition 3 ──▶ Consumer C ─┘
```

> Kafka's default is **at-least-once** semantics — in failure scenarios a message could be reprocessed, but it won't be split across consumers.

### Step 5 — Topics

Expand to basketball too. Soccer consumers shouldn't see basketball events and vice versa. Solution: **topics**.

```
Soccer Events ──▶  Topic: "soccer"  ──▶  Soccer Website Consumer Group
Basketball Events ──▶  Topic: "basketball"  ──▶  Basketball Website Consumer Group
```

---

## Core Terminology

| Term | Definition |
|---|---|
| **Broker** | An individual Kafka server (physical or virtual). Stores data and serves clients. |
| **Partition** | An ordered, immutable append-only sequence of messages on a broker. The unit of parallelism. |
| **Topic** | A logical grouping of partitions. You publish to a topic, consume from a topic. |
| **Producer** | A client that writes messages to a topic. |
| **Consumer** | A client that reads messages from a topic. |
| **Consumer Group** | A group of consumers where each partition is assigned to exactly one consumer. |
| **Offset** | A unique sequential ID for each message within a partition. Consumers track progress via offsets. |
| **Replication Factor** | How many copies of each partition exist across brokers for fault tolerance. |
| **ISR** | In-Sync Replicas — the set of replicas fully caught up with the partition leader. |

### Topic vs Partition

| | Topic | Partition |
|---|---|---|
| Nature | Logical grouping | Physical storage unit |
| Purpose | Organize data | Scale and parallelize data |
| Location | Spans many brokers | Resides on one broker (replicated) |

---

## Message vs Stream

Kafka can operate in two modes:

| Mode | Pattern | Retention | Use Case |
|---|---|---|---|
| **Message Queue** | Each message processed by one consumer, then "consumed" | Offset-based | Async job processing, task queues |
| **Stream** | Log retained, multiple consumer groups, replayable | Time/size-based | Real-time processing, event sourcing, analytics |

The distinction is minor at the infrastructure level — both use offset commits. The difference is in the **consumption pattern** and whether you replay the log.

---

## Full Architecture Picture

```
                          Kafka Cluster
  ┌─────────────────────────────────────────────────────────┐
  │                                                         │
  │  Broker 1              Broker 2              Broker 3   │
  │  ┌──────────────┐      ┌──────────────┐      ┌───────┐  │
  │  │ Topic A - P0 │      │ Topic A - P1 │      │ T-A   │  │
  │  │ (leader)     │      │ (leader)     │      │  P2   │  │
  │  │              │      │              │      │       │  │
  │  │ Topic B - P0 │      │ Topic B - P1 │      │ T-B   │  │
  │  │ (follower)   │      │ (leader)     │      │  P0   │  │
  │  └──────────────┘      └──────────────┘      └───────┘  │
  └─────────────────────────────────────────────────────────┘
          ▲                        ▲
          │                        │
     Producer A               Producer B
     (writes to Topic A)      (writes to Topic B)
          │                        │
     Consumer Group 1          Consumer Group 2
     (reads Topic A)           (reads Topic B)
```

---

## Kafka vs Traditional Message Queues

| Feature | Kafka | RabbitMQ / SQS |
|---|---|---|
| Message retention | Configurable (days/weeks) | Deleted after consumption |
| Replay | Yes — rewind offsets | No |
| Ordering | Per-partition | Per-queue (SQS FIFO) |
| Multiple consumers | Multiple groups, same data | Competing consumers |
| Throughput | Very high (1M+ msg/sec) | Moderate |
| Built-in retry | No (must implement) | Yes (SQS DLQ built-in) |
| Best for | Streams, event sourcing, high throughput | Simple async queues, built-in retry |
