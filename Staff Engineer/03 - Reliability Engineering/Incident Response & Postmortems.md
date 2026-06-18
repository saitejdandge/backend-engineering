# Incident Response & Postmortems

## Incident Severity Levels

Define severity before an incident happens. Ambiguity during an incident costs time.

| Level | Definition | Response Time | Example |
|---|---|---|---|
| SEV-1 | Complete service outage or critical data loss | Immediate (< 5 min) | Checkout completely broken, data corruption |
| SEV-2 | Major feature broken, significant user impact | < 15 min | Payments degraded, 50% error rate |
| SEV-3 | Partial degradation, workaround exists | < 1 hour | Slow search, minor feature broken |
| SEV-4 | Minor issue, no immediate user impact | Next business day | Dashboard metric wrong, UI glitch |

---

## Incident Response Playbook

### Detect

- Monitoring alert fires (PagerDuty, OpsGenie)
- User reports via support
- Anomaly in a dashboard

**Never rely solely on users to detect incidents.** Your monitoring should catch most issues before users do.

### Triage

Immediately ask:
1. What is the user impact? (what % of users, which features)
2. What is the severity? (use your definition above)
3. Is it still happening or was it transient?
4. Is it getting better or worse?

### Mobilize

- Declare the incident in your incident management tool (PagerDuty, Incident.io, Opsgenie)
- Create an incident Slack channel: `#inc-YYYY-MM-DD-short-description`
- Assign roles:
  - **Incident Commander (IC):** Coordinates response. Doesn't debug — manages.
  - **Tech Lead:** Leads technical investigation and fix.
  - **Comms Lead:** Handles stakeholder updates and status page.
  - **Scribe:** Documents timeline in real time.

### Investigate

Approach: **narrow the scope**. Use the scientific method.

```
Hypothesis → Test → Observe → Narrow or pivot
```

Useful starting questions:
- When did it start? (correlate with deployments, config changes, traffic spikes)
- What changed? (recent deploys, infra changes, upstream dependencies)
- Where is it failing? (which service, which region, which user segment)
- What do the logs/traces say?

Tools: distributed traces (Jaeger, Zipkin), centralized logs (Datadog, Splunk, Loki), metrics dashboards (Grafana), DB slow query logs.

### Communicate

**Internal (every 30 minutes minimum):**
> "Update: We've identified the issue is in the payment gateway integration. The team is working on a fix. ETA unknown."

**External (status page):**
> "We are investigating increased error rates on the checkout page. We will provide an update in 30 minutes."

Be honest about uncertainty. "ETA unknown" is better than a missed ETA that erodes trust.

### Mitigate (Stop the Bleeding)

Mitigation ≠ fix. Mitigation reduces user impact immediately while the root cause is being fixed.

Common mitigations:
- **Rollback deployment** (if a recent deploy caused it)
- **Feature flag off** (disable the broken feature)
- **Increase capacity** (if it's a resource saturation issue)
- **Reroute traffic** (to a healthy region or datacenter)
- **Disable a dependency** (if a downstream is causing cascading failures)
- **Cache stale data** (if real-time data source is down)

Mitigation speed matters more than elegance. A dirty fix that stops user pain in 5 minutes beats a clean fix in 2 hours.

### Resolve

- Confirm metrics return to normal
- Remove any temporary mitigations (or schedule their removal)
- Declare incident resolved with a clear "resolved at" timestamp
- Send final customer communication

---

## Blameless Postmortem

The postmortem is not about finding who to blame — it's about finding why the system failed and how to prevent it. People make mistakes; systems should be designed to withstand them.

**When to write a postmortem:**
- All SEV-1 incidents
- All SEV-2 incidents
- Any SEV-3 with unusual characteristics or repeated occurrence
- Near-misses worth learning from

### Postmortem Structure

**1. Summary**
One paragraph. What happened, when, what was the user impact, how was it resolved.

**2. Timeline**
Chronological log with timestamps. Key events: when it started, when detected, when escalated, when mitigated, when resolved.

```
14:02 — Deployment of v2.3.1 to production
14:07 — Alert fired: payment error rate > 5%
14:09 — On-call engineer paged
14:15 — Incident declared SEV-2
14:22 — Root cause identified: missing DB index in migration
14:30 — Rollback initiated
14:41 — Error rate returned to baseline
14:45 — Incident resolved
```

**3. Root Cause Analysis**

Use **5 Whys** to get past symptoms to root cause:
```
Why did users get errors? → Payment service returned 500s
Why did payment service error? → DB queries timing out
Why were queries timing out? → Missing index on orders table after migration
Why was the index missing? → Migration script dropped and didn't recreate the index
Why wasn't this caught? → No migration review process and no load test against prod data volume
```

Real root causes are almost always process/system failures, not individual mistakes.

**4. Impact**
- Duration: X minutes
- Users affected: N (or % of traffic)
- Revenue impact: $X (if calculable)
- SLO impact: X% of error budget consumed

**5. What Went Well**
- Detection was fast (alert fired within 5 minutes)
- Rollback procedure worked smoothly
- Communication was clear and timely

**6. What Went Poorly**
- The issue wasn't caught in staging
- Alert threshold was too loose (should have fired earlier)
- Runbook was out of date

**7. Action Items**

Each action item must have:
- A clear, specific task (not "improve monitoring" — too vague)
- An owner (specific person, not a team)
- A due date

```
| Action Item | Owner | Due Date |
|---|---|---|
| Add query performance test to migration CI pipeline | @alice | 2024-02-15 |
| Update DB migration runbook | @bob | 2024-02-10 |
| Reduce payment error alert threshold from 5% to 1% | @carol | 2024-02-08 |
```

### Postmortem Anti-Patterns

- **Blame:** "Alice deployed without testing." → Irrelevant and harmful.
- **Vague action items:** "Improve our process" → Never gets done.
- **No follow-through:** Action items written but never tracked.
- **Too long:** If nobody reads it, it helped no one. Aim for 1-2 pages max.
- **Too quick:** Writing a postmortem 30 minutes after resolution means you haven't fully understood root cause.

---

## On-Call Best Practices

### Runbooks

A runbook is a documented procedure for handling a specific alert or scenario. Good runbooks:
- Describe what the alert means and its likely causes
- Provide step-by-step diagnostic commands
- List common fixes with exact commands/steps
- Include escalation path if runbook doesn't resolve it

```markdown
## Alert: HighPaymentErrorRate

**What it means:** Payment service error rate > 1% for 5 minutes.

**Likely causes:**
1. Payment gateway downstream outage
2. Recent deployment with a bug
3. DB connection pool exhaustion

**Diagnostic steps:**
1. Check payment gateway status page: https://status.stripe.com
2. Check for recent deployments: `kubectl rollout history deployment/payment-service`
3. Check connection pool metrics in Grafana: [link]

**Fixes:**
- If gateway down: Enable fallback mode via feature flag `payment_fallback_enabled`
- If recent deploy: `kubectl rollout undo deployment/payment-service`
- If connection pool: Increase pool size in ConfigMap and redeploy
```

### Sustainable On-Call

- **Interrupt rate:** On-call should not page more than 1-2 times per shift for SEV-1/2 issues
- **Actionable alerts only:** Every alert should require a human response. Non-actionable = alert fatigue = ignored alerts
- **Compensation:** On-call shifts should be compensated (time off or financial)
- **Follow the sun:** Distribute on-call across time zones to avoid overnight shifts
- **Rotation size:** Minimum 5-6 people in a rotation to avoid burnout


---

## Related

[[Fault Tolerance Patterns]]  [[SLOs SLIs and SLAs]]
