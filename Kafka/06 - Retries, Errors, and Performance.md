# Retries, Errors, and Performance

## Producer Retries

Producers can fail to deliver messages due to network issues, broker unavailability, or transient failures. Kafka producers support automatic retries.

```javascript
const producer = kafka.producer({
  retry: {
    retries: 5,               // retry up to 5 times
    initialRetryTime: 100,    // wait 100ms before first retry
    factor: 0.2,              // exponential backoff multiplier
    maxRetryTime: 3000,       // max wait between retries = 3s
  },
  idempotent: true,           // IMPORTANT: prevents duplicates when retrying
})
```

### Why `idempotent: true` Matters

Without idempotency, this scenario creates a duplicate:

```
Producer sends message → network blip → producer retries → Kafka received both!
Result: message processed twice ← BAD

With idempotent=true:
Producer sends message → network blip → producer retries
Kafka deduplicates using producer ID + sequence number
Result: message stored exactly once ← GOOD
```

---

## Consumer Retries

**Kafka does NOT support consumer retries natively** (unlike AWS SQS which has built-in retry + DLQ). You must implement your own retry logic.

### The Dead Letter Queue (DLQ) Pattern

```
Main Topic: "orders"
     │
     ▼
Consumer Group "order-processor"
     │
     ├── Success → commit offset, continue
     │
     └── Failure →
              │
              ▼
         Retry Topic: "orders-retry-1"
              │
              ▼
         Retry Consumer (waits 30s, retries)
              │
              ├── Success → commit, done
              │
              └── Still failing →
                       │
                       ▼
                  Retry Topic: "orders-retry-2" (waits 5min)
                       │
                       ├── Success → done
                       │
                       └── Still failing →
                                │
                                ▼
                           DLQ: "orders-dead-letter"
                                (manual investigation)
```

### Implementation (KafkaJS)

```javascript
await consumer.run({
  eachMessage: async ({ topic, partition, message }) => {
    try {
      await processOrder(JSON.parse(message.value.toString()))
      // Success — offset auto-committed
    } catch (error) {
      const retryCount = parseInt(message.headers['retry-count'] || '0')
      
      if (retryCount < MAX_RETRIES) {
        // Send to retry topic with incremented counter
        await producer.send({
          topic: `orders-retry-${retryCount + 1}`,
          messages: [{
            key: message.key,
            value: message.value,
            headers: {
              ...message.headers,
              'retry-count': String(retryCount + 1),
              'original-topic': topic,
              'error': error.message,
            }
          }]
        })
      } else {
        // Exhausted retries → send to DLQ
        await producer.send({
          topic: 'orders-dead-letter',
          messages: [{ key: message.key, value: message.value, headers: message.headers }]
        })
      }
    }
  }
})
```

### When to Use SQS Instead

If your use case needs consumer retries and DLQ out of the box, **AWS SQS** is often a better choice:

| Feature | Kafka | SQS |
|---|---|---|
| Consumer retries | Manual implementation | Built-in (visibility timeout) |
| DLQ | Manual implementation | Built-in |
| Ordering | Strong (per-partition) | FIFO queues only |
| Throughput | Very high | High (but lower than Kafka) |
| Replay | Yes | No |
| Multiple consumers (same data) | Yes (consumer groups) | No |

> The Web Crawler example from Hello Interview opts for SQS over Kafka specifically to get built-in retry + DLQ without implementation overhead.

---

## Performance Optimizations

### 1. Batching Messages

Group multiple messages into one network call. Kafka producers do this automatically, but you can also do it explicitly.

```javascript
// Send multiple messages in one call (reduces network round-trips)
await producer.send({
  topic: 'my_topic',
  messages: [
    { key: 'key1', value: 'message1' },
    { key: 'key2', value: 'message2' },
    { key: 'key3', value: 'message3' },
    // ...
  ],
})

// sendBatch: send to multiple topics in one call
await producer.sendBatch({
  topicMessages: [
    { topic: 'topic-a', messages: [{ value: 'msg1' }] },
    { topic: 'topic-b', messages: [{ value: 'msg2' }] },
  ]
})
```

**Producer batching config:**

