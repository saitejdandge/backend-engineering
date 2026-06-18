# Distributed Cache Internals

## How Redis Works Internally

Understanding the internals helps you reason about performance characteristics, failure modes, and scaling limits.

### Single-Threaded Event Loop

Redis processes commands on a **single main thread** using an event loop (libevent / epoll). This means:
- No locking needed for individual commands — atomic by design
- One slow command blocks everything (KEYS, LRANGE on huge lists, SORT)
- CPU bottleneck is single-core throughput

Redis 6+ added **I/O threads** for network read/write (parsing requests, sending responses) while keeping command execution single-threaded. This helps with high connection counts.

```
Client connections → I/O threads (parse/serialize) → Single main thread (execute) → I/O threads (respond)
```

**Why this matters:** You can't parallelize Redis command execution. If one command takes 50ms (e.g., a large SMEMBERS), all other clients wait.

### Memory Model

Redis allocates memory using **jemalloc** (a specialized memory allocator). Each key-value pair consumes:
- The key string
- The value (varies by type)
- A `redisObject` header (16 bytes): type, encoding, LRU clock, reference count, pointer to data

Redis uses **different internal encodings** depending on value size to save memory:

| Type | Small (encoding) | Large (encoding) |
|---|---|---|
| String ≤ 44 bytes | `embstr` (contiguous memory) | `raw` (separate allocation) |
| List ≤ 128 elements | `listpack` | `quicklist` |
| Hash ≤ 128 fields | `listpack` | `hashtable` |
| Set ≤ 128 members | `listpack` | `hashtable` |
| ZSet ≤ 128 members | `listpack` | `skiplist + hashtable` |

**Listpack** is a memory-efficient sequential encoding — compact but O(N) for access. Upgrades to hash/skiplist when thresholds are crossed.

**Skiplist** (used for ZSets) gives O(log N) for ordered operations — probabilistic balanced structure with multiple pointer lanes.

### How LRU Actually Works

Redis doesn't track a true LRU because a full linked list would double memory. Instead it uses **approximated LRU**:

1. Every key stores a 24-bit LRU clock (seconds since a Redis epoch, wraps every ~194 days)
2. On eviction, Redis samples `maxmemory-samples` random keys (default: 5)
3. Evicts the one with the oldest LRU timestamp from that sample

Higher `maxmemory-samples` = more accurate LRU but more CPU per eviction. Default of 5 is good enough for most workloads.

**LFU mode** (Redis 4+): replaces the LRU clock with a frequency counter. Uses Morris counter (probabilistic decrement) to avoid overflow on very hot keys.

---

## Distributed Caching Architecture

A single Redis node handles ~100K ops/sec and ~100GB RAM (practical limits). For more, you need distribution.

### Problem: How to Distribute Keys Across Nodes?

**Naive modulo hashing:** `node = hash(key) % N`

Problem: When you add or remove a node (N changes), almost every key maps to a different node → massive cache invalidation → thundering herd on the database.

### Consistent Hashing

Maps both keys and nodes onto a virtual hash ring (0 to 2^32). A key is assigned to the first node clockwise from its position on the ring.

```
     Node A (100)
         |
  300 ---|--- 0
         |
     Node B (200)
```

- Key hashes to 150 → assigned to Node B (next clockwise)
- Key hashes to 250 → assigned to Node A (wraps around)

**Adding a node:** Only keys between the new node and its predecessor need to migrate (~1/N of total keys).

**Removing a node:** Only keys on that node migrate to the next clockwise node.

**Virtual nodes (vnodes):** Each physical node is mapped to multiple points on the ring (e.g., 150 vnodes per node). This:
- Improves balance (avoids hot spots from uneven distribution)
- Makes partial failure graceful (load spreads across many neighbors)

### Redis Cluster: How It Actually Shards

Redis Cluster uses **hash slots** instead of consistent hashing:
- 16,384 total hash slots (0–16383)
- Each master node owns a range of slots
- `CLUSTER KEYSLOT key` → `CRC16(key) % 16384`

```
Node A: slots 0–5460
Node B: slots 5461–10922
Node C: slots 10923–16383
```

When you run `GET user:123`:
1. Client computes slot: `CRC16("user:123") % 16384 = 5789`
2. Client checks its slot map → Node B owns 5789
3. Client sends directly to Node B (smart routing, no proxy)

