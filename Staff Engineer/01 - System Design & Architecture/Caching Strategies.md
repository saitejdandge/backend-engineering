# Caching Strategies

## Why Cache

Caching stores copies of data closer to where it's needed to reduce latency, reduce load on backing stores (DB, APIs), and improve throughput.

The cache hit rate is the key metric: `hits / (hits + misses)`. A 90% hit rate means 90% of requests never touch the origin.


## Cache Placement

### Client-Side Cache
Browser cache, mobile app cache. Controlled via HTTP headers (`Cache-Control`, `ETag`, `Last-Modified`). No server involvement on cache hit.

### CDN (Content Delivery Network)
Geographically distributed caches. Cache static assets (images, JS, CSS) and increasingly dynamic content. Hit rate very high for public content. Examples: Cloudflare, Fastly, AWS CloudFront.

### Reverse Proxy Cache
Sits in front of application servers. Caches HTTP responses. Examples: Varnish, Nginx. Good for read-heavy APIs with cacheable responses.

### Application-Level Cache
In-process cache (Guava Cache, Caffeine) or out-of-process (Redis, Memcached). Most control, most flexibility.

### Database Query Cache
MySQL query cache (deprecated in 8.0), PostgreSQL doesn't have one. Better to cache at application layer.

---

## Cache Write Strategies

### Cache-Aside (Lazy Loading)

Most common pattern. Application is responsible for loading cache.

```
Read:
  1. Check cache
  2. If miss: read from DB, write to cache, return data
  3. If hit: return cached data

Write:
  1. Write to DB
  2. Invalidate (delete) cache entry
```

**Pros:** Only caches what's actually requested. Cache failure doesn't break reads.
**Cons:** First request always misses (cold start). Risk of stale data between write-to-DB and cache invalidation.

### Write-Through

Write to cache and DB synchronously on every write.

```
Write:
  1. Write to cache
  2. Write to DB

Read:
  1. Check cache (usually a hit since every write updates cache)
```

**Pros:** Cache always up-to-date. Low read latency.
**Cons:** Every write hits both cache and DB — higher write latency. Cache may hold data that's never read (wastes memory).

### Write-Behind (Write-Back)

Write to cache immediately; write to DB asynchronously later.

```
Write:
  1. Write to cache (acknowledge immediately)
  2. Queue DB write for later

Read:
  1. Read from cache
```

**Pros:** Very low write latency. Good for write-heavy workloads.
**Cons:** Risk of data loss if cache fails before DB write. Complex to implement correctly. Hard to reason about consistency.

### Write-Around

Writes go directly to DB, bypassing cache. Cache is populated on reads only.

```
Write:
  1. Write to DB only

Read:
  1. Cache miss → read from DB → populate cache
```

**Pros:** Avoids polluting cache with write-once data.
**Cons:** First read after write always misses.

---

## Cache Eviction Policies

When cache is full, what to evict?

- **LRU (Least Recently Used):** Evict the item not accessed for the longest time. Most commonly used. Good for temporal locality.
- **LFU (Least Frequently Used):** Evict the item accessed the fewest times. Better for skewed access patterns. More complex to implement.
- **FIFO (First In, First Out):** Evict oldest inserted item. Simple but poor performance.
- **TTL (Time-To-Live):** Expire items after a set time. Used alongside LRU/LFU.
- **Random:** Evict a random item. Surprisingly effective, very simple.

**Redis default:** LRU with configurable `maxmemory-policy` (allkeys-lru, volatile-lru, allkeys-random, etc.)

---

## Cache Invalidation

> "There are only two hard things in Computer Science: cache invalidation and naming things." — Phil Karlton

### Time-Based Expiration (TTL)
Simple. Set a TTL and let it expire. Guarantees eventual freshness. Stale data is possible within the TTL window.

Choose TTL based on acceptable staleness: user profile (1 hour), product catalog (5 minutes), stock price (10 seconds).

### Event-Driven Invalidation
When data changes, explicitly invalidate or update the cache entry. More complex but more accurate.

Options:
- **Delete on write:** After DB write, delete the cache key. Next read repopulates. (Cache-aside pattern)
- **Update on write:** After DB write, update the cache directly. Consistent but complex under concurrent writes.
- **Pub/Sub invalidation:** Write publishes an event; a cache invalidation consumer listens and deletes entries. Good for distributed cache invalidation.

### Cache Stampede / Thundering Herd
When a popular cache entry expires, many requests simultaneously miss and all hammer the DB.

Solutions:
- **Probabilistic early expiration (PER):** Re-fetch slightly before TTL with some probability based on how close to expiry
- **Lock / mutex:** First cache miss acquires a lock, re-fetches, populates. Others wait. Risk of lock bottleneck.
- **Background refresh:** Refresh cache asynchronously before TTL expires. Serve slightly stale data during refresh.
- **Jitter on TTL:** Add random variance to TTL so all keys don't expire simultaneously.

```python
# Jitter example
import random
base_ttl = 3600  # 1 hour
jitter = random.randint(0, 300)  # up to 5 minutes variance
cache.set(key, value, ttl=base_ttl + jitter)
```

---

## Distributed Cache Patterns

### Redis vs Memcached

| Feature         | Redis                                                     | Memcached            |
| --------------- | --------------------------------------------------------- | -------------------- |
| Data structures | Rich (strings, hashes, lists, sets, sorted sets, streams) | Strings only         |
| Persistence     | Optional (RDB snapshots, AOF)                             | None                 |
| Replication     | Yes (master-replica)                                      | No                   |
| Clustering      | Yes (Redis Cluster)                                       | Client-side sharding |
| Lua scripting   | Yes                                                       | No                   |
| Pub/Sub         | Yes                                                       | No                   |

**Recommendation:** Redis for almost all use cases. Memcached only for very simple key-value with extreme horizontal scale needs.

### Redis Data Structures for Caching

- **String:** Simple key-value, counters, serialized JSON objects
- **Hash:** User profiles, session data (field-level access without deserializing whole object)
- **Sorted Set:** Leaderboards, rate limiting windows, priority queues
- **Set:** Unique visitors, tags, deduplication
- **List:** Recent activity feeds, job queues
- **Streams:** Append-only logs, event sourcing

### Consistent Hashing (for cache sharding)

When you have multiple cache nodes, consistent hashing distributes keys across nodes such that adding/removing a node only remaps a fraction of keys (not all keys like modular hashing would).

Virtual nodes (vnodes) improve balance by mapping each physical node to multiple positions on the hash ring.

---

## Cache Design Considerations

### What to Cache

Good candidates:
- Expensive DB queries (aggregations, joins across large tables)
- Computed results (recommendation scores, feed rankings)
- Frequently read, rarely changed data (config, product catalog)
- Session data
- Rate limiting counters

Poor candidates:
- Highly personalized data with near-zero reuse
- Data that changes more often than it's read
- Data with strict consistency requirements

### Cache Key Design

Keys should be:
- **Descriptive:** `user:123:profile` not `u123p`
- **Namespaced:** Avoid collisions between services
- **Versioned:** `user:v2:123:profile` lets you change schema without cache poisoning

### Monitoring Cache Health

Key metrics:
- **Hit rate:** Target > 90% for effectiveness
- **Eviction rate:** High eviction = cache too small
- **Memory usage:** Approaching limit triggers eviction
- **Latency:** Redis p99 should be < 1ms for most use cases
- **Connection count:** Exhausted connection pool kills throughput


---

## Related

[[API Design]]  [[Database Internals]]
