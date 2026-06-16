# Rate Limiting & Throttling

## Why Rate Limiting

- **Protect services** from being overwhelmed by a single bad actor or runaway client
- **Ensure fair usage** across all clients
- **Cost control** for expensive operations (LLM API calls, SMS, etc.)
- **Security** — slow down brute force and credential stuffing attacks

---

## Algorithms

### Token Bucket

A bucket holds tokens (max capacity = burst size). Tokens are added at a fixed rate. Each request consumes a token. If no tokens, reject.

```
Allows burst up to bucket capacity.
Sustained rate = token refill rate.
```

**Properties:**
- Allows short bursts (up to bucket size)
- Smooth sustained rate
- Most commonly used

**Implementation (Redis):**
```lua
-- Atomic Lua script in Redis
local tokens = redis.call('get', key)
if tokens == nil then
    tokens = max_tokens
end
if tonumber(tokens) >= cost then
    redis.call('decrby', key, cost)
    redis.call('expire', key, window)
    return 1  -- allowed
else
    return 0  -- rejected
end
```

### Leaky Bucket

Requests go into a queue (the bucket). They're processed at a fixed rate. If queue is full, requests are dropped.

**Properties:**
- Enforces a strictly uniform output rate
- No bursting allowed
- Good for smoothing traffic before hitting a downstream service

### Fixed Window Counter

Count requests in a fixed time window (e.g., 1000 requests per minute). Counter resets at the start of each window.

```
Window: 00:00 - 01:00 → counter = 0
At 00:59: 900 requests used
At 01:00: counter resets → 1000 more allowed immediately
```

**Problem: boundary burst.** A client can send 1000 requests at 00:59 and 1000 more at 01:01 — 2000 requests in 2 seconds.

### Sliding Window Log

Keep a log of all request timestamps. For each new request, count timestamps within the last window.

**Pros:** Accurate, no boundary burst.
**Cons:** Memory-intensive (store every timestamp).

### Sliding Window Counter

Hybrid of fixed window and sliding window. Use two counters (current and previous window) and interpolate:

```
effective_count = prev_count * (1 - elapsed_fraction) + curr_count
```

**Pros:** Accurate, memory-efficient (only 2 counters).
**Cons:** Approximate (interpolation isn't exact).

**This is what most production systems use.**

---

## Distributed Rate Limiting

In a multi-instance environment, each instance can't maintain its own counter — that would allow N times the limit.

### Centralized Store (Redis)

All instances share a Redis counter. Use atomic operations (Lua scripts or `INCR` + `EXPIRE`).

```python
def is_allowed(user_id: str, limit: int, window_seconds: int) -> bool:
    key = f"rate_limit:{user_id}"
    pipe = redis.pipeline()
    pipe.incr(key)
    pipe.expire(key, window_seconds)
    result = pipe.execute()
    count = result[0]
    return count <= limit
```

**Consideration:** Redis becomes a critical dependency. Use Redis Cluster or Sentinel for HA.

### Local Approximation (Token Bucket per Instance)

Each instance has its own bucket with `limit / num_instances` capacity. Fast (no network call) but approximate. If instances are unequal in traffic, some may exhaust faster.

Good for high-throughput scenarios where ~20% tolerance is acceptable.

### Sliding Window with Gossip

Instances gossip their counters periodically. Each uses the max known count. Eventually consistent. Used in Envoy and similar.

---

## Rate Limit Granularity

Define limits at the right level:

- **Per IP:** Protects against bots and scrapers. Easily bypassed with IP rotation.
- **Per API Key / Client ID:** Best for API products. Clients identified by key.
- **Per User:** For authenticated endpoints. Requires auth before rate limiting.
- **Per Endpoint:** Different limits for different operations (e.g., 100 searches/min vs 10 account updates/min).
- **Global:** Protect your entire system from aggregate overload.

Layer multiple levels: per-user + per-endpoint + global.

---

## Response Headers

Always communicate rate limit state to clients:

```
X-RateLimit-Limit: 1000        # Max requests allowed in window
X-RateLimit-Remaining: 743     # Remaining in current window
X-RateLimit-Reset: 1716825600  # Unix timestamp when window resets
Retry-After: 30                # Seconds to wait (on 429 response)
```

Return **HTTP 429 Too Many Requests** when limit is exceeded.

---

## Throttling vs Rate Limiting

- **Rate Limiting:** Hard reject — over-limit requests get a 429 immediately.
- **Throttling:** Slow down — over-limit requests are queued/delayed rather than rejected. Smooths traffic but adds latency.

Throttling is better for batch processing and background jobs. Rate limiting is better for interactive APIs.

---

## Practical Considerations

### Rate Limit by Service Tier

Freemium APIs often have tiered limits:
```
Free tier:    100 requests/day
Pro tier:     10,000 requests/day
Enterprise:   Unlimited (but with fair-use monitoring)
```

Store limits in a config/DB keyed by API key or user plan. Don't hardcode.

### Rate Limit Bypass for Internal Services

Internal services shouldn't be rate limited by the same rules as external clients. Use separate API keys with higher limits, or skip rate limiting entirely for trusted internal callers (validate via mTLS or internal IP range).

### Monitoring

Key metrics:
- **Rate of 429 responses:** High 429 rate = limit too tight or under attack
- **Throttle queue depth:** If using throttling, watch for queue growth
- **Top rate-limited clients:** Identify heavy consumers for outreach or block
- **Redis latency:** Rate limiting adds to request latency — watch Redis p99