If the client sends to the wrong node, Redis returns a `MOVED` redirect:
```
-MOVED 5789 127.0.0.1:7002
```

**Hash tags:** Force keys onto the same slot: `user:{123}:profile` and `user:{123}:feed` both hash on `123` → same slot → MGET/transactions work.

---

## Replication: Avoiding SPOF

A single Redis node is a SPOF. If it crashes, your cache is gone and the database takes the full load.

### Master-Replica Replication

```
Master (writes) → async replicate → Replica 1 (reads)
                                 → Replica 2 (reads)
```

- Replicas are read-only
- Replication is **asynchronous** — replica may lag behind master
- Replicas can serve reads to offload master
- On master failure, a replica must be promoted manually (or automatically via Sentinel)

**Replication process:**
1. Replica connects to master
2. Master forks, creates RDB snapshot, sends it to replica (full sync)
3. Master buffers new commands during snapshot transfer
4. Replica loads RDB, then applies buffered commands
5. Ongoing: master streams commands to replicas (replication backlog)

**Replication ID + offset:** Each master has a `replid` and tracks write `offset`. Replicas send their offset on reconnect — if the offset is still in the backlog, master sends only the diff (partial sync). If not, full sync.

### Redis Sentinel — High Availability for Single-Master Setup

Sentinel is a separate process that monitors Redis and handles automatic failover.

```
            Sentinel 1
           /
Master --- Sentinel 2   (monitors)
           \
Replica 1   Sentinel 3
Replica 2
```

**What Sentinel does:**
- Monitors master and replicas with heartbeats
- If master doesn't respond: marks it `subjectively down (SDOWN)`
- If quorum (majority) of Sentinels agree: marks `objectively down (ODOWN)`
- Elects a Sentinel as leader
- Leader selects best replica (lowest replication lag) → promotes it to master
- Updates all replicas to replicate from new master
- Notifies clients of new master address

**Quorum:** Need `floor(N/2) + 1` Sentinels to agree on failover. Deploy at least **3 Sentinels** on different hosts.

**Failover time:** Typically 30–60 seconds (configurable via `down-after-milliseconds`).

**Client integration:** Clients connect to Sentinel first, ask for current master address, then connect directly. On failover, Sentinel notifies clients.

### Redis Cluster — Horizontal Scaling + HA

Redis Cluster provides both **sharding** (horizontal scaling) and **HA** in one system.

```
Master A (slots 0–5460)     Master B (slots 5461–10922)     Master C (slots 10923–16383)
    |                            |                                  |
Replica A1                   Replica B1                         Replica C1
```

**Failure detection:**
- Nodes gossip with each other (ping/pong every second)
- If a node doesn't respond → marked `PFAIL` (possible fail)
- If majority of masters agree → marked `FAIL`
- Replica of failed master triggers election, gets votes from other masters, promotes itself

**Cluster requires majority:** If more than half the masters fail, cluster stops serving (to avoid split-brain). You need at least 3 masters for a resilient cluster.

**Minimum viable cluster:** 3 masters + 3 replicas (6 nodes total).

---

## Durability

By default Redis is in-memory only — a crash loses all data. Durability is a tradeoff with performance.

### RDB (Redis Database Backup — Snapshots)

Periodic point-in-time snapshots. Uses **fork() + copy-on-write**:
1. Redis forks a child process
2. Child writes memory to disk (`.rdb` file) — takes seconds to minutes for large datasets
3. Parent continues serving — writes go to new pages (COW)
4. On restart: load RDB file, fully operational in seconds

```conf
save 900 1      # save if >= 1 key changed in last 900s
save 300 10     # save if >= 10 keys changed in last 300s
save 60 10000   # save if >= 10000 keys changed in last 60s
```

**Pros:** Fast startup, compact files, good for backups.
**Cons:** Can lose up to minutes of data (between snapshots). Fork can cause latency spikes on large datasets.

### AOF (Append-Only File)

Every write command is appended to a log file. On restart, replay the log.

```conf
appendonly yes
appendfsync everysec   # fsync to disk once per second (recommended)
# appendfsync always   # fsync on every write (slowest, safest)
# appendfsync no       # let OS decide (fastest, least safe)
```

**AOF rewrite:** Log grows forever. Redis periodically rewrites it — forks a child that reads current data and writes a compact new AOF (removes overwritten keys, compresses).

