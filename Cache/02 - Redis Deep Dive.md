# Redis Deep Dive

## What is Redis

Redis (Remote Dictionary Server) is an in-memory data structure store used as a cache, database, and message broker. It keeps all data in RAM, making reads and writes extremely fast (sub-millisecond).

**Key properties:**
- Single-threaded command execution (no race conditions on individual commands)
- Persistent: optional RDB snapshots and AOF (Append-Only File) logging
- Replication: master-replica with automatic failover (Sentinel / Cluster)
- Rich data structures: not just key-value

---

## Redis Data Structures

### String
The simplest type. Value can be a plain string, integer, or serialized JSON.

```
SET user:123:name "Saitej"
GET user:123:name                   → "Saitej"

SET counter 0
INCR counter                        → 1
INCRBY counter 5                    → 6

SET session:abc "token_data" EX 3600   # expires in 1 hour
```

Use for: simple key-value, counters, serialized objects, session tokens, distributed locks.

### Hash
A map of field-value pairs stored under a single key. Efficient for objects with multiple fields — you can read/write individual fields without deserializing the whole object.

```
HSET user:123 name "Saitej" email "s@intuit.com" role "staff"
HGET user:123 name              → "Saitej"
HGETALL user:123                → {name: Saitej, email: ...}
HINCRBY user:123 login_count 1
```

Use for: user profiles, session data, product details, config objects.

### List
Ordered sequence. Can push/pop from both ends. O(1) for push/pop.

```
RPUSH notifications:123 "msg1" "msg2"   # push to right
LPUSH notifications:123 "urgent"        # push to left (front)
LRANGE notifications:123 0 -1           # get all
LPOP notifications:123                  # pop from front
LLEN notifications:123                  # length
```

Use for: activity feeds, job queues (LPUSH + BRPOP for blocking pop), recent items list.

### Set
Unordered collection of unique strings. O(1) for add/remove/check.

```
SADD followers:123 "user:456" "user:789"
SISMEMBER followers:123 "user:456"     → 1 (true)
SMEMBERS followers:123                 → {user:456, user:789}
SCARD followers:123                    → 2

# Set operations
SINTER followers:123 followers:456     # mutual followers
SUNION followers:123 followers:456     # all followers
```

Use for: unique visitors, tags, deduplication, mutual follows, online users.

### Sorted Set (ZSet)
Like a Set but every member has a score. Ordered by score. O(log N) for most operations.

```
ZADD leaderboard 1500 "alice" 2300 "bob" 800 "charlie"
ZRANGE leaderboard 0 -1 WITHSCORES     # ascending
ZREVRANGE leaderboard 0 2 WITHSCORES   # top 3
ZRANK leaderboard "alice"              # rank (0-indexed)
ZSCORE leaderboard "bob"               → 2300
ZINCRBY leaderboard 100 "alice"        # add 100 to score
```

Use for: leaderboards, rate limiting windows, priority queues, time-sorted events.

### Streams
Append-only log with consumer groups. Like Kafka but simpler.

```
XADD events * user_id 123 action "login"    # * = auto-generate ID
XREAD COUNT 10 STREAMS events 0             # read 10 events
XGROUP CREATE events consumers $ MKSTREAM  # create consumer group
XREADGROUP GROUP consumers worker1 COUNT 1 STREAMS events >
XACK events consumers <message-id>         # acknowledge processed
```

Use for: event sourcing, audit logs, message queues with consumer groups.

---

## Redis Setup — Local Development

### Using Docker (fastest)

```bash
# Pull and run Redis
docker run -d --name redis -p 6379:6379 redis:7-alpine

# Connect with CLI
docker exec -it redis redis-cli

# Test
redis-cli ping    → PONG
redis-cli SET foo bar
redis-cli GET foo → bar
```

### Docker Compose (with persistence)

```yaml
# docker-compose.yml
version: '3.8'
services:
  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data
    command: redis-server --appendonly yes --requirepass yourpassword

volumes:
  redis_data:
```

```bash
docker-compose up -d
redis-cli -a yourpassword ping
```

### Redis Config Basics