```javascript
const producer = kafka.producer({
  batch: {
    size: 16384,         // batch size in bytes (16KB default)
    lingerMs: 5,         // wait up to 5ms to accumulate a larger batch
  }
})
```

### 2. Message Compression

Compress batches before sending over the network. Smaller payloads = faster transfers.

```javascript
const { CompressionTypes } = require('kafkajs')

await producer.send({
  topic: 'my_topic',
  compression: CompressionTypes.GZIP,    // or SNAPPY, LZ4, ZSTD
  messages: [
    { key: 'key1', value: JSON.stringify(largeObject) },
  ],
})
```

| Algorithm | Speed | Compression Ratio | Best For |
|---|---|---|---|
| **GZIP** | Slow | Best | Storage-critical, low-volume |
| **Snappy** | Fast | Good | General purpose |
| **LZ4** | Fastest | Moderate | Latency-sensitive, high-volume |
| **ZSTD** | Fast | Best-in-class | Modern systems (Kafka 2.1+) |

### 3. Consumer Throughput

```javascript
// Process multiple messages concurrently within a batch
await consumer.run({
  eachBatch: async ({ batch, heartbeat }) => {
    const promises = batch.messages.map(async (message) => {
      await processMessage(message)
    })
    await Promise.all(promises)
    await heartbeat()  // prevent session timeout during processing
  }
})
```

```javascript
// Tune fetch size — pull more data per request
const consumer = kafka.consumer({
  groupId: 'my-group',
  maxBytesPerPartition: 1048576,  // 1MB per partition per fetch
  minBytes: 1,                     // fetch as soon as 1 byte available
  maxWaitTimeInMs: 100,            // or wait 100ms for more data
})
```

### 4. Partitioning for Parallelism

The most impactful performance lever.

```
10 partitions + 10 consumers = 10x parallelism
vs.
1 partition + 10 consumers = 1x parallelism (9 consumers idle)
```

**Always ensure:**
```
num_partitions >= num_consumers (in consumer group)
```

---

## Retention Policies

Kafka retains messages on disk according to configurable policies.

### Time-Based Retention

```bash
# Keep messages for 7 days (default)
kafka-configs --alter \
  --topic my-topic \
  --add-config retention.ms=604800000  # 7 days in ms

# Keep messages for 1 hour (for high-volume topics)
--add-config retention.ms=3600000

# Keep forever (use with caution!)
--add-config retention.ms=-1
```

### Size-Based Retention

```bash
# Keep at most 1GB per partition
--add-config retention.bytes=1073741824
```

### Log Compaction (Special Case)

Instead of deleting old messages by time/size, keep only the **latest value per key**.

```
Key="user-123" timeline:
  offset 0: { name: "Alice", email: "old@email.com" }
  offset 5: { name: "Alice", email: "alice@gmail.com" }
  offset 12: { name: "Alice Chen", email: "alice@gmail.com" }

After compaction:
  Only offset 12 remains (latest state for key "user-123")
```

**Use log compaction for:**
- Event sourcing / CQRS (latest state per entity)
- Configuration topics (latest config per service)
- User profile topics (latest profile per user ID)

```bash
# Enable log compaction
--add-config cleanup.policy=compact

# Or time + compaction hybrid
--add-config cleanup.policy=compact,delete
--add-config retention.ms=604800000
--add-config min.compaction.lag.ms=3600000  # wait 1hr before compacting
```

---

## Throughput Estimation (Interview Math)

```
Given:
  - 500 producers sending 1,000 messages/sec each
  - Average message size: 500 bytes
  - Replication factor: 3

Ingestion rate:
  500 × 1,000 = 500,000 msg/sec = 500K msg/sec
  500K × 500B = 250 MB/sec incoming

Network load (with replication):
  250 MB/sec × 3 replicas = 750 MB/sec total network I/O

Partitions needed (at 50MB/sec per partition):
  250 MB/sec / 50 MB/sec = 5 partitions minimum
  Recommended: 10–20 partitions for headroom

Storage (7-day retention):
  250 MB/sec × 3 replicas × 86400 sec/day × 7 days = ~450 TB
  Per broker (10 brokers): 45 TB each
```


---

## Related

[[05 - Fault Tolerance and Durability]]  [[07 - Kafka for System Design Interviews]]
