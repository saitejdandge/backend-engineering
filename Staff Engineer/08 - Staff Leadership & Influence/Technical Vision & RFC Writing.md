# Technical Vision & RFC Writing

## What Staff Engineers Own

At the staff level, your most valuable output is often not code — it's clarity. You help your organization make better technical decisions, avoid expensive mistakes, and build systems that scale well over time.

This requires:
- Writing technical proposals that build consensus
- Defining technical direction across teams
- Making architectural decisions durable and traceable

---

## Architecture Decision Records (ADRs)

ADRs capture the context, decision, and consequences of a significant architectural choice. They're lightweight and fast to write.

### ADR Format

```markdown
# ADR-042: Use Kafka for async order processing

**Date:** 2024-01-15
**Status:** Accepted
**Deciders:** @alice (tech lead), @bob (infra), @carol (product eng)

## Context

Order processing currently happens synchronously in the API request cycle.
This causes:
- P99 latency of 800ms on order creation (payment + inventory in serial)
- Payment service timeouts causing order creation failures (2% error rate)
- No retry mechanism for transient failures

## Decision

Introduce Kafka to decouple order creation from fulfillment steps.
Order creation API will: validate → persist → publish event → return 201.
Fulfillment (payment, inventory, notifications) will consume events asynchronously.

## Alternatives Considered

**SQS:** Simpler to operate, but no event replay capability. We expect to need
replay for audit and new consumer onboarding. Eliminated.

**Direct async (background threads):** Loses durability on deployment. Eliminated.

**RabbitMQ:** No meaningful advantage over Kafka for our use case. Team has
more Kafka experience. Eliminated.

## Consequences

**Positive:**
- Order creation P99 drops from 800ms to ~50ms
- Payment failures no longer cause order creation failures
- Event replay enables future analytics and audit use cases

**Negative:**
- Order fulfillment becomes eventually consistent (users see "processing" state)
- Ops complexity: need to operate Kafka cluster or use Confluent Cloud ($$$)
- Requires consumer idempotency implementation

## Implementation Notes

- Use Confluent Cloud to avoid self-managed Kafka ops
- Partition by user_id for ordering guarantees per user
- Consumer group: `order-fulfillment-service`
- Monitoring: consumer lag alert at > 1000 messages
```

**Why ADRs matter at staff level:** Six months later, a new engineer asks "Why are we using Kafka instead of just calling the payment service directly?" Without an ADR, this knowledge is lost. With one, they understand the full context.

---

## RFC (Request for Comments) Process

RFCs are for larger proposals that need broader input before a decision is made. They invite discussion, surface concerns, and build consensus.

### When to Write an RFC

- Cross-team impact (multiple services or teams affected)
- Significant investment (> 2 sprint weeks of work)
- Reversible-but-costly decisions (changing the auth system, migrating DBs)
- Greenfield systems where the design space is wide

### RFC Structure

```markdown
# RFC: Unified Rate Limiting Service

**Author:** Saitej Dandge
**Date:** 2024-01-15
**Status:** Draft (→ Review → Accepted/Rejected)
**Review deadline:** 2024-01-29

## Summary

A one-paragraph, jargon-free description of the proposal.

We propose extracting rate limiting logic into a shared service ("Limiter")
backed by Redis Cluster. Currently, 7 different services implement their own
rate limiting with inconsistent algorithms and no visibility across services.
A unified service enables per-customer aggregate rate limits and a single
operational surface.

## Motivation

Why is this worth doing? What's the pain today?

- 7 separate implementations → inconsistency, maintenance burden
- No cross-service rate limiting (a customer can hit each service's limit independently)
- Recent incidents: three different teams discovered the same Redis race condition bug
- New service teams implement from scratch every time

## Detailed Design

The technical proposal in full detail. Be specific. Include:
- Architecture diagram
- API contract
- Data model
- Failure modes and mitigations
- Migration plan

## Alternatives Considered

Show that you explored the space.

**Option A (status quo):** [pros/cons]
**Option B (library, not service):** [pros/cons]
**Option C (API gateway):** [pros/cons]

## Drawbacks

Be honest about the downsides. Engineers trust proposals more when they
acknowledge trade-offs.

## Open Questions

Things you want input on:
- Should we support per-endpoint limits or only per-client?
- Which teams should be the first adopters?
- What SLA does the Limiter service itself need?

## Rollout Plan

How will you migrate from current state to desired state?
Phase 1: Build service, onboard Team A
Phase 2: Onboard remaining teams over 6 weeks
Phase 3: Deprecate per-service implementations
```

### RFC Process

1. **Draft:** Author writes the RFC. Shares with trusted peers for early feedback.
2. **Review period:** Post to engineering channel. Set a comment deadline (1-2 weeks).
3. **Async discussion:** Comments, questions, alternatives surface. Author responds and revises.
4. **Decision meeting (if needed):** For controversial proposals. Time-boxed. Produces a decision.
5. **Accept/Reject/Revise:** Status updated. Decision recorded.
6. **Implementation:** If accepted, RFC becomes the implementation spec.

### Writing Effective RFCs

- **Lead with the problem, not the solution.** Get readers to agree the problem is worth solving before pitching the solution.
- **Be specific.** Vague proposals produce vague feedback. Include actual API contracts, not "we'll have an API."
- **Acknowledge drawbacks.** Engineers distrust proposals that have no downsides.
- **Make it easy to disagree.** The goal is the best decision, not approval of your idea. Invite criticism explicitly.
- **Short is better than long.** If it can be said in 1 page, don't make it 5.

---

## Technical Vision Documents

For longer-horizon direction (6-18 months). Not a single decision, but a coherent direction for how the system should evolve.

### Structure

1. **Where we are:** Honest assessment of current state, including problems
2. **Where we want to be:** The target state and why it matters
3. **The gap:** What stands between current and target state
4. **Principles:** Guiding rules for decision-making along the way
5. **Roadmap:** Sequenced initiatives to close the gap

### Writing Style

- Avoid jargon when possible. Product managers and executives should be able to understand the "where we are" and "where we want to be" sections.
- Be specific about the problems. "Our system is hard to maintain" → "Adding a new payment method requires changes in 11 different places, causing bugs in 3 of the last 4 payment integrations."
- Make the vision inspiring, not just technically correct. Why does this matter for the business?

### Gaining Alignment

A technical vision only has value if people follow it. Alignment comes from:
- **Involving stakeholders early:** Engineers whose work will be affected should co-author or review
- **Connecting to business outcomes:** Frame technical debt and refactoring in terms of developer velocity, reliability, and business agility
- **Maintaining it:** A vision document that's 18 months out of date is worse than none
- **Revisiting regularly:** Quarterly review of the vision against current priorities


---

## Related

[[Scope Amplification & Influence]]  [[Navigating Ambiguity]]