```conf
# redis.conf key settings
maxmemory 256mb              # max memory
maxmemory-policy allkeys-lru # eviction policy when full
appendonly yes               # enable AOF persistence
requirepass yourpassword     # authentication
bind 127.0.0.1               # only local connections
```

---

## Redis Kotlin Setup

### Gradle Dependencies

```kotlin
// build.gradle.kts
dependencies {
    // Lettuce (async Redis client, recommended)
    implementation("io.lettuce:lettuce-core:6.3.2.RELEASE")
    
    // OR Jedis (simple blocking client)
    implementation("redis.clients:jedis:5.1.0")
    
    // Spring Boot Redis (if using Spring)
    implementation("org.springframework.boot:spring-boot-starter-data-redis")
    
    // Kotlin coroutines (for async)
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-core:1.8.0")
    
    // Serialization
    implementation("com.fasterxml.jackson.module:jackson-module-kotlin:2.17.0")
}
```

---

## Kotlin Redis Prototypes

### 1. Basic Cache Client (Lettuce)

```kotlin
import io.lettuce.core.RedisClient
import io.lettuce.core.api.sync.RedisCommands
import java.time.Duration

class RedisCache(host: String = "localhost", port: Int = 6379) {
    private val client = RedisClient.create("redis://$host:$port")
    private val connection = client.connect()
    val commands: RedisCommands<String, String> = connection.sync()

    fun set(key: String, value: String, ttlSeconds: Long? = null) {
        if (ttlSeconds != null) {
            commands.setex(key, ttlSeconds, value)
        } else {
            commands.set(key, value)
        }
    }

    fun get(key: String): String? = commands.get(key)

    fun delete(key: String): Long = commands.del(key)

    fun exists(key: String): Boolean = commands.exists(key) > 0

    fun close() {
        connection.close()
        client.shutdown()
    }
}

// Usage
fun main() {
    val cache = RedisCache()
    cache.set("user:123", "Saitej", ttlSeconds = 3600)
    println(cache.get("user:123"))  // Saitej
    cache.close()
}
```

### 2. Cache-Aside Pattern

```kotlin
import com.fasterxml.jackson.module.kotlin.jacksonObjectMapper
import com.fasterxml.jackson.module.kotlin.readValue

data class UserProfile(
    val id: String,
    val name: String,
    val email: String,
    val role: String
)

class UserProfileCache(
    private val cache: RedisCache,
    private val db: UserRepository,  // your DB layer
    private val ttlSeconds: Long = 3600
) {
    private val mapper = jacksonObjectMapper()

    fun getProfile(userId: String): UserProfile {
        val cacheKey = "user:$userId:profile"

        // 1. Check cache
        val cached = cache.get(cacheKey)
        if (cached != null) {
            println("Cache HIT for $cacheKey")
            return mapper.readValue(cached)
        }

        // 2. Cache miss — fetch from DB
        println("Cache MISS for $cacheKey")
        val profile = db.findById(userId)
            ?: throw RuntimeException("User $userId not found")

        // 3. Write to cache
        cache.set(cacheKey, mapper.writeValueAsString(profile), ttlSeconds)

        return profile
    }

    fun invalidateProfile(userId: String) {
        val cacheKey = "user:$userId:profile"
        cache.delete(cacheKey)
        println("Invalidated cache for $cacheKey")
    }

    fun updateProfile(userId: String, updates: UserProfile) {
        // Write to DB first
        db.save(updates)
        // Then invalidate cache
        invalidateProfile(userId)
    }
}
```

### 3. Rate Limiter (Sliding Window with Sorted Set)

