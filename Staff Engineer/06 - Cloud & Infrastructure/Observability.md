# Observability

## The Three Pillars

Observability is the ability to understand the internal state of a system from its external outputs.

- **Metrics:** Numeric measurements over time. "What is happening?"
- **Logs:** Timestamped records of discrete events. "What happened?"
- **Traces:** End-to-end request flows across services. "Why is this slow?"

Each pillar has different strengths. You need all three.

---

## Metrics

### Prometheus

Pull-based metrics system. Prometheus scrapes `/metrics` endpoints on a schedule. Stores time-series data in its own TSDB.

**Metric types:**
- **Counter:** Always increasing. Resets on restart. Use for request counts, error counts, bytes processed. Query as `rate(metric[5m])`.
- **Gauge:** Can go up or down. Use for current memory usage, queue depth, active connections.
- **Histogram:** Samples observations into configurable buckets. Calculates quantiles on the server. Use for request latency, response size.
- **Summary:** Like histogram but quantiles calculated on client. Less flexible for aggregation across instances.

```python
from prometheus_client import Counter, Histogram, start_http_server

REQUEST_COUNT = Counter('http_requests_total', 'Total HTTP requests', ['method', 'endpoint', 'status'])
REQUEST_LATENCY = Histogram('http_request_duration_seconds', 'HTTP request duration',
                             ['endpoint'], buckets=[.005, .01, .025, .05, .1, .25, .5, 1, 2.5])

@app.route('/orders')
def get_orders():
    with REQUEST_LATENCY.labels(endpoint='/orders').time():
        result = fetch_orders()
        REQUEST_COUNT.labels(method='GET', endpoint='/orders', status='200').inc()
        return result
```

### PromQL (Prometheus Query Language)

```promql
# Request rate over last 5 minutes
rate(http_requests_total[5m])

# Error rate (fraction)
rate(http_requests_total{status=~"5.."}[5m]) / rate(http_requests_total[5m])

# p99 latency from histogram
histogram_quantile(0.99, rate(http_request_duration_seconds_bucket[5m]))

# CPU usage by pod
sum(rate(container_cpu_usage_seconds_total[5m])) by (pod)

# Memory usage
container_memory_working_set_bytes{namespace="production"}
```

### Grafana

Visualization layer on top of Prometheus (and other data sources: CloudWatch, Datadog, InfluxDB, Loki).

**Dashboard best practices:**
- Top-level: SLO status (is the service healthy right now?)
- Mid-level: RED metrics (Rate, Errors, Duration) per service
- Detail level: Resource usage (CPU, memory, connections), custom business metrics
- Include links to runbooks from alert panels

### The USE Method (for Resources)

For every resource: **U**tilization, **S**aturation, **E**rrors.
- CPU: utilization %, run queue length, context switch errors
- Memory: utilization %, swap usage, OOM events
- Disk: utilization %, I/O wait, disk errors
- Network: bandwidth utilization, packet drop rate, TCP errors

### The RED Method (for Services)

For every service: **R**ate, **E**rrors, **D**uration.
- Rate: requests per second
- Errors: error rate (fraction of failed requests)
- Duration: latency (p50, p95, p99)

---

## Logging

### Structured Logging

Always log in JSON. Never log unstructured strings — they can't be queried effectively.

```python
import structlog

logger = structlog.get_logger()

logger.info("order_created",
    order_id="order-123",
    user_id="user-456",
    total=99.99,
    items_count=3,
    duration_ms=42,
    request_id="req-789"
)
```

Output:
```json
{"event": "order_created", "order_id": "order-123", "user_id": "user-456", "total": 99.99, "duration_ms": 42, "timestamp": "2024-01-15T10:30:00Z", "level": "info"}
```

### What to Log

**Always include:**
- Timestamp (ISO 8601)
- Log level (DEBUG, INFO, WARN, ERROR)
- Request ID / Trace ID (for correlation)
- Service name and version
- User/tenant ID (when relevant)

**Log at INFO:** Significant business events (order created, payment processed, user signed up)
**Log at WARN:** Unexpected but handled situations (retry triggered, fallback used, deprecated API called)
**Log at ERROR:** Failures that require attention (payment failed, external API error, DB timeout)
**Log at DEBUG:** Verbose diagnostic info (only enable in dev or for specific debugging sessions)

