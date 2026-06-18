# Performance Profiling & Bottlenecks

## The Performance Investigation Mindset

Never guess. Measure first, then optimize. Premature optimization is expensive and often wrong.

**The loop:**
1. Observe symptoms (high latency, high CPU, OOM)
2. Form a hypothesis
3. Measure to confirm or disprove
4. Fix the confirmed bottleneck
5. Measure again to verify improvement
6. Repeat

**Amdahl's Law:** The speedup from optimizing a part of a system is limited by the fraction of time that part is used.
```
Speedup = 1 / (1 - P + P/S)
```
Where P = fraction of time in the optimized part, S = speedup of that part. Diminishing returns quickly.

---

## The Four Resources

Every performance bottleneck is in one of these:

1. **CPU:** Computation, serialization, encryption, GC, context switching
2. **Memory:** Heap pressure, GC thrashing, working set exceeds RAM (spills to disk)
3. **Disk I/O:** Sequential vs random reads, IOPS limit, throughput limit
4. **Network I/O:** Bandwidth, latency, connection overhead, DNS resolution

Start by identifying which resource is saturated. Use system tools:

```bash
# CPU and I/O overview (top 10 processes)
top / htop

# Detailed I/O stats per disk
iostat -x 1

# Network connections and stats
ss -s
netstat -i

# Memory usage
free -h
vmstat 1

# What's the process doing? (Linux)
strace -p <pid>  # system calls
perf top         # CPU profiling
```

---

## Profiling Java Applications

### JVM Metrics to Watch

- **GC pause time:** `jstat -gc <pid>` or JVM flags `-Xlog:gc`. Long GC pauses (>100ms) stall all threads.
- **Heap usage:** Stay below 80% to avoid frequent GC. Too-small heap = frequent GC. Too-large heap = long GC pauses.
- **Thread states:** Use thread dumps (`kill -3 <pid>` or `jstack`) to see blocked/waiting threads.

### GC Tuning Basics

Modern GCs (G1GC, ZGC, Shenandoah) are good defaults. Key knobs:
- **G1GC:** Default in Java 9+. Tunable pause target: `-XX:MaxGCPauseMillis=200`
- **ZGC:** Sub-millisecond pauses. Best for latency-sensitive services. Use in Java 15+.
- **Heap size:** `-Xms` (initial) = `-Xmx` (max) in production to avoid resizing pauses.

### Async Profiler

Best CPU/memory profiler for JVM. Uses OS-level profiling (no safepoint bias).

```bash
./profiler.sh -d 30 -f profile.html <pid>
```

Generates a flame graph. Wide boxes = hot code paths. Look for unexpected width in unexpected places.

### Flame Graphs

Visualize where CPU time is spent. X-axis = % of time in that stack frame. Y-axis = call stack depth.

Read from bottom (entry point) to top (leaf function). Wide frames at the top = hot code. Wide frames in the middle = lots of code underneath that path.

---

## Profiling Python Applications

```python
# cProfile — built-in, deterministic profiler
python -m cProfile -o output.prof my_script.py
snakeviz output.prof  # Visualize

# py-spy — sampling profiler, attaches to running process
py-spy top --pid 1234
py-spy record -o profile.svg --pid 1234
```

For async Python (asyncio), use `pyinstrument`:
```bash
pyinstrument my_script.py
```

---

## Database Query Profiling

### PostgreSQL

```sql
-- Enable logging of slow queries
SET log_min_duration_statement = 100; -- log queries > 100ms

-- Analyze a specific query
EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT * FROM orders WHERE user_id = 123;

-- Find slowest queries (pg_stat_statements extension)
SELECT query, mean_exec_time, calls, total_exec_time
FROM pg_stat_statements
ORDER BY mean_exec_time DESC
LIMIT 20;
```

**What to look for in EXPLAIN output:**
- `Seq Scan` on large tables → add index
- `Hash Join` with high rows → check join condition selectivity
- `Sort` → index might help, or reduce data before sort
- High `actual rows` vs `expected rows` → stale statistics, run `ANALYZE`
- High `Buffers: read` → data not cached, I/O bound

### N+1 Query Problem

The most common DB performance killer in ORM-heavy codebases.

```python
# BAD: N+1
orders = Order.query.all()  # 1 query
for order in orders:
    print(order.user.name)  # N queries (one per order)

# GOOD: Eager loading (1 query with JOIN)
orders = Order.query.options(joinedload('user')).all()
```

In production, use query logging in development, and APM tools (Datadog, New Relic) to detect N+1 patterns automatically.

---

## Common Application Bottlenecks

### Synchronous Blocking I/O in Async Context

```python
# BAD: blocks the event loop
async def handle_request():
    result = requests.get("http://external-api.com")  # synchronous! Blocks event loop.

# GOOD: non-blocking
async def handle_request():
    async with aiohttp.ClientSession() as session:
        result = await session.get("http://external-api.com")
```

### Object Serialization

JSON serialization/deserialization is CPU-intensive at scale. Options:
- Use faster JSON libraries: `orjson` (Python), `jackson` with optimized config (Java)
- Use binary formats (Protobuf, Avro, MessagePack) for internal APIs
- Cache serialized output when possible

### String Concatenation in Loops

```java
// BAD: O(n²) — creates new String object each iteration
String result = "";
for (String s : list) {
    result += s;
}

// GOOD: O(n) — StringBuilder reuses buffer
StringBuilder sb = new StringBuilder();
for (String s : list) {
    sb.append(s);
}
String result = sb.toString();
```

### Synchronization Bottlenecks

Excessive locking creates contention. Signs: high `BLOCKED` thread count, low CPU despite high load.

- Use lock-free data structures (ConcurrentHashMap, AtomicInteger)
- Reduce lock scope (hold locks for minimum time)
- Use read-write locks when reads dominate
- Consider optimistic locking (CAS operations)

---

## Latency Percentiles

Never look at averages alone. Use percentiles.

- **p50 (median):** Half of requests are faster than this
- **p95:** 95% of requests are faster than this
- **p99:** 99% of requests are faster than this
- **p999:** 99.9% — important for high-volume systems (0.1% of 1M requests = 1,000 slow requests)

A system with p50=10ms and p99=2000ms is suffering — the average might look fine at 50ms.

**Latency percentile targets by service type:**
- External-facing API: p99 < 200ms
- Internal service: p99 < 50ms
- DB query: p99 < 10ms
- Cache read: p99 < 1ms

### Latency Budget

For a request that chains 5 services: if each has p99=50ms, the combined p99 is NOT 250ms. It's much worse because you're now at the 99th percentile of 5 independent events. Budget your latency accordingly.

```
Combined p99 ≈ sum of individual p99s + serial overhead
```

This is why minimizing serial I/O hops (fan-out, parallel calls) is critical.

---

## Load Testing

Never go to production without load testing. Know your system's limits before your users find them.

**Tools:**
- **k6:** Modern, scriptable, good for CI integration
- **Locust:** Python-based, easy to write complex scenarios
- **Apache JMeter:** Feature-rich, older, XML-based config
- **Gatling:** Scala DSL, good reporting

**What to test:**
- **Baseline:** Normal traffic. Confirm p99 meets SLO.
- **Stress test:** Gradually increase until system breaks. Find the breaking point.
- **Spike test:** Sudden traffic jump. Test auto-scaling and circuit breakers.
- **Soak test:** Sustained load over hours/days. Reveals memory leaks, connection pool exhaustion, disk fill.

**Always test with production-like data volume.** A test with 100 rows performs nothing like a test with 100 million rows.


---

## Related

[[Horizontal vs Vertical Scaling]]  [[Rate Limiting & Throttling]]