```kotlin
class RateLimiter(private val cache: RedisCache) {
    
    /**
     * Sliding window rate limiter using Redis Sorted Set.
     * Stores request timestamps as scores.
     * Returns true if request is allowed, false if rate limited.
     */
    fun isAllowed(userId: String, maxRequests: Int, windowSeconds: Long): Boolean {
        val key = "rate:$userId"
        val now = System.currentTimeMillis()
        val windowStart = now - (windowSeconds * 1000)

        val commands = cache.commands

        // Remove entries outside the window
        commands.zremrangebyscore(key, 0.0, windowStart.toDouble())

        // Count current requests in window
        val currentCount = commands.zcard(key)

        if (currentCount >= maxRequests) {
            return false  // Rate limited
        }

        // Add current request
        commands.zadd(key, now.toDouble(), now.toString())
        commands.expire(key, windowSeconds)

        return true
    }
}

// Usage
fun main() {
    val cache = RedisCache()
    val limiter = RateLimiter(cache)

    repeat(5) { i ->
        val allowed = limiter.isAllowed("user:123", maxRequests = 3, windowSeconds = 60)
        println("Request ${i + 1}: ${if (allowed) "ALLOWED" else "RATE LIMITED"}")
    }
    // Output:
    // Request 1: ALLOWED
    // Request 2: ALLOWED
    // Request 3: ALLOWED
    // Request 4: RATE LIMITED
    // Request 5: RATE LIMITED
}
```

### 4. Leaderboard (Sorted Set)

```kotlin
class Leaderboard(private val cache: RedisCache) {
    private val key = "leaderboard:global"

    fun addScore(userId: String, score: Double) {
        cache.commands.zadd(key, score, userId)
    }

    fun incrementScore(userId: String, delta: Double): Double {
        return cache.commands.zincrby(key, delta, userId)
    }

    fun getTopN(n: Long): List<Pair<String, Double>> {
        return cache.commands
            .zrevrangeWithScores(key, 0, n - 1)
            .map { it.value to it.score }
    }

    fun getUserRank(userId: String): Long? {
        return cache.commands.zrevrank(key, userId)
    }

    fun getUserScore(userId: String): Double? {
        return cache.commands.zscore(key, userId)
    }
}

// Usage
fun main() {
    val cache = RedisCache()
    val board = Leaderboard(cache)

    board.addScore("alice", 1500.0)
    board.addScore("bob", 2300.0)
    board.addScore("charlie", 800.0)
    board.incrementScore("alice", 200.0)  // alice now 1700

    println("Top 3:")
    board.getTopN(3).forEachIndexed { i, (user, score) ->
        println("  ${i + 1}. $user: $score")
    }
    // Top 3:
    //   1. bob: 2300.0
    //   2. alice: 1700.0
    //   3. charlie: 800.0

    println("Alice rank: ${board.getUserRank("alice")}")  // 1 (0-indexed)
}
```

### 5. Distributed Lock (Redlock Pattern)

```kotlin
import java.util.UUID

class DistributedLock(private val cache: RedisCache) {
    
    /**
     * Try to acquire a lock. Returns lock token if successful, null if not.
     * Uses SET NX EX — atomic set-if-not-exists with expiry.
     */
    fun tryAcquire(resource: String, ttlSeconds: Long = 30): String? {
        val key = "lock:$resource"
        val token = UUID.randomUUID().toString()
        
        // SET key token NX EX ttl — atomic, only sets if key doesn't exist
        val result = cache.commands.set(
            key, token,
            io.lettuce.core.SetArgs.Builder.nx().ex(ttlSeconds)
        )
        
        return if (result == "OK") token else null
    }

    /**
     * Release a lock — only if we own it (compare token).
     * Uses Lua script for atomic check-and-delete.
     */
    fun release(resource: String, token: String): Boolean {
        val key = "lock:$resource"
        val script = """
            if redis.call('get', KEYS[1]) == ARGV[1] then
                return redis.call('del', KEYS[1])
            else
                return 0
            end
        """.trimIndent()

        val result = cache.commands.eval<Long>(
            script,
            io.lettuce.core.ScriptOutputType.INTEGER,
            arrayOf(key),
            token
        )
        return result == 1L
    }
}

// Usage
fun main() {
    val cache = RedisCache()
    val lock = DistributedLock(cache)

    val token = lock.tryAcquire("payment:order:123", ttlSeconds = 30)
    if (token != null) {
        try {
            println("Lock acquired, processing payment...")
            // ... do work ...
        } finally {
            lock.release("payment:order:123", token)
            println("Lock released")
        }
    } else {
        println("Could not acquire lock — another instance is processing")
    }
}
```

### 6. Session Store

