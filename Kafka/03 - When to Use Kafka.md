# When to Use Kafka

## Message Queue vs Event Stream

Kafka can operate in two modes. The infrastructure is the same — the difference is in how you consume and retain data.

| | Message Queue | Event Stream |
|---|---|---|
| **Pattern** | Each message processed by one consumer group, then "done" | Log retained, multiple groups, replayable |
| **Delivery** | At-least-once to one consumer | Broadcast to all subscribed consumer groups |
| **Retention** | Until offset committed (logically consumed) | Time-based or size-based (default 7 days) |
| **Use case** | Async job processing | Real-time analytics, event sourcing, fanout |

---

## Use Kafka as a Message Queue When...

### 1. Processing Can Be Done Asynchronously

Decouple work that doesn't need to happen inline with the request.

**Example — YouTube Video Upload:**
```
User uploads video
       │
       ▼
Upload Service ──▶  Store raw video in S3
                ──▶  Put message on Kafka topic "video-uploaded"
                         { videoId, s3Key, userId }
                ──▶  Return 200 immediately (SD version available)

       (later, asynchronously)

Transcode Worker ──▶  Pull from "video-uploaded"
                 ──▶  Transcode to 720p, 1080p, 4K
                 ──▶  Store transcoded versions in S3
```

The producer (upload service) and consumer (transcoder) scale independently. A spike in uploads doesn't crash the transcoder — it just builds a queue.

### 2. You Need Ordered Processing

All messages with the same key land on the same partition and are processed in order.

**Example — Virtual Waiting Queue (Ticketmaster):**
```
User A arrives at 10:00:00 ──▶  Partition 3, offset 1000
User B arrives at 10:00:01 ──▶  Partition 3, offset 1001
User C arrives at 10:00:02 ──▶  Partition 3, offset 1002

Consumer processes in order:
  User A → let into booking page first ✓
  User B → second ✓
  User C → third ✓
```

### 3. Decoupling Producers from Consumers (Microservices)

A producer service can't take down a consumer service. The queue absorbs the difference in processing speeds.

```
Order Service (produces 10K orders/sec)
       │
       ▼
Kafka: "orders" topic
       │
       ├──▶  Inventory Service (processes 8K/sec — lagging, but catching up)
       ├──▶  Billing Service (processes 10K/sec)
       └──▶  Notifications Service (processes 9K/sec)
```

Without Kafka, a slow Inventory Service would back-pressure all the way to the Order Service.

---

## Use Kafka as a Stream When...

### 1. Continuous Real-Time Processing

Messages are processed as a flowing stream, not discrete jobs.

**Example — Ad Click Aggregator:**
```
User clicks on ad
       │
       ▼
Click Service ──▶  Kafka: "ad-clicks" topic
                     { adId, userId, timestamp, geoRegion }
                           │
                           ▼
              Stream Processor (Flink / Kafka Streams)
                  - Tumbling window: count clicks per ad per 1-minute window
                  - Output aggregated counts to "ad-click-counts" topic
                           │
                           ▼
              Dashboard / Billing Service
```

### 2. Multiple Consumers Need the Same Data (Pub/Sub)

Multiple independent consumer groups each read every message.

**Example — FB Live Comments:**
```
User posts comment
       │
       ▼
Kafka: "live-comments" topic (partitioned by stream_id)
       │
       ├──▶  Consumer Group "websocket-fanout"    (pushes to viewers via WebSocket)
       ├──▶  Consumer Group "moderation-service"  (checks for violations)
       └──▶  Consumer Group "analytics-pipeline"  (aggregates engagement metrics)
```

Each group gets every message independently. They maintain their own offsets.

### 3. Replayability / Audit Log

Since Kafka retains messages by time (not by consumption), you can replay history.

```
Event log: "user-actions" (retention: 30 days)

Today:   Replay last 24 hours to backfill new analytics feature
Tomorrow: Replay last 7 days to rebuild search index after corruption
Next week: Audit trail for compliance investigation
```

---

## Decision Checklist for Interviews

```
Do I need async processing?          → Yes → Kafka queue
Do I need ordering?                   → Yes → Kafka (partition by relevant key)
Do I need decoupling / buffering?     → Yes → Kafka queue
Do I need exactly-once + built-in DLQ? → Yes → Consider SQS instead
Do I need multiple consumers?         → Yes → Kafka stream (pub/sub)
Do I need real-time aggregation?      → Yes → Kafka stream + Flink
Do I need to replay events?           → Yes → Kafka stream (configure retention)
```

---

## When NOT to Use Kafka

| Situation | Better Alternative |
|---|---|
| You need built-in retry + DLQ | AWS SQS (Kafka has no native consumer retry) |
| Messages are large blobs (video, images) | Store in S3, put pointer in Kafka |
| Simple RPC / request-response | REST or gRPC directly |
| Low volume, simple queue | Redis Streams, SQS |
| Strong exactly-once without complex config | SQS FIFO |

### The Large Blob Anti-Pattern

```
❌ BAD:
Producer ──▶ Kafka message: { video: <100MB binary> }

✓ GOOD:
Upload ──▶ S3: s3://bucket/uploads/video-abc123.mp4
         ──▶ Kafka message: { videoId: "abc123", s3Key: "uploads/video-abc123.mp4" }
```

Kafka is optimized for small messages (< 1MB). Large payloads kill throughput and inflate memory pressure on brokers.

---

## Real Interview Examples

| Interview Problem | Kafka Role |
|---|---|
| YouTube | Queue for video transcoding jobs — message = S3 pointer to raw video |
| Ticketmaster | Virtual waiting queue — partition by user arrival token, FIFO |
| Ad Click Aggregator | Stream of click events — windowed aggregation per ad |
| FB Live Comments | Pub/sub for comment fanout — multiple consumer groups |
| Web Crawler | Queue for crawl jobs (but SQS may be preferred for built-in retry) |
| Uber | Stream of driver location events — real-time geospatial processing |
