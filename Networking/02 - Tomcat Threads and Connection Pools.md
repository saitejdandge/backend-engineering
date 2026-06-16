# Tomcat, Threads & Connection Pools

## What is Tomcat

Apache Tomcat is a **Java web server and servlet container**. It listens for HTTP requests, manages TCP connections, and dispatches each request to a Java servlet (Spring Boot uses it by default as the embedded server).

When you run `./mvnw spring-boot:run`, Tomcat starts on port 8080 and waits for connections.

```
Browser → TCP connection → Tomcat → DispatcherServlet → Your Controller
```

Other Java servers: Jetty (lighter), Undertow (non-blocking), Netty (async, not a servlet container).

---

## Thread-Per-Request Model (Classic Tomcat)

The simplest and most common model: **one thread handles one request, end to end**.

```
Request arrives → Tomcat assigns a thread from pool → Thread runs your code → Thread returns to pool
```

### Thread Pool Configuration

```properties
# application.properties
server.tomcat.threads.max=200          # max concurrent requests
server.tomcat.threads.min-spare=10     # always-warm threads
server.tomcat.accept-count=100         # queue size when all threads busy
server.tomcat.connection-timeout=20000 # ms before idle connection closed
```

### What Happens Under Load

```
Threads available: 200
Concurrent requests: 201

Request 201 → queue (accept-count=100, so it waits)
Request 301 → TCP connection REFUSED (queue full)
```

If requests take 100ms each, max throughput = 200 threads / 0.1s = **2,000 req/sec**.

### The Problem: Blocking I/O

Each thread spends most of its time *waiting* — waiting for the database, waiting for a remote API, waiting for Redis. A thread blocked on I/O consumes ~1MB of stack memory and a JVM thread doing nothing.

```
200 threads × 1MB = 200MB just to hold threads that are mostly sleeping
```

With slow DB queries (500ms), the same 200 threads only handle 400 req/sec.

---

## NIO Connector (Tomcat's Non-Blocking I/O)

Tomcat 8+ uses the **NIO connector** by default. It uses Java NIO's `Selector` + epoll under the hood:

1. **Acceptor thread:** Accepts new TCP connections (fast, non-blocking)
2. **Poller thread(s):** Monitors connections with a `Selector` for data readiness
3. **Worker thread pool:** Executes the actual request when data is ready

```
Acceptor → registers connection with Poller
Poller → (epoll) waits for data → notifies Worker
Worker → reads data, runs servlet, writes response
```

**Key:** The Poller can watch thousands of connections with just a few threads (via epoll). Worker threads only get work when there's actual data to process.

---

## Virtual Threads (Java 21+ — Project Loom)

The game changer. Virtual threads are extremely lightweight (~200 bytes stack vs ~1MB for OS threads). You can create **millions** of them.

When a virtual thread blocks on I/O, the JVM unmounts it from the carrier OS thread — the OS thread is free to run another virtual thread. From your code's perspective, it looks like normal blocking code.

```kotlin
// Spring Boot 3.2+ enables virtual threads automatically
// application.properties:
// spring.threads.virtual.enabled=true

// Now this scales to 100,000 concurrent requests with normal blocking code:
fun getUser(id: String): User {
    val user = db.findById(id)  // "blocks" but doesn't block OS thread
    val cache = redis.get(id)   // same
    return merge(user, cache)
}
```

**Before Loom:** Had to use reactive programming (WebFlux, coroutines) for high concurrency.
**After Loom:** Write normal blocking code, get async performance. Reactive is now mostly unnecessary for throughput.

---

## Connection Pools (JDBC / Database)

### Why Connection Pools Exist

Opening a TCP connection to a database is expensive:
1. TCP handshake (~1ms)
2. TLS handshake (~1ms)
3. Database authentication (~5ms)
4. **Total: ~7ms per connection**

For an app handling 1,000 req/sec with 50ms DB query time, you'd need 50 connections open. Without pooling, you'd pay 7ms overhead on every request.

**Connection pools pre-open connections and reuse them.**

### HikariCP (The Standard for Java/Kotlin)

Spring Boot uses HikariCP by default.

```kotlin
// application.yml
spring:
  datasource:
    url: jdbc:postgresql://localhost:5432/mydb
    username: user
    password: pass
    hikari:
      maximum-pool-size: 10      # max DB connections
      minimum-idle: 5            # always-warm connections
      connection-timeout: 30000  # ms to wait for a connection from pool
      idle-timeout: 600000       # ms before idle connection closed
      max-lifetime: 1800000      # max connection age (30 min)
```

### The Right Pool Size

