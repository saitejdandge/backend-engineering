# Caching — Interview Cheatsheet

## Numbers to Know

| Operation | Latency |
|---|---|
| Redis GET/SET | ~0.5–1ms |
| PostgreSQL indexed query | 10–50ms |
| PostgreSQL full table scan | 100ms–10s |
| In-process cache (HashMap) | < 0.1ms |
| CDN edge response | 5–40ms |
| Cross-region DB query | 100–300ms |

---

## Pattern Decision Tree

```
Need caching?
│
├── Static media (images, videos, JS)?
│   → CDN
│
├── Shared state across app servers?
│   → Redis (external cache)
│   │
│   ├── Reads >> Writes, stale data OK?
│   │   → Cache-Aside + TTL
│   │
│   ├── Must always read fresh?
│   │   → Write-Through
│   │
│   └── High write throughput, some loss OK?
│       → Write-Behind
│
└── Small, rarely-changing, per-server OK?
    → In-process cache (Guava, ConcurrentHashMap)
```

---

## Common Redis Use Cases

| Use Case | Data Structure | Key Pattern |
|---|---|---|
| User profile | Hash or String (JSON) | `user:{id}:profile` |
| Session | String (JSON) | `session:{token}` |
| Leaderboard | Sorted Set | `leaderboard:global` |
| Rate limiting | Sorted Set or String+INCR | `rate:{userId}` |
| Distributed lock | String (NX EX) | `lock:{resource}` |
| Feed/timeline | List or Sorted Set | `feed:{userId}` |
| Online users | Set | `online:users` |
| Counter | String (INCR) | `counter:{metric}` |
| Pub/Sub | Streams or Pub/Sub | `events:{channel}` |
| Job queue | List (LPUSH+BRPOP) | `queue:{jobType}` |

---

## Cache Key Design

Good keys are:
- **Namespaced:** `user:123:profile` not `profile123`
- **Descriptive:** makes intent clear
- **Versioned when needed:** `user:v2:123:profile` to handle schema changes without stale reads

Avoid:
- Keys over 1KB
- Spaces or special chars
- Sequential numeric IDs without namespace (collision risk)

---

## Invalidation Strategies

| Strategy | When | Tradeoff |
|---|---|---|
| Delete on write | Strong consistency needed | Extra write latency, simple |
| TTL only | Eventual consistency OK | Simple, some staleness |
| Write-through | Must always be fresh | Slower writes |
| Event-driven (pub/sub) | Distributed invalidation | Complex, eventual |

**Most common in practice:** Delete on write + TTL as backup.

---

## Handling Failures

**Redis goes down:**
- Fall through to DB (ensure DB can handle the spike)
- Circuit breaker to prevent DB overload
- In-process fallback for hottest keys
- Consider Redis Sentinel/Cluster for HA

**Cache stampede:**
- Single-flight / mutex on first miss
- Cache warming before TTL expires
- Jitter on TTL values

**Hot key:**
- Replicate value across multiple shards
- In-process local cache as L1
- Key hashing with suffix: `user:123:profile:shard{0-9}`

---

## Redis Cluster vs Sentinel

| | Sentinel | Cluster |
|---|---|---|
| Purpose | HA for single master | Horizontal scaling + HA |
| Data distribution | All data on one master | Sharded across 16384 slots |
| Failover | Automatic | Automatic |
| Multi-key commands | Supported | Keys must be on same node |
| Use when | Need HA, dataset fits one node | Dataset too large, need sharding |

---

## Quick Kotlin Snippets

```kotlin
// Cache-aside in one function
fun <T> cacheAside(
    key: String,
    ttl: Long,
    deserialize: (String) -> T,
    serialize: (T) -> String,
    fetch: () -> T,
    redis: RedisCache
): T {
    val cached = redis.get(key)
    if (cached != null) return deserialize(cached)
    val value = fetch()
    redis.set(key, serialize(value), ttl)
    return value
}

// Usage
val profile = cacheAside(
    key = "user:123:profile",
    ttl = 3600,
    deserialize = { mapper.readValue<UserProfile>(it) },
    serialize = { mapper.writeValueAsString(it) },
    fetch = { db.findProfile("123") },
    redis = cache
)
```

```kotlin
// Atomic counter with TTL
fun incrementWithWindow(redis: RedisCache, key: String, windowSec: Long): Long {
    val count = redis.commands.incr(key)
    if (count == 1L) {
        redis.commands.expire(key, windowSec)  // set TTL only on first increment
    }
    return count
}
```