**Pros:** At most 1 second of data loss (with `everysec`). Human-readable log.
**Cons:** Larger file than RDB. Slower startup (must replay all commands). Can replay bugs.

### RDB + AOF (Recommended for Production)

Use both:
- AOF for durability (minimize data loss)
- RDB for fast restarts and backups

On restart, Redis uses AOF if enabled (more complete), falls back to RDB.

### Redis 7+ Mixed Persistence

AOF can embed an RDB snapshot at the start of the file for fast load + complete replay. Best of both worlds.

### Durability in Redis Cluster

Each master has its own persistence config. Replicas also persist (configurable). For true durability:
- Enable AOF with `appendfsync everysec` on all masters
- Use `min-replicas-to-write 1` — master refuses writes if no replica has acknowledged
- Accept that there's still a small window of data loss (async replication + 1s AOF lag)

**Redis is not a primary database for critical financial data.** For that, use Postgres with Redis as a cache layer.

---

## Scaling the Cache

### Vertical Scaling (Scale Up)

Just use a bigger machine. Redis can effectively use RAM up to ~100GB on a single node. Simple, no code changes.

Limits: cost grows fast, still a SPOF, fork() for RDB becomes slow on huge datasets.

### Read Scaling (Add Replicas)

Route read traffic to replicas. Each replica can handle ~100K reads/sec. Add as many replicas as needed for read throughput.

```
App Server → Read replica 1
           → Read replica 2 (round-robin or consistent hashing)
           → Master (writes only)
```

**Limitation:** Replicas lag behind master — reads may be slightly stale. Acceptable for feeds, recommendations, profiles.

### Write Scaling (Shard — Redis Cluster)

If write throughput exceeds a single master's capacity, you need sharding.

**Redis Cluster** splits the keyspace into 16,384 slots across multiple masters. Each master handles a portion of writes.

**Adding a shard:**
1. Add new master + replica to cluster
2. Move some slots from existing masters to new master (`CLUSTER RESHARD`)
3. Redis migrates key-by-key during slot migration — live, no downtime
4. During migration: `ASKING` redirect for keys in-flight

```bash
redis-cli --cluster add-node new-host:7006 existing-host:7000
redis-cli --cluster reshard existing-host:7000
```

**Removing a shard:**
1. Migrate all slots away from node first
2. Then remove the empty node

### Key Distribution Concerns

Even with good hashing, some keys may be hotter than others (hot key problem).

**Solutions:**
1. **Key replication across slots:** Store hot key on multiple shards, append random suffix: `trending:posts:0`, `trending:posts:1` … `trending:posts:9`. Read from a random shard.
2. **Local in-process cache (L1):** Cache the hottest keys in-process memory. Reduces Redis hits entirely.
3. **Read from replicas:** Distribute hot-key reads across master + all its replicas.

---

## Memory Management Deep Dive

### maxmemory and Eviction

```conf
maxmemory 4gb
maxmemory-policy allkeys-lru   # evict any key using LRU
```

**Eviction policies:**
- `noeviction` — return error when full (dangerous for caches)
- `allkeys-lru` — evict any key by LRU (best for pure caches)
- `volatile-lru` — evict only keys with TTL, by LRU
- `allkeys-lfu` — evict by frequency (Redis 4+)
- `volatile-lfu` — evict only TTL keys by frequency
- `allkeys-random` — random eviction
- `volatile-ttl` — evict keys with shortest TTL first

For a pure cache with no persistence: `allkeys-lru`.
For a cache-database hybrid (some keys must persist): `volatile-lru`.

### Memory Fragmentation

Redis allocates memory in chunks via jemalloc. Over time, many small allocations and frees can leave memory fragmented — Redis reports using 4GB but only 2GB is actual data.

```bash
redis-cli info memory
# mem_fragmentation_ratio > 1.5 = high fragmentation
```

**Fix:** Redis 4+ has **active defragmentation** (`activedefrag yes`) — background process that moves objects to fill gaps. Slightly increases CPU but reduces memory waste.

### Large Value Problem

Large values (> 1MB) cause issues:
- Slow commands: `GET` on a 10MB string takes time to serialize
- Network congestion: single response consumes bandwidth
- AOF/RDB bloat
- Eviction pain: evicting one big key frees a lot, but LRU can keep big old keys

