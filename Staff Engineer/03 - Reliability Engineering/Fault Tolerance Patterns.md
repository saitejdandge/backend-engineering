# Fault Tolerance Patterns

## Circuit Breaker

Prevents cascading failures by stopping calls to a failing service, giving it time to recover.

### States

```
CLOSED → (failure threshold exceeded) → OPEN → (timeout elapsed) → HALF-OPEN
  ↑                                                                      |
   (probe request succeeds) 
  ↑
   (probe request fails) → back to OPEN
```

- **CLOSED:** Normal operation. All calls go through. Failures tracked.
- **OPEN:** Calls fail immediately (fast fail). No traffic to the downstream service. Error returned to caller.
- **HALF-OPEN:** One test request let through. If it succeeds → CLOSED. If fails → OPEN again.

### Configuration

Key parameters:
- `failureThreshold`: How many failures to open the circuit (e.g., 50% failure rate in 10 seconds)
- `slowCallThreshold`: Treat calls slower than X ms as failures
- `waitDurationInOpenState`: How long to stay OPEN before trying HALF-OPEN (e.g., 30 seconds)
- `permittedCallsInHalfOpenState`: How many test calls in HALF-OPEN

### Implementation

Java: Resilience4j
```java
CircuitBreakerConfig config = CircuitBreakerConfig.custom()
    .failureRateThreshold(50)
    .slowCallDurationThreshold(Duration.ofSeconds(2))
    .waitDurationInOpenState(Duration.ofSeconds(30))
    .build();

CircuitBreaker cb = CircuitBreakerRegistry.of(config).circuitBreaker("payment-service");

Supplier<String> decorated = CircuitBreaker.decorateSupplier(cb, () -> paymentService.charge());
```

Python: `circuitbreaker` library, or custom implementation with Redis state.

### Fallback Strategies

When circuit is open, what do you return?
- **Cached response:** Return last known good data (stale but available)
- **Default response:** Return a safe default ("show 0 notifications" rather than error)
- **Degrade gracefully:** Hide the feature entirely rather than showing an error
- **Queue for later:** Accept the request and process asynchronously when service recovers

---

## Retry with Exponential Backoff and Jitter

Retrying immediately after a failure often makes things worse — you pile more load on an already struggling service.

### Exponential Backoff

Each retry waits longer than the previous:
```
attempt 1: wait 1s
attempt 2: wait 2s
attempt 3: wait 4s
attempt 4: wait 8s
attempt 5: wait 16s (max)
```

Formula: `min(cap, base * 2^attempt)`

### Jitter

Without jitter, all retrying clients retry at the same moment → synchronized thundering herd.

**Full jitter:**
```python
sleep = random.uniform(0, min(cap, base * 2 ** attempt))
```

**Decorrelated jitter (AWS recommendation):**
```python
sleep = random.uniform(base, min(cap, prev_sleep * 3))
```

**Equal jitter:**
```python
v = min(cap, base * 2 ** attempt)
sleep = v / 2 + random.uniform(0, v / 2)
```

### Retry Budget

Limit total retries globally to avoid amplifying load during outages:
- Set a retry budget (e.g., max 10% of requests can be retries)
- When budget exhausted, fail fast instead of retrying

### What to Retry

Only retry **idempotent** operations or operations with explicit idempotency keys:
-  GET requests
-  DELETE (idempotent by nature)
-  POST with idempotency key
-  POST without idempotency key (may cause duplicates)

Retry on:
- Network timeouts
- 429 (rate limited) — use Retry-After header
- 503 (service unavailable)
- Connection refused

Do NOT retry on:
- 400 (bad request) — client error, retrying won't help
- 401/403 — auth error
- 404 — resource doesn't exist

---

## Timeout

Every outbound call must have a timeout. Without timeouts, slow dependencies hold your threads indefinitely.

### Timeout Hierarchy

Set timeouts at every layer:
```
Client timeout > Load balancer timeout > Service timeout > DB/dependency timeout
```

