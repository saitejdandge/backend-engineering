# Kafka for System Design Interviews

## What Level of Knowledge Do You Need?

| Level | What to Know |
|---|---|
| **Junior / Mid** | Basic concepts: topics, partitions, producers, consumers, consumer groups, offsets. When to use Kafka. |
| **Senior** | Partitioning strategy, hot partitions, fault tolerance, consumer failure handling, offset commit timing |
| **Staff+** | All of the above + retention policies, exactly-once semantics, Kafka Streams / Flink integration, managed services trade-offs, throughput estimation |

---

## The Interview Cheat Sheet

### 1. Sizing Estimate First

Before designing, ask: do I even need to worry about scale?

```
Single broker: ~1M msg/sec, ~1TB storage

Your system:
  - How many producers? How often do they produce?
  - Average message size?
  - How long to retain?
  
If single broker handles it → scaling isn't the conversation
If you exceed limits → add brokers + partition strategy
```

### 2. Start with Partitioning Strategy

This is what interviewers want to hear. Not just "I'll use Kafka" but "I'll partition by X because Y."

```
Good answer:
"I'll partition the events by user_id. This ensures all events for a 
given user land on the same partition, guaranteeing ordering per user. 
Since user IDs are uniformly distributed (UUIDs / sequential IDs with 
good hash distribution), we avoid hot partitions."

Bad answer:
"I'll just use Kafka with default settings."
```

### 3. Address Hot Partitions Proactively

If your partition key could create skew, bring it up before the interviewer does.

```
"One concern with partitioning by ad_id is that popular ads could create 
hot partitions. I'd handle this with random salting — appending a random 
suffix 0-9 to the ad_id to spread load across 10x more partitions. The 
consumer then aggregates across all suffixed partitions."
```

### 4. Consumer Failure Story

Always have an answer for "what happens when your consumer fails?"

```
"Consumers commit offsets to Kafka after processing. If a consumer crashes,
it resumes from its last committed offset on restart. This gives at-least-once 
delivery — the last message may be reprocessed. I'll make my consumer idempotent
by checking a deduplicated message ID in Redis before processing."
```

### 5. Kafka vs SQS Trade-off

Know when to choose SQS over Kafka:

```
Kafka: replay, high throughput, multiple consumer groups, ordering
SQS: built-in retry + DLQ, simpler ops, good enough for simple async queues

Web Crawler → SQS (built-in retry is more important than replay)
Ad Aggregator → Kafka (high throughput stream, need replay for backfill)
```

---

## Common Interview Scenarios

### Scenario 1: Video Transcoding (YouTube)

```
Problem: After upload, transcode video to multiple resolutions asynchronously.

Kafka role: Queue for transcoding jobs

Partitioning: by video_id (ordering doesn't matter much here, but groups
related events: upload, transcode-start, transcode-complete)

Key design choices:
  - Message = { videoId, s3Key, userId } NOT the video binary (anti-pattern!)
  - Consumer: transcode worker pool (5-10 workers per partition)
  - On consumer failure: restart from last committed offset, idempotent retry
```

### Scenario 2: Virtual Waiting Room (Ticketmaster)

```
Problem: Allow users into booking page in arrival order.

Kafka role: Ordered queue by arrival time

Partitioning: single partition (guarantees global FIFO) or by event_id
(parallel waiting rooms per event, ordered per event)

Key design choices:
  - Key = event_id (all waiting users for one concert on same partition)
  - Offset position = queue position
  - Consumer reads N users at a time, issues booking tokens
```

### Scenario 3: Ad Click Aggregation

```
Problem: Aggregate click counts per ad in real-time windows.

Kafka role: Event stream for click events

Partitioning: by ad_id (orders clicks per ad) — with hot partition mitigation

Key design choices:
  - Hot partition risk: viral ads → use salting or compound key
  - Consumer: Flink or Kafka Streams for windowed aggregation
  - Multiple consumer groups: billing, analytics, fraud detection
    all read the same stream independently
```

### Scenario 4: FB Live Comments

```
Problem: Distribute comments to all viewers of a live stream in real-time.

Kafka role: Pub/sub fanout

Partitioning: by stream_id (all comments for one stream on same partition,
preserving comment ordering)

Key design choices:
  - Multiple consumer groups: websocket fanout, moderation, analytics
  - Each group independently reads every comment
  - WebSocket servers as consumers (one per server, partition-per-server)
```

---

## Architecture Patterns with Kafka

### Pattern 1: Simple Async Queue

```
┌──────────────┐      ┌────────────────┐      ┌──────────────────┐
│   Producer   │─────▶│  Kafka Topic   │─────▶│   Consumer Pool  │
│ (API Server) │      │ (partitioned   │      │ (Worker Servers) │
└──────────────┘      │  by job_type)  │      └──────────────────┘
                      └────────────────┘
```

### Pattern 2: Fan-out to Multiple Services

```
                            ┌──▶ Consumer Group A (Billing)
                            │
Event Producer ──▶ Kafka ──▶├──▶ Consumer Group B (Notifications)
                            │
                            └──▶ Consumer Group C (Analytics)
```

### Pattern 3: Stream Processing Pipeline

```
Raw Events ──▶ Kafka (raw) ──▶ Flink/KStreams ──▶ Kafka (enriched) ──▶ Sink
                                 (filter, join,
                                  aggregate,
                                  window)
```

### Pattern 4: Event Sourcing + CQRS

```
Commands ──▶ Command Handler ──▶ Kafka (events, log compaction) ──▶ Read Model Builder
                                                                    (materialized views)
                                          │
                                          └──▶ Audit / Replay / Recompute
```

---

## Key Numbers to Memorize

| Metric | Value |
|---|---|
| Max message size (recommended) | < 1MB |
| Max throughput per broker | ~1M msg/sec |
| Max storage per broker | ~1TB |
| Typical replication factor | 3 |
| Default retention | 7 days |
| Added latency | ~0.1–0.5ms |
| Typical partition count | 10–200 per topic |

---

## Summary

**What Kafka is:** Distributed append-only log, used as message queue or event stream.

**Core concepts to always mention:**
1. Topics → logical grouping
2. Partitions → unit of parallelism and ordering
3. Consumer groups → each partition to one consumer
4. Offsets → how consumers track progress, how recovery works

**The main interview question:** "How do you partition your data?"
- Choose a key with even hash distribution
- Same key = same partition = ordering guaranteed
- Watch for hot partitions on high-cardinality skewed data

**Kafka vs SQS one-liner:** "Kafka for high throughput, replay, and multiple consumers. SQS for simple async queues with built-in retry and DLQ."

**Consumer failure one-liner:** "At-least-once delivery via offset commits. Make consumers idempotent."
