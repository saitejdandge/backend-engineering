# Microservices vs Monolith

## The Monolith

A monolith is a single deployable unit where all application logic resides. Often misunderstood as "bad by default" — it's actually the right starting point for most systems.

### Types of Monoliths

- **Single-process monolith:** Everything in one process. Classic Rails/Django/Spring Boot app.
- **Modular monolith:** Clear module boundaries inside a single process. Best of both worlds. Shopify's approach.
- **Distributed monolith (anti-pattern):** Multiple services but tightly coupled. Worst of both worlds — you get the complexity of distributed systems without the benefits of real service autonomy.

### When Monolith is the Right Call

- Early-stage product (domain boundaries not yet clear)
- Small team (< 5-10 engineers)
- Low operational complexity tolerance
- Unclear service boundaries (splitting prematurely leads to the distributed monolith anti-pattern)

---
## Microservices
Microservices decompose an application into small, independently deployable services that each own a specific business capability.

### Core Principles

- **Single Responsibility:** Each service owns one bounded context
- **Decentralized data management:** Each service owns its own database (no shared DB)
- **Independent deployability:** Deploy without coordinating with other services
- **Failure isolation:** One service crashing doesn't bring down the whole system
- **Technology heterogeneity:** Each service can use the best tool for its job

---

## Service Decomposition Strategies

### By Business Capability

Align services with business domains. Most natural and stable over time.

Example for an e-commerce platform:
- `order-service` — order lifecycle
- `inventory-service` — stock management
- `payment-service` — payment processing
- `notification-service` — emails, SMS
- `user-service` — accounts and profiles

### By Subdomain (Domain-Driven Design)

Use DDD's bounded context concept. Each bounded context becomes a service. The context map defines how they interact (shared kernel, customer-supplier, anti-corruption layer).

### Strangler Fig Pattern

Incrementally migrate from monolith to microservices by routing traffic to new services as they replace monolith functionality. The monolith "shrinks" as new services absorb it.

Steps:
1. Identify a bounded domain in the monolith
2. Build the new service with its own data store
3. Route traffic to the new service (via a facade or API gateway)
4. Delete the old monolith code
5. Repeat

---

## Inter-Service Communication

### Synchronous (Request-Response)

- **REST (HTTP/JSON):** Simple, broadly understood, stateless. Drawback: tight temporal coupling — caller waits.
- **gRPC:** Protocol Buffers, strongly typed, HTTP/2, bidirectional streaming. Better for internal service-to-service calls. Lower latency.
- **GraphQL:** Query flexibility. Better for client-facing APIs where clients need different shapes.

**Problem with synchronous calls:** Cascading failures. If Service C is slow, it backs up Service B, which backs up Service A. Use circuit breakers and timeouts.

### Asynchronous (Event-Driven)

- Services communicate via events/messages. Producer doesn't wait for consumer.
- **Loose temporal coupling:** Consumer can be down; messages queue up.
- **Harder to trace:** Debugging requires distributed tracing.

Patterns:
- **Event Notification:** "Something happened." Consumer decides what to do. Fire-and-forget.
- **Event-Carried State Transfer:** Event contains all data consumer needs. No need to call back.
- **Event Sourcing:** State is derived from a log of events. Complete audit trail.

---

## Data Management in Microservices

### Database per Service (Non-negotiable)

Sharing a database couples services at the data layer — defeats the purpose of microservices.

Each service owns its schema and decides its storage technology:
- `user-service` → PostgreSQL
- `search-service` → Elasticsearch
- `session-service` → Redis
- `activity-service` → Cassandra

### Handling Joins Across Services

You can't do a SQL join across service databases. Options:

1. **API composition:** Call both services and merge in memory (in an aggregator/BFF)
2. **CQRS + read-side projections:** Replicate data into a dedicated read model (denormalized) for query needs
3. **Event-driven data replication:** Services publish events; consumers build their own local view

### Distributed Transactions Without 2PC

Use the **Saga pattern** (see Distributed Systems Fundamentals). Each step is a local transaction. Failures trigger compensating transactions.

---

## API Gateway

A single entry point for clients. Handles:
- **Routing:** Directs requests to the appropriate service
- **Authentication/Authorization:** Central JWT validation
- **Rate limiting:** Protects services from overload
- **Request aggregation:** Combines multiple service calls into one client response (BFF pattern)
- **SSL termination, logging, tracing**

Popular: Kong, AWS API Gateway, Nginx, Envoy.

---

## Service Mesh

A dedicated infrastructure layer for service-to-service communication. Typically implemented as a **sidecar proxy** (Envoy) alongside each service.

Capabilities:
- **mTLS between services** (automatic, without app code changes)
- **Traffic management:** Load balancing, retries, circuit breaking, canary routing
- **Observability:** Automatic distributed tracing and metrics
- **Policy enforcement:** Access control between services

Popular: Istio, Linkerd, AWS App Mesh.

**When to use:** Complex microservice environments with many services, strict security requirements, or need for fine-grained traffic control. Adds operational complexity — don't add it prematurely.

---

## Organizational Coupling (Conway's Law)

> "Organizations which design systems are constrained to produce designs which are a copy of the communication structures of those organizations."

If two teams own the same service, you'll get tight coupling. Microservices work best when service boundaries align with team boundaries. This is why Amazon's "two-pizza team" model maps well to microservices.

**Inverse Conway Maneuver:** Deliberately structure teams to drive the architecture you want.

---

## Trade-off Summary

| Dimension              | Monolith         | Microservices          |
| ---------------------- | ---------------- | ---------------------- |
| Operational Complexity | Low              | High                   |
| Deployment             | One artifact     | Per-service CI/CD      |
| Team Autonomy          | Low              | High                   |
| Data Consistency       | ACID             | Eventual               |
| Debugging              | Simple           | Requires tracing       |
| Scalability            | Scale everything | Scale per service      |
| Initial Velocity       | High             | Lower (infra overhead) |
| Failure Isolation      | None             | Strong                 |

---

## When to Split a Monolith

Split when you see:
- Different scaling requirements (e.g., video processing vs. authentication)
- A team is blocked by another team's code changes
- A part of the system needs different deployment frequency
- Clear, stable domain boundaries have emerged
- Specific compliance or security isolation requirements

**Red flag:** Splitting too early is a common mistake. Premature decomposition leads to a distributed monolith — you get all the pain with none of the gains.