**Best practice:** Keep individual values under 100KB. For large objects (e.g., HTML pages, large JSON), compress before storing or store in object storage (S3) and cache only the metadata/URL.

---

## Network and Connection Management

### Connection Pooling

Each TCP connection to Redis has overhead (~4KB memory, file descriptor). Don't create a new connection per request.

Use a connection pool:
- Pool size: typically `(CPU cores * 2) + active_connections`
- Lettuce (Kotlin/Java): uses single connection + multiplexing by default — no pool needed
- Jedis: needs explicit connection pool

```kotlin
// Lettuce — single connection, multiplexed (default, no pool needed)
val client = RedisClient.create("redis://localhost:6379")
val connection = client.connect()  // one connection, handles all traffic

// Jedis — needs pool
val poolConfig = JedisPoolConfig().apply { maxTotal = 10 }
val pool = JedisPool(poolConfig, "localhost", 6379)
val jedis = pool.resource  // borrow
jedis.close()              // return to pool
```

### Pipelining

Send multiple commands in one network round trip:

```kotlin
val pipeline = connection.async()
val futures = (1..1000).map { i ->
    pipeline.set("key:$i", "value:$i")
}
// All 1000 SETs sent in a batch — one round trip
```

Without pipelining: 1000 commands × 1ms RTT = 1 second.
With pipelining: 1000 commands × 1ms RTT = ~1ms (single round trip).

### MULTI/EXEC Transactions

Group commands atomically — no other client's commands interleave:

```kotlin
val commands = connection.sync()
commands.multi()
commands.set("balance", "100")
commands.incr("tx_count")
commands.exec()  // execute atomically
```

**Not true ACID:** If Redis crashes mid-transaction, partial execution is possible. For true atomicity, use Lua scripts (executed atomically as a single command).

---

## Observability and Monitoring

### Key Redis Metrics

```bash
redis-cli info all
```

| Metric | What it means | Alert threshold |
|---|---|---|
| `used_memory` | Current memory usage | > 80% of maxmemory |
| `mem_fragmentation_ratio` | Memory fragmentation | > 1.5 |
| `connected_clients` | Open connections | > pool_size × num_servers |
| `instantaneous_ops_per_sec` | Current ops/sec | Baseline × 2 |
| `keyspace_hits` / `keyspace_misses` | Cache hit ratio | Hit ratio < 90% |
| `evicted_keys` | Keys evicted due to maxmemory | > 0 sustained |
| `rejected_connections` | Maxclients exceeded | > 0 |
| `rdb_last_bgsave_status` | Last snapshot status | `err` = alert |
| `aof_last_write_status` | Last AOF write | `err` = alert |
| `repl_backlog_size` | Buffer for replica reconnect | If replicas often do full sync, increase |
| `master_repl_offset` vs replica offset | Replication lag | > 1000 = investigate |

### Hit Rate Monitoring

```bash
redis-cli info stats | grep -E "keyspace_hits|keyspace_misses"
# keyspace_hits:10000000
# keyspace_misses:100000
# hit rate = 10000000 / (10000000 + 100000) = 99%
```

Target: > 95% hit rate. Below 90% means cache isn't effective.

### Slow Log

Redis logs commands that take longer than a threshold:

```bash
redis-cli config set slowlog-log-slower-than 10000  # microseconds
redis-cli slowlog get 10  # last 10 slow commands
```

---

## Anti-Patterns to Avoid

**KEYS * in production** — blocks the entire server while scanning all keys. Use `SCAN` cursor-based iteration instead.

**Very large keys** — `SMEMBERS` on a set with 1M members blocks for seconds. Use `SSCAN` instead.

**Storing entire user session in one fat hash** — fine at small scale, but updating one field requires getting/setting the whole thing or using HSET per field.

**Not setting TTL** — memory grows unbounded. Always set TTL unless you explicitly want persistence.

**Using Redis as primary database** — Redis is fast but not designed for complex queries, joins, or ACID guarantees. Use as cache layer only.

**Forgetting connection pool limits** — too many connections exhausts Redis's `maxclients` (default 10,000). Each connection uses ~2KB of memory.

**Ignoring replication lag** — if you write to master and immediately read from replica, you may read stale data. Either read from master for critical reads, or implement read-your-writes (read from master for N seconds after a write by that user).


---

## Related

[[02 - Redis Deep Dive]]  [[05 - Deep research]]
