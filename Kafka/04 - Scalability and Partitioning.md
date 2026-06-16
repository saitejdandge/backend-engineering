# Scalability and Partitioning

## Single Broker Limits (Back-of-Envelope)

Before scaling out, know what one broker can handle:

| Resource | Limit | Notes |
|---|---|---|
| Storage | ~1TB per broker | Depends on disk configuration |
| Throughput | ~1M messages/sec | Very hand-wavy; depends on msg size + hardware |
| Frontend connections | ~100,000 | |
| Added latency | ~0.1–0.5ms | Per-query overhead |
| Recommended message size | < 1MB | Configurable via `message.max.bytes` |

> If your system doesn't exceed these limits, scaling is not a relevant conversation in your interview.

---

## Scaling Strategies

### Strategy 1: Add More Brokers (Horizontal Scaling)

The simplest approach — add brokers to distribute load and increase fault tolerance.

```
Before (1 broker, 3 partitions):
  Broker 1: [P0] [P1] [P2]

After (3 brokers, 3 partitions):
  Broker 1: [P0]
  Broker 2: [P1]
  Broker 3: [P2]
```

**Critical:** When adding brokers, ensure your topics have **enough partitions** to distribute across them. If you have 3 brokers but only 1 partition, all traffic still goes to one broker — you gain nothing.

### Strategy 2: Partitioning Strategy (The Main Interview Focus)

This is the core scalability decision. Everything else is mostly handled by managed services.

```
partition = hash(key) % num_partitions
```

**The goal:** Evenly distribute messages across partitions to maximize parallelism.

**The risk:** A bad key creates **hot partitions** — one partition overwhelmed while others idle.

```
Bad key: country_code
  US → Partition 0  ← 60% of traffic, overwhelmed
  EU → Partition 1  ← 30% of traffic
  AS → Partition 2  ← 10% of traffic

Good key: user_id (evenly distributed hash space)
  P0 ← ~33% of traffic
  P1 ← ~33% of traffic
  P2 ← ~33% of traffic
```

---

## Hot Partitions — The Classic Interview Question

### The Problem

Consider an Ad Click Aggregator. You partition by `ad_id`. When Nike launches their Super Bowl ad:

```
Normal day:
  ad_001 → Partition 0 (Nike regular ad) — 100 clicks/sec
  ad_002 → Partition 1 (Pepsi ad)        — 80 clicks/sec
  ad_003 → Partition 2 (Apple ad)        — 90 clicks/sec

Super Bowl day:
  ad_001 → Partition 0 (Nike Super Bowl ad) — 50,000 clicks/sec  ← HOT 🔥
  ad_002 → Partition 1 (Pepsi ad)           — 80 clicks/sec
  ad_003 → Partition 2 (Apple ad)           — 90 clicks/sec
```

Partition 0's consumer is overwhelmed. Lag builds up. Processing delays.

### Solutions

#### Option 1: No Key (Default Partitioning)

Remove the key. Kafka's sticky partitioner distributes messages roughly evenly over time.

```
Before: all Nike ad clicks → Partition 0
After: Nike ad clicks distributed evenly across all partitions
```

**Trade-off:** Lose ordering guarantees for that key. Fine if ordering doesn't matter for your use case.

#### Option 2: Random Salting

Append a random suffix to the key:

```
key = ad_id + "_" + random(0, N)
"ad_001_0" → Partition 0 (20% of Nike clicks)
"ad_001_1" → Partition 1 (20% of Nike clicks)
"ad_001_2" → Partition 2 (20% of Nike clicks)
"ad_001_3" → Partition 3 (20% of Nike clicks)
"ad_001_4" → Partition 4 (20% of Nike clicks)
```

**Trade-off:** Consumer must aggregate across multiple partitions to get the full count for `ad_001`. More complex aggregation logic.

#### Option 3: Compound Key

Use ad_id + another attribute that varies:

```
key = ad_id + "_" + geo_region
"ad_001_US-WEST"  → Partition 0
"ad_001_US-EAST"  → Partition 1
"ad_001_EU"       → Partition 2
"ad_001_ASIA"     → Partition 3
```

**Trade-off:** Works only if the secondary attribute truly distributes load. If 80% of traffic is US-WEST, it's still a hot partition.

#### Option 4: Back Pressure

Slow down the producer when a partition's consumer lag is too high.

```
Producer checks: what is the consumer lag on Partition 0?
If lag > threshold → slow down / throttle production to that partition
```

**Trade-off:** Simplest to implement, but may drop throughput across the board during spikes.

### Summary Table

| Strategy | Ordering Preserved? | Aggregation Complexity | Best When |
|---|---|---|---|
| No key | No | Low | Ordering doesn't matter |
| Random salting | No | Medium (merge across partitions) | Can handle post-processing |
| Compound key | Per compound key | Low-Medium | Natural sub-dimensions exist |
| Back pressure | Yes | Low | Can tolerate lower throughput |

---

## Partition Count — How Many?

**Rule of thumb:** num_partitions >= target_throughput / single_partition_throughput

```
Target: 100 MB/s throughput
Single partition max: ~10 MB/s (conservative)
Minimum partitions: 100 / 10 = 10 partitions
```

**Consumer parallelism:** Max useful consumers = num_partitions. Having 20 consumers on a 10-partition topic means 10 consumers are idle.

```
10 partitions, 10 consumers → optimal (each consumer handles 1 partition)
10 partitions, 20 consumers → 10 idle consumers (wasteful)
10 partitions, 5 consumers  → each consumer handles 2 partitions
```

**Increasing partitions:** You can add partitions later, but this changes the partition assignment for existing keys — breaking ordering for keys that get remapped.

---

## Topic-Level vs Cluster-Level Scaling

Different topics have different requirements. Don't think of scaling as all-or-nothing.

```
Topic: "user-clicks"        → 100 partitions (very high volume, fan-out needed)
Topic: "payment-events"     → 10 partitions  (medium volume, strong ordering)
Topic: "admin-notifications" → 3 partitions   (low volume)
```

Each topic can be tuned independently.

---

## Managed Kafka Services

In production (and often in interviews), managed services handle much of this:

| Service | Provider | What it handles |
|---|---|---|
| **Confluent Cloud** | Confluent | Auto-scaling, rebalancing, monitoring |
| **AWS MSK** | Amazon | Managed Kafka clusters on AWS |
| **Azure Event Hubs** | Microsoft | Kafka-compatible endpoint |

> In interviews, mention managed services as a practical choice, but demonstrate you understand the underlying partitioning concepts.

---

## Replication Factor and Scaling

Replication protects against broker failures and is separate from partition scaling:

```
Replication Factor = 1: No redundancy (dev/test only)
Replication Factor = 2: Can survive 1 broker failure
Replication Factor = 3: Can survive 2 broker failures (standard production)
```

More replicas = more storage overhead but stronger durability. Choose based on your data criticality.