If the service timeout is larger than the client timeout, the service does unnecessary work on requests the client already gave up on.

### Timeout Budget (Deadline Propagation)

Pass the remaining time budget downstream:
```
Client → Service A (deadline: 500ms) → Service B (passes remaining 400ms) → DB (passes remaining 350ms)
```

gRPC has built-in deadline propagation. For REST, use a custom header like `X-Request-Deadline`.

### Choosing Timeout Values

Start with: `timeout = p99 latency * 2 + network overhead`

Review and tighten over time. Too-loose timeouts don't protect you from slow dependencies.

---

## Bulkhead Pattern

Isolate components so failure in one doesn't exhaust resources for all.

Inspired by ship bulkheads — watertight compartments prevent one leak from sinking the whole ship.

### Thread Pool Isolation

Assign a separate thread pool (or connection pool) per downstream dependency:
```
Total threads: 200
- Payment service: 50 threads
- Inventory service: 50 threads
- Notification service: 20 threads
- General pool: 80 threads
```

If payment service is slow and exhausts its 50 threads, inventory and notifications are unaffected.

### Semaphore Isolation

Use semaphores instead of thread pools when calls are async (non-blocking). Limit concurrent calls to a dependency:
```java
Semaphore semaphore = new Semaphore(10);  // max 10 concurrent calls to payment service
if (semaphore.tryAcquire()) {
    try {
        return paymentService.charge();
    } finally {
        semaphore.release();
    }
} else {
    throw new BulkheadFullException("Payment service bulkhead full");
}
```

Resilience4j `Bulkhead` implements both strategies.

---

## Graceful Degradation

Design your system to provide reduced functionality rather than total failure.

**Examples:**
- Product page without recommendations (recommendation service down) → still show product
- Search with cached results (search index rebuilding) → show slightly stale results
- Timeline without ads (ad service down) → still show posts

**Implementation patterns:**
- Feature flags: disable non-critical features programmatically
- Fallback chains: primary → secondary → cached → default
- Health-based routing: route to healthy instances, skip degraded ones

**The key question for each feature:** "What is the minimum viable version of this feature if its dependency is unavailable?"

---

## Chaos Engineering

Intentionally inject failures to test system resilience before real failures expose weaknesses.

### Chaos Principles

1. Define "steady state" — a measurable normal behavior (e.g., p99 < 200ms, error rate < 0.1%)
2. Hypothesize that steady state continues with failure injected
3. Introduce real-world events (server crash, network latency, disk full)
4. Look for differences between control and experiment groups
5. If hypothesis holds, confidence increases. If not, fix the weakness.

### What to Chaos Test

- Kill random pod/instance → test auto-restart, load balancer health checks
- Add network latency between services → test timeouts and circuit breakers
- Simulate DB connection pool exhaustion → test connection handling
- Fill disk on application node → test disk-full handling
- Kill a Kafka broker → test consumer failover

### Tools

- **Chaos Monkey (Netflix):** Randomly terminates EC2 instances in production
- **Chaos Mesh:** Kubernetes-native chaos injection (pod failure, network chaos, stress)
- **Gremlin:** Commercial, feature-rich chaos engineering platform
- **AWS Fault Injection Simulator (FIS):** Managed chaos testing for AWS resources
- **Litmus:** Open-source Kubernetes chaos engineering

**Start small:** Begin in staging. Build confidence before running in production. Always have a kill switch.

---

## Timeouts, Retries, and Circuit Breakers Together

These three work as a system:

```
Request → [Timeout: 500ms] → [Retry: 3 attempts, exponential backoff] → [Circuit Breaker]
```

Order of operations:
1. **Timeout** fires → retry triggers
2. **Retry** attempts → after N failures, circuit breaker opens
3. **Circuit breaker open** → fast fail, no more retries to the broken service, fallback served

Without coordination, these can interact badly (e.g., retry amplifies load on a circuit that should be open).

Configure them as a stack, not independently.
