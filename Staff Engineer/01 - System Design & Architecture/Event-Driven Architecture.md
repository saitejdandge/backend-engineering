# Event-Driven Architecture

## Core Concepts

Event-driven architecture (EDA) is a design paradigm where components communicate by producing and consuming events rather than making direct calls to each other.

**Event:** An immutable record of something that happened. Past tense. "OrderPlaced", not "PlaceOrder".

Three patterns of event use:
- **Event Notification:** Tells other systems something happened. Minimal data. Consumer calls back for details.
- **Event-Carried State Transfer:** Event carries all the data the consumer needs. No need to call back.
- **Event Sourcing:** The event log IS the source of truth. State is derived by replaying events.

---

## Message Brokers

### Apache Kafka

Kafka is a distributed, append-only, partitioned commit log. Not a traditional message queue.

**Core Concepts:**
- **Topic:** A named stream of events. Divided into partitions.
- **Partition:** Ordered, immutable sequence of records. Unit of parallelism.
- **Offset:** Position of a record within a partition. Consumers track their own offset.
- **Consumer Group:** Multiple consumers sharing partitions. Each partition assigned to one consumer at a time. Enables parallel consumption.
- **Retention:** Messages retained for a configurable duration (default: 7 days). Not deleted on consumption.
- **Broker:** A Kafka server. A cluster has multiple brokers.
- **Replication Factor:** Each partition is replicated across N brokers. ISR (In-Sync Replicas) are replicas fully caught up.

**Producer guarantees:**
- `acks=0`: Fire-and-forget. No durability guarantee.
- `acks=1`: Leader acknowledges. Lost if leader crashes before replication.
- `acks=all`: All ISRs acknowledge. Strongest durability. Higher latency.

**Consumer guarantees:**
- **At-most-once:** Commit offset before processing. Can lose messages on failure.
- **At-least-once:** Commit offset after processing. Can duplicate messages on failure. Most common.
- **Exactly-once:** Use Kafka transactions + idempotent processing. Complex but achievable.

**Ordering:**
- Ordering is guaranteed within a partition.
- No global ordering across partitions.
- Use a consistent partition key (e.g., `user_id`) to ensure all events for an entity go to the same partition.

**When to use Kafka:**
- High-throughput event streaming (millions of events/sec)
- Event replay (consumers can re-read from any offset)
- Multiple independent consumers of the same event stream
- Change Data Capture (CDC) pipelines
- Activity tracking, audit logs

### AWS SQS / RabbitMQ (Traditional Message Queues)

Unlike Kafka, traditional queues are destructive: messages are deleted after consumption.

**SQS:**
- Fully managed, no ops
- Standard queue: at-least-once, best-effort ordering
- FIFO queue: exactly-once, strict ordering (lower throughput)
- Dead Letter Queue (DLQ): Failed messages moved here after N retries
- Visibility timeout: After a consumer picks a message, it's hidden from others for N seconds. If not deleted within that time, it re-appears.

**When to use SQS:**
- Simple work queues (job processing, background tasks)
- When you don't need event replay
- AWS-native stacks

**RabbitMQ:**
- AMQP protocol
- Exchanges + bindings + queues routing model
- More complex routing (fanout, topic, direct, headers)
- Better when you need complex routing rules

---

## Kafka Design Patterns

### Outbox Pattern

Problem: How do you atomically update the DB and publish an event? (Two-phase commit with Kafka is complex)

Solution: Write the event to an `outbox` table in the same DB transaction as the business data. A separate relay process reads the outbox and publishes to Kafka. Once published, mark as sent.

```sql
BEGIN;
  INSERT INTO orders (id, user_id, status) VALUES (...);
  INSERT INTO outbox (aggregate_id, event_type, payload)
    VALUES (order_id, 'OrderPlaced', '{"orderId": ...}');
COMMIT;
-- Relay process reads outbox and publishes to Kafka
```

Tools: Debezium (reads DB WAL and publishes changes to Kafka, making outbox pattern transparent).

### Saga Orchestration via Kafka

Each step of a saga publishes an event. The next service listens and either proceeds or triggers compensation.

```
OrderService → [OrderPlaced] →
  PaymentService → [PaymentProcessed] →
    InventoryService → [InventoryReserved] →
      ShippingService → [ShipmentScheduled]

If PaymentFailed:
  PaymentService → [PaymentFailed] →
    OrderService → [OrderCancelled]
```

### CQRS (Command Query Responsibility Segregation)

Separate the write model (commands) from the read model (queries).

- **Write side:** Accepts commands, validates, updates the aggregate, publishes events
- **Read side:** Listens to events, builds denormalized read models optimized for queries

Benefits:
- Read and write models can scale independently
- Read models can be optimized per use case (e.g., Elasticsearch for search, Redis for fast lookups)
- Read models are eventually consistent with the write model

### Event Sourcing

Instead of storing current state, store a log of all events. Current state is derived by replaying events.

```
Events: [AccountOpened, MoneyDeposited(100), MoneyWithdrawn(30), MoneyDeposited(50)]
Current state: balance = 120
```

Benefits:
- Complete audit log
- Time travel (replay to any point in time)
- Replay events into new read models
- Natural fit for CQRS

Challenges:
- Querying current state requires replay (use snapshots for performance)
- Schema evolution: old events must be readable with new schemas
- Eventually consistent read models

---

## Consumer Patterns

### Competing Consumers

Multiple instances of the same service consume from the same topic/queue partition. Each message processed by exactly one consumer. Used for work distribution and scaling.

### Fan-Out

One event consumed by multiple independent services. Each service gets its own consumer group (Kafka) or the topic is broadcast (SNS → multiple SQS queues).

### Dead Letter Queue (DLQ)

Messages that fail processing after N retries go to a DLQ. Allows:
- Isolating bad messages without blocking the queue
- Manual inspection and reprocessing
- Alerting on DLQ growth

Always implement DLQ handling in production systems.

### Consumer Lag Monitoring

Consumer lag = difference between latest offset and consumer's committed offset. High lag means consumers can't keep up with producers.

Monitor with:
- Kafka: `kafka-consumer-groups.sh --describe`
- AWS: CloudWatch `ApproximateNumberOfMessagesNotVisible` for SQS
- Tools: Burrow (Kafka lag monitoring), Datadog, Grafana

---

## Exactly-Once Semantics

Achieving exactly-once across a distributed system is hard. The approaches:

**Idempotent consumers:** Process events in an at-least-once system but make processing idempotent. Store processed event IDs and skip duplicates.

```python
def process_event(event):
    if already_processed(event.id):
        return  # Skip duplicate
    with transaction():
        apply_business_logic(event)
        mark_as_processed(event.id)
```

**Kafka Transactions:** Producer can write to multiple partitions atomically. Combined with `read_committed` consumer isolation, achieves exactly-once within Kafka.

**Conditional writes:** Use optimistic locking or conditional updates (e.g., DynamoDB `ConditionExpression`) to reject duplicate writes.

---

## Schema Evolution

Events are immutable once published, but schemas evolve. Use a Schema Registry (Confluent Schema Registry with Avro, or Protobuf).

**Compatibility modes:**
- **Backward compatible:** New schema can read data written with old schema. (Add optional fields, don't remove fields)
- **Forward compatible:** Old schema can read data written with new schema.
- **Full compatible:** Both backward and forward.

**Best practices:**
- Never remove or rename fields in events
- Only add optional fields
- Version your event types: `OrderPlacedV1`, `OrderPlacedV2`
- Use Avro or Protobuf — both support schema evolution natively


---

## Related

[[Distributed Systems Fundamentals]]  [[Microservices vs Monolith]]