**Never log:**
- Passwords, tokens, secrets
- Full credit card numbers or SSNs (PII — log last 4 digits only)
- Full request bodies (may contain sensitive data)

### Log Aggregation Stack

**ELK Stack:** Elasticsearch (storage/search) + Logstash (processing) + Kibana (visualization)
**EFK Stack:** Elasticsearch + Fluentd + Kibana (Fluentd more efficient than Logstash)
**Loki + Grafana:** Grafana's log aggregation. Stores log metadata in labels, raw logs in object storage. Cheaper than Elasticsearch. PromQL-like query language (LogQL).
**Datadog Logs:** Managed log platform with tight integration with traces and metrics.

### Log Sampling

At high volume (1M+ logs/min), storing every log is expensive. Use sampling for DEBUG/INFO logs:
- Keep 100% of ERROR and WARN
- Sample INFO at 10-50%
- Sample DEBUG at 1%

Always keep logs correlated to traces — if a trace is sampled, keep all its logs.

---

## Distributed Tracing

### How Tracing Works

A trace represents one end-to-end request. It's made of **spans**. Each span represents a unit of work in one service.

```
Trace ID: abc123

 Span: API Gateway (10ms)
    Span: order-service.createOrder (150ms)
       Span: db.insert_order (20ms)
       Span: payment-service.charge (100ms)
          Span: stripe.createCharge (85ms)
       Span: kafka.publish_OrderCreated (5ms)
    Span: notification-service.sendEmail (30ms)
```

The trace shows where time was spent and which service is the bottleneck.

### OpenTelemetry (OTel)

The standard for instrumentation. Vendor-neutral. Define once, export anywhere (Jaeger, Zipkin, Datadog, Honeycomb, etc.).

```python
from opentelemetry import trace
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import OTLPSpanExporter

tracer = trace.get_tracer("order-service")

def create_order(user_id: str, items: list):
    with tracer.start_as_current_span("create_order") as span:
        span.set_attribute("user.id", user_id)
        span.set_attribute("order.items_count", len(items))
        
        with tracer.start_as_current_span("db.insert"):
            order = db.insert_order(user_id, items)
            span.set_attribute("order.id", order.id)
        
        return order
```

### Trace Context Propagation

Trace ID and span ID must be passed between services via headers (W3C TraceContext standard):
```
traceparent: 00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01
```

Most OTel SDKs handle this automatically via HTTP middleware.

### Sampling Strategies

100% trace sampling at scale is expensive. Options:
- **Head-based sampling:** Decide at the start whether to sample a request. Simple, but you might sample boring successful requests and miss rare failures.
- **Tail-based sampling:** Collect all spans, decide whether to keep the trace after it completes. Can prioritize keeping errors and slow traces. More complex infrastructure.
- **Probability sampling:** Keep X% of all traces. Adjust rate by endpoint (always keep 100% of errors).

---

## Alerting Best Practices

### Alert on Symptoms, Not Causes

```
# BAD: Alert on cause (CPU high)
alert: HighCPU
expr: cpu_utilization > 80%
# This may or may not affect users

# GOOD: Alert on symptom (users are affected)
alert: HighErrorRate
expr: rate(http_errors[5m]) / rate(http_requests[5m]) > 0.01
# This definitely affects users
```

### Every Alert Must Be Actionable

If an alert fires and the engineer can't take an action to fix it, it's not a good alert. Either:
- Fix the underlying issue so it doesn't fire
- Add the action to the runbook
- Remove the alert

### Alert Fatigue

Too many alerts → engineers ignore them → real incidents go unnoticed.

- Every alert should fire less than once per week per engineer on average
- Review alerts after every incident: was there an alert that should have fired earlier? Did a false alert distract?
- Delete or raise thresholds for noisy, non-actionable alerts

### SLO-Based Alerting

Alert on error budget burn rate (as described in the SLOs note). This is the gold standard:
- You alert when users are actually being affected at a meaningful rate
- Fast burn (page): 14.4x burn rate over 1 hour
- Slow burn (ticket): 1x burn rate over 3 days


---

## Related

[[Kubernetes Deep Dive]]  [[CI CD & Deployment Strategies]]
