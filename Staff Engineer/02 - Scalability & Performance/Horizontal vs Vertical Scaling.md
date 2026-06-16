# Horizontal vs Vertical Scaling

## Vertical Scaling (Scale Up)

Add more resources (CPU, RAM, disk) to a single machine.

**Pros:**
- Simple — no application changes needed
- No distributed systems complexity
- Low latency (no network hops between components)
- ACID transactions remain trivial

**Cons:**
- Hard ceiling (the biggest machine AWS offers has limits)
- Single point of failure
- Cost grows non-linearly — doubling resources often more than doubles cost
- Downtime typically required to resize

**When it's the right call:**
- Databases (scaling out a relational DB is far harder than scaling up)
- Early-stage systems where complexity is the enemy
- Stateful systems that are hard to shard

---

## Horizontal Scaling (Scale Out)

Add more machines and distribute load across them.

**Pros:**
- Near-infinite ceiling (add nodes as needed)
- No single point of failure
- Often cheaper at scale (commodity hardware)
- Can scale specific services independently

**Cons:**
- Application must be designed for it (statelessness, partitioning)
- Distributed systems complexity (coordination, consistency)
- Data locality becomes a problem
- Network I/O adds latency

**Requirements for horizontal scaling:**
- **Stateless services:** Session state stored externally (Redis, DB), not in-process memory
- **External state management:** Locks, rate limit counters, caches must be in shared storage
- **Idempotency:** Retries from load balancer must not cause duplicate effects
- **Health checks:** Load balancer needs to detect and remove unhealthy instances

---

## Load Balancing

Distributes incoming traffic across backend instances.

### Layer 4 (L4) Load Balancing

Operates at the transport layer (TCP/UDP). Routes based on IP and port. Very fast — doesn't inspect payload. Used for raw TCP throughput.

Examples: AWS NLB, HAProxy in TCP mode.

### Layer 7 (L7) Load Balancing

Operates at the application layer (HTTP). Can route based on URL, headers, cookies, request body.

Examples: AWS ALB, Nginx, HAProxy in HTTP mode, Envoy.

Capabilities:
- Path-based routing (`/api` → API servers, `/static` → CDN)
- Header-based routing (A/B testing, canary by user segment)
- SSL termination
- Request buffering
- Sticky sessions (affinity)

### Load Balancing Algorithms

- **Round Robin:** Requests distributed in sequence. Simple. Bad if requests have variable cost.
- **Weighted Round Robin:** Heavier instances get proportionally more traffic. Good for mixed instance sizes.
- **Least Connections:** Route to instance with fewest active connections. Good for variable-duration requests.
- **IP Hash:** Same client IP always routes to same backend. Provides session affinity without cookies.
- **Random with two choices (Power of Two):** Pick two random backends, choose the less loaded one. Simple and highly effective.

---

## Stateless Service Design

The key enabler of horizontal scaling. No instance should hold state that another instance needs.

**Move state out of the process:**
- User sessions → Redis
- Rate limit counters → Redis
- Uploaded files → S3
- Job progress → DB or Redis
- Locks → Redis (Redlock) or DB advisory locks

**Sticky sessions (session affinity):** A workaround — route each user to the same instance. Avoids the distributed state problem but limits scaling, complicates deployments, and creates hot spots. Avoid if possible.

---

## Auto-Scaling

Automatically add/remove instances based on load.

### Reactive Auto-Scaling

Scale based on current metrics:
- CPU utilization > 70% → add instances
- Request rate > threshold → add instances
- Queue depth > N → add workers

**Problem:** Reactive scaling has lag. By the time you detect high CPU and spin up an instance (60-90 seconds), traffic spike has already impacted users.

### Predictive Auto-Scaling

Use historical patterns to pre-scale before load hits. AWS Auto Scaling has a predictive mode. Effective for known traffic patterns (business hours, daily peaks).

### Scale-to-Zero

For serverless or bursty workloads, scale down to zero instances during idle. AWS Lambda, Google Cloud Run, Knative. Cold start latency is the trade-off.

---

## Concurrency Models

Understanding concurrency is critical for performance at scale.

### Thread-per-Request (Traditional)

Each incoming request is handled by a dedicated OS thread. Simple programming model. Thread is blocked while waiting for I/O (DB, network).

**Problem:** Threads are expensive (~1MB stack each). Under high load, too many blocked threads = memory exhaustion. C10K problem.

Example: Traditional Java servlet containers (Tomcat), synchronous Python/Ruby.

### Async I/O / Event Loop

Single-threaded event loop handles many concurrent requests. When I/O is needed, registers a callback and moves on. No thread sitting idle.

**Benefit:** Handles 10,000+ concurrent connections on a single thread.
**Risk:** Blocking the event loop (e.g., CPU-heavy work) blocks all requests.

Example: Node.js, Python asyncio, Netty (Java).

### Reactive Programming

Non-blocking, backpressure-aware streams. Producers slow down when consumers can't keep up.

Example: Project Reactor (Spring WebFlux), RxJava, Akka Streams.

### Virtual Threads (Java 21+, Project Loom)

Lightweight threads managed by the JVM, not OS. Can have millions of virtual threads without memory explosion. Blocking I/O suspends the virtual thread (not the carrier OS thread).

Best of both worlds: synchronous programming model + async performance. Game changer for Java backends.

### Goroutines (Go)

Go's concurrency primitive. Extremely lightweight (~2KB stack, grows dynamically). Multiplexed on OS threads by the Go runtime. Channel-based communication.

Go is a natural fit for high-concurrency backend services.

---

## Connection Pool Sizing

A common performance mistake is over- or under-sizing connection pools.

**Guideline (HikariCP / PgBouncer):**
```
pool_size = (number_of_cores * 2) + effective_spindle_count
```

For a 4-core server with SSDs:
```
pool_size = (4 * 2) + 1 = 9 connections
```

This seems low, but databases are I/O bound. More connections = more context switching = slower.

**Signs of pool exhaustion:**
- Requests queuing at the pool (`pool.pendingAcquisition` metric)
- High p99 latency with low DB CPU
- `connection timeout` errors in logs

**Signs of over-provisioning:**
- DB CPU high despite low application throughput
- `max_connections` exhausted on the DB side