**Common mistake:** Setting pool size = thread count. This is wrong.

**Formula (HikariCP recommendation):**
```
pool_size = (cpu_cores * 2) + effective_spindle_count
```

For a 4-core server with SSD:
```
pool_size = (4 * 2) + 1 = 9 connections
```

Counterintuitive but correct. DB is I/O bound. More connections = more context switching = slower. PostgreSQL itself recommends keeping connections low.

### What Happens When Pool is Exhausted

```
All 10 connections busy
Request 11 arrives → waits up to connection-timeout (30s)
Request 11 times out → HikariCP throws SQLException
```

Metrics to watch:
- `hikaricp.connections.pending` — threads waiting for a connection
- `hikaricp.connections.timeout` — connection wait timeouts

### Connection Pool Per Service

In microservices, each service has its own pool. Don't share pools across services.

```
service-A: pool of 10 → PostgreSQL
service-B: pool of 10 → PostgreSQL
PostgreSQL: max_connections = 200 (handles both pools + headroom)
```

If you have 20 service instances × 10 pool size = 200 connections. Stay within Postgres `max_connections` (default 100, usually bumped to 200-500).

Use **PgBouncer** (connection pooler in front of Postgres) to handle many app instances without exhausting DB connections.

---

## Redis Connection Pool (Lettuce vs Jedis)

### Lettuce (Default in Spring Boot)

Uses **a single connection with multiplexing**. Multiple threads share one connection via pipelining. Thread-safe. No pool needed for most use cases.

```kotlin
// Single connection, handles all traffic via async pipeline
val client = RedisClient.create("redis://localhost:6379")
val connection = client.connect()
// All threads use this one connection safely
```

When to use a pool with Lettuce: when you need true parallel blocking commands (BLPOP, SUBSCRIBE) that can't be multiplexed.

### Jedis

Traditional blocking client. Each thread needs its own connection. Must use `JedisPool`.

```kotlin
val poolConfig = JedisPoolConfig().apply {
    maxTotal = 10        // max connections
    maxIdle = 5          // max idle connections
    minIdle = 2          // min warm connections
    testOnBorrow = true  // validate connection before use
}
val pool = JedisPool(poolConfig, "localhost", 6379)

pool.resource.use { jedis ->
    jedis.set("key", "value")
}
```

**Recommendation:** Use Lettuce. It's default in Spring Data Redis and requires no pool configuration for standard use cases.

---

## HTTP Client Connection Pool (OkHttp / WebClient)

When your app calls another service, it also needs a connection pool.

### OkHttp (Kotlin/Java)

```kotlin
val client = OkHttpClient.Builder()
    .connectionPool(ConnectionPool(
        maxIdleConnections = 10,
        keepAliveDuration = 5,
        timeUnit = TimeUnit.MINUTES
    ))
    .connectTimeout(2, TimeUnit.SECONDS)
    .readTimeout(5, TimeUnit.SECONDS)
    .build()
```

### WebClient (Spring Reactive)

```kotlin
val webClient = WebClient.builder()
    .baseUrl("https://api.example.com")
    .clientConnector(ReactorClientHttpConnector(
        HttpClient.create()
            .option(ChannelOption.CONNECT_TIMEOUT_MILLIS, 2000)
            .responseTimeout(Duration.ofSeconds(5))
            .doOnConnected { conn ->
                conn.addHandlerLast(ReadTimeoutHandler(5))
            }
    ))
    .build()
```

---

## Diagnosing Thread/Connection Issues

### Thread Pool Exhaustion

Symptoms: Requests slow down, queue up, eventually fail with 503.

```bash
# JVM thread dump
kill -3 <pid>           # Unix
jstack <pid>            # JDK tool

# Look for: threads in WAITING state on pool.borrow()
# Too many: "Waiting for connection from pool"
```

### Connection Pool Exhaustion

Symptoms: `SQLTimeoutException`, `Connection is not available, request timed out`

```bash
# Hikari metrics (Micrometer/Prometheus)
hikaricp_connections_pending > 0    # threads waiting
hikaricp_connections_timeout_total  # count of timeouts

# PostgreSQL side
SELECT count(*) FROM pg_stat_activity WHERE datname = 'mydb';
```

### Thread Dump Reading

```
"http-nio-8080-exec-42" WAITING
  at java.util.concurrent.locks.LockSupport.park(LockSupport.java:175)
  at com.zaxxer.hikari.util.ConcurrentBag.borrow(ConcurrentBag.java:120)
```

This thread is waiting for a DB connection from HikariCP. If you see 50+ threads in this state, your pool is too small or queries are too slow.
