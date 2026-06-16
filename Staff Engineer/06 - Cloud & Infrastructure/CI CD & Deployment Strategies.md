# CI/CD & Deployment Strategies

## CI/CD Principles

**Continuous Integration:** Every commit is automatically built, tested, and validated. The main branch is always in a releasable state.

**Continuous Delivery:** Every commit that passes CI can be deployed to production at any time with one click or command.

**Continuous Deployment:** Every commit that passes CI is automatically deployed to production. No human approval.

The goal: reduce the cost, risk, and time of getting changes into production.

---

## CI Pipeline Design

A well-structured pipeline is fast, reliable, and informative.

### Typical Stages

```
Commit → Lint & Format → Unit Tests → Build → Integration Tests → Security Scan → Deploy to Staging → E2E Tests → Deploy to Production
```

### Speed Optimization

Fast feedback = faster iteration. Target: < 10 minutes for the core CI loop.

- **Parallelize:** Run unit tests, lint, and security scans in parallel
- **Cache aggressively:** `node_modules`, pip packages, Maven `.m2`, Docker build layers
- **Test splitting:** Split large test suites across multiple runners
- **Fail fast:** Run fastest checks first (lint, type checking before slower integration tests)
- **Incremental builds:** Only rebuild what changed

### Test Strategy in CI

```
Fast (< 2 min)   → Unit tests, lint, type checks   — Run on every commit
Medium (< 5 min) → Integration tests, component tests — Run on every commit
Slow (< 15 min)  → E2E tests, performance tests    — Run on merge to main
Nightly          → Full regression, security scans, chaos tests
```

### Quality Gates

Hard stops that prevent bad code from progressing:
- Code coverage drops below threshold (e.g., 80%)
- Any failing test
- Static analysis violations (security, code smells)
- License compliance issues
- Dependency vulnerabilities (CRITICAL or HIGH severity)

---

## Deployment Strategies

### Recreate (Big Bang)

Stop all old pods, start all new pods. Causes downtime. Only acceptable for dev environments.

```
Old: [v1][v1][v1]
     ↓ stop all
New: [v2][v2][v2]
```

### Rolling Update (Default in Kubernetes)

Replace pods incrementally. Some old and new versions run simultaneously.

```
[v1][v1][v1][v1] → [v2][v1][v1][v1] → [v2][v2][v1][v1] → [v2][v2][v2][v2]
```

**Pros:** No downtime, simple to implement.
**Cons:** Multiple versions running simultaneously (API must be backward compatible with old clients). Slow rollback (must roll forward, then roll back).

**Key settings:**
```yaml
strategy:
  rollingUpdate:
    maxSurge: 25%         # Max extra pods during rollout
    maxUnavailable: 0     # Never go below desired count (zero downtime)
```

### Blue/Green Deployment

Run two identical production environments. Switch traffic from old (blue) to new (green) atomically.

```
Blue (v1):  [v1][v1][v1]  ← active traffic
Green (v2): [v2][v2][v2]  ← idle (receives no traffic)

Switch: update load balancer/DNS to point to green
Blue (v1):  [v1][v1][v1]  ← idle (instant rollback target)
Green (v2): [v2][v2][v2]  ← active traffic
```

**Pros:** Instant rollback (switch LB back to blue). Clean cutover.
**Cons:** Double the infrastructure cost during deployment. DNS/LB switching can have propagation delays.

**Implementation:** AWS: weighted target groups in ALB (shift 0% → 100%). Kubernetes: service selector swap.

### Canary Deployment

Route a small percentage of traffic to the new version. Gradually increase as confidence grows.

```
v1: [v1][v1][v1][v1][v1][v1][v1][v1][v1]   (90% traffic)
v2: [v2]                                     (10% traffic)

After 1 hour with no issues:
v1: [v1][v1][v1][v1][v1]   (50% traffic)
v2: [v2][v2][v2][v2][v2]   (50% traffic)

After another hour:
v2: [v2][v2][v2][v2][v2][v2][v2][v2][v2][v2]   (100% traffic)
```

**Pros:** Real user validation. Easy to roll back (route back to v1).
**Cons:** Complex traffic splitting. Requires monitoring to detect issues early. Metrics must be comparable across v1/v2 traffic.

**Implementation:** Kubernetes + Argo Rollouts, AWS CodeDeploy, Spinnaker, Flagger (automated canary with Prometheus metrics).

### Feature Flags / Dark Launches

Deploy code to production but control who sees it via flags. Decouple deployment from release.

```python
if feature_flags.is_enabled("new-checkout-flow", user_id=user.id):
    return new_checkout_flow()
else:
    return old_checkout_flow()
```

**Targeting rules:** Enable for internal users → beta users → 1% → 10% → 100%.

**Benefits:**
- Test in production with real traffic before wide release
- Instant rollback (flip a flag)
- A/B testing capability
- Kill switch for problematic features
- Separate deployment from business release decision

**Tools:** LaunchDarkly, Unleash (open-source), Split, AWS AppConfig, Flipt.

---

## Database Migrations in CI/CD

Database migrations are the hardest part of zero-downtime deployments.

### Expand-Contract Pattern

Never do breaking schema changes in a single deploy. Use three-phase approach:

**Phase 1 (Expand):** Add the new structure. Keep old structure working.
```sql
ALTER TABLE users ADD COLUMN full_name TEXT;  -- Add new column (nullable)
-- Both old code (writes first_name/last_name) and new code work
```

**Phase 2 (Migrate):** Backfill data, run new code.
```sql
UPDATE users SET full_name = first_name || ' ' || last_name WHERE full_name IS NULL;
-- New code starts writing to full_name
```

**Phase 3 (Contract):** Remove old structure once no old code is running.
```sql
ALTER TABLE users DROP COLUMN first_name;
ALTER TABLE users DROP COLUMN last_name;
-- Only after all instances are on new version
```

### Online Schema Changes

For large tables, use tools that avoid long-running locks:
- **gh-ost (GitHub):** Online schema migration for MySQL. Shadow table approach.
- **pg_repack:** PostgreSQL table restructuring without locking.
- **pglogical:** Logical replication based migrations.

### Migration Tools

- **Flyway / Liquibase:** Version-controlled SQL migrations. Run in CI before deployment.
- **Alembic (SQLAlchemy):** Python database migrations.
- **Rails ActiveRecord migrations:** Integrated with the framework.

**Best practice:** Migrations run automatically before deploying the new app version. App must be backward compatible with both old and new schema (supports rolling deployments).

---

## GitOps

GitOps is a deployment model where the desired state of infrastructure and applications is stored in Git. Changes are applied automatically by controllers.

**Key principles:**
1. Declarative configuration in Git is the source of truth
2. Controllers continuously reconcile actual state with desired state
3. All changes happen via pull request (not `kubectl apply` by hand)
4. Rollback = revert the Git commit

**Tools:**
- **ArgoCD:** Kubernetes-native GitOps. Watches Git repos and syncs to K8s.
- **Flux:** Similar to ArgoCD. CNCF graduated project.
- **Terraform Cloud:** GitOps for infrastructure.

**Benefits:** Full audit trail (git history), easy rollback, consistent environments, peer review for infrastructure changes.