```kotlin
import com.fasterxml.jackson.module.kotlin.jacksonObjectMapper
import com.fasterxml.jackson.module.kotlin.readValue
import java.util.UUID

data class Session(
    val userId: String,
    val email: String,
    val roles: List<String>,
    val createdAt: Long = System.currentTimeMillis()
)

class SessionStore(
    private val cache: RedisCache,
    private val ttlSeconds: Long = 86400  // 24 hours
) {
    private val mapper = jacksonObjectMapper()

    fun create(userId: String, email: String, roles: List<String>): String {
        val sessionId = UUID.randomUUID().toString()
        val session = Session(userId, email, roles)
        cache.set("session:$sessionId", mapper.writeValueAsString(session), ttlSeconds)
        return sessionId
    }

    fun get(sessionId: String): Session? {
        val data = cache.get("session:$sessionId") ?: return null
        return mapper.readValue(data)
    }

    fun invalidate(sessionId: String) {
        cache.delete("session:$sessionId")
    }

    fun refresh(sessionId: String): Boolean {
        return cache.commands.expire("session:$sessionId", ttlSeconds) == true
    }
}
```

### 7. Spring Boot Integration

```kotlin
// application.yml
// spring:
//   data:
//     redis:
//       host: localhost
//       port: 6379
//       password: yourpassword

import org.springframework.cache.annotation.Cacheable
import org.springframework.cache.annotation.CacheEvict
import org.springframework.data.redis.core.RedisTemplate
import org.springframework.stereotype.Service
import java.time.Duration

@Service
class UserService(
    private val userRepository: UserRepository,
    private val redisTemplate: RedisTemplate<String, Any>
) {
    private val valueOps = redisTemplate.opsForValue()

    // Method-level caching with Spring @Cacheable
    @Cacheable(value = ["users"], key = "#userId")
    fun getUserById(userId: String): User? {
        return userRepository.findById(userId).orElse(null)
    }

    // Evict on update
    @CacheEvict(value = ["users"], key = "#user.id")
    fun updateUser(user: User): User {
        return userRepository.save(user)
    }

    // Manual Redis operations
    fun getOrSetProfile(userId: String): UserProfile {
        val key = "profile:$userId"
        val cached = valueOps.get(key) as? UserProfile
        if (cached != null) return cached

        val profile = userRepository.findProfileById(userId)!!
        valueOps.set(key, profile, Duration.ofHours(1))
        return profile
    }
}
```

---

## Redis CLI Quick Reference

```bash
# Key operations
SET key value
GET key
DEL key
EXISTS key
EXPIRE key 3600      # set TTL in seconds
TTL key              # remaining TTL (-1 = no expiry, -2 = not found)
KEYS pattern         # find keys (don't use in prod — blocks)
SCAN 0 MATCH user:* COUNT 100   # safe iteration

# String
INCR counter
INCRBY counter 5
SETNX key value      # set if not exists

# Hash
HSET hash field value
HGET hash field
HMSET hash f1 v1 f2 v2
HGETALL hash

# List
RPUSH list val       # push right
LPOP list            # pop left
LRANGE list 0 -1     # all elements

# Sorted Set
ZADD zset score member
ZRANGE zset 0 -1 WITHSCORES
ZREVRANK zset member

# Server info
INFO memory
INFO stats
DBSIZE               # number of keys
FLUSHDB              # clear current DB (careful!)
MONITOR              # real-time commands (dev only)
```

---

## Redis Persistence Options

### RDB (Snapshots)
Periodic point-in-time snapshots to disk. Fast to load on restart. Can lose data between snapshots.

```conf
save 900 1      # snapshot if 1 key changed in 900s
save 300 10     # snapshot if 10 keys changed in 300s
save 60 10000   # snapshot if 10000 keys changed in 60s
```

### AOF (Append-Only File)
Logs every write operation. More durable — can replay to any point. Slower than RDB.

```conf
appendonly yes
appendfsync everysec   # fsync every second (balance of perf/safety)
# appendfsync always   # safest but slowest
# appendfsync no       # fastest but least safe
```

### Recommendation
Use both: RDB for fast restarts, AOF for durability. Redis 7+ has RDB+AOF hybrid mode.


---

## Related

[[01 - Caching Fundamentals]]  [[03 - Interview Cheatsheet]]  [[04 - Distributed Cache Internals]]
