# SLOs, SLIs, and SLAs

## The Hierarchy

**SLI → SLO → SLA**

- **SLI (Service Level Indicator):** A metric that measures a specific aspect of service behavior. The *what you measure*.
- **SLO (Service Level Objective):** A target value for an SLI. The *what you aim for*.
- **SLA (Service Level Agreement):** A contractual commitment with consequences. The *what you promise externally*.

SLOs should always be stricter than SLAs to give yourself a buffer.

---

## SLIs — What to Measure

The four golden signals (Google SRE Book):

1. **Latency:** Time to serve a request. Distinguish between successful and error latency.
2. **Traffic:** How much demand is being placed on the system (RPS, QPS).
3. **Errors:** Rate of failed requests (5xx, timeouts, wrong results).
4. **Saturation:** How "full" the service is (CPU %, memory %, queue depth).

**Common SLI formulas:**

```
# Availability SLI
availability = good_requests / total_requests

# Latency SLI (proportion-based, more useful than raw p99)
latency_sli = requests_under_threshold / total_requests

# Error rate SLI
error_rate = error_requests / total_requests
```

**Key insight for staff engineers:** Proportion-based SLIs (fraction of requests meeting a criterion) are more useful than raw metrics. They naturally account for traffic changes and are directly convertible to error budgets.

---

## SLOs — Setting Targets
### Avoid 100% targets

100% availability is unachievable and undesirable — it prohibits any maintenance, deployment, or experimentation. 99.9% allows ~8.7 hours of downtime per year.

**Availability targets and their meaning:**

| SLO | Annual Downtime | Monthly Downtime |
|---|---|---|
| 99% | 87.6 hours | 7.3 hours |
| 99.5% | 43.8 hours | 3.65 hours |
| 99.9% | 8.76 hours | 43.8 minutes |
| 99.95% | 4.38 hours | 21.9 minutes |
| 99.99% | 52.6 minutes | 4.4 minutes |
| 99.999% | 5.26 minutes | 26 seconds |

**Set SLOs based on:**
- What users actually need (not what engineering can theoretically achieve)
- Historical baseline (what have you achieved?)
- Cost of improvement (99.99% is massively more expensive than 99.9%)
- Dependency ceiling (your SLO cannot exceed your dependencies' SLOs)

### Multi-window SLOs

Define SLOs over multiple windows to catch both short spikes and long degradations:
```
Availability SLO:
- 99.9% over 30 days (rolling)
- 99.5% over 5 minutes (for alerting on current incidents)
```

---

## Error Budgets

The error budget is the allowed amount of unreliability derived from the SLO.

```
Error budget = 1 - SLO target
```

For a 99.9% availability SLO over 30 days:
```
Error budget = 0.1% of requests = ~43.8 minutes of downtime equivalent
```

**Why error budgets matter:**
- They make reliability a shared concern between dev and ops
- They create a rational framework for release velocity vs. reliability trade-offs
- If the error budget is burning fast → slow down deployments, focus on reliability
- If the error budget is full → invest it in feature velocity and experiments

### Error Budget Policies

Define what happens when budget is consumed:
- **50% consumed:** Alert. Review recent incidents. Assess risk of next deployment.
- **75% consumed:** Freeze non-critical deployments. Mandatory reliability sprint.
- **100% consumed:** Feature freeze. All hands on reliability until budget recovers.

---

## Burn Rate Alerting

Instead of alerting when SLO is breached (too late), alert when the error budget is burning too fast.

**Burn rate:** How fast you're consuming the error budget relative to normal.

```
burn_rate = current_error_rate / (1 - SLO_target)
```

A burn rate of 1 = consuming budget exactly at the sustainable rate.
A burn rate of 10 = consuming 10x faster than sustainable → will exhaust budget in 1/10th of the window.

**Multi-window multi-burn-rate alerting (Google SRE standard):**

| Alert | Short Window | Long Window | Burn Rate | Budget Consumed |
|---|---|---|---|---|
| Page | 1 hour | 5 minutes | 14.4x | ~2% in 1h |
| Page | 6 hours | 30 minutes | 6x | ~5% in 6h |
| Ticket | 3 days | 6 hours | 1x | ~10% in 3d |

Short window = fast reaction. Long window = confirmation (avoids noise from brief spikes).

---

## Defining Good SLIs for Different Services

### Request-Response Services

```
availability = count(http_responses where status < 500) / count(http_responses)

latency = count(requests completed in < 200ms) / count(requests)
```

### Data Pipelines / Batch Jobs

```
freshness = count(records processed within SLO window) / count(expected records)

correctness = count(records processed without error) / count(records processed)
```

### Storage Systems

```
durability = count(writes successfully stored) / count(writes attempted

read_availability = count(reads returning data) / count(reads attempted)
```

---

## Tracking and Reporting SLOs

Tools:
- **Prometheus + Grafana:** Query Prometheus for SLI data, build dashboards with error budget burn rate
- **Datadog SLOs:** Built-in SLO tracking with burn rate alerts
- **Google Cloud Monitoring:** Native SLO support for GCP services
- **Sloth / Pyrra:** Open-source SLO tools that generate Prometheus rules from SLO definitions

**Weekly SLO reviews:** Make it a team ritual. Review current error budget consumption, recent incidents, and reliability investments.


---

## Related

[[Incident Response & Postmortems]]  [[Fault Tolerance Patterns]]
