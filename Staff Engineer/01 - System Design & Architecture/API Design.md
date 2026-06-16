# API Design

## REST Design Principles

REST (Representational State Transfer) is an architectural style, not a protocol. Most "REST" APIs are actually just HTTP APIs — true REST adheres to specific constraints.

### Core Constraints

1. **Uniform Interface:** Resources identified by URIs. Manipulate resources through representations. Self-descriptive messages. HATEOAS (hypermedia).
2. **Statelessness:** Each request must contain all information needed. No client state stored on server between requests.
3. **Cacheability:** Responses must be marked as cacheable or not. Reduces latency.
4. **Layered System:** Client doesn't know if it's talking to origin server or intermediary.
5. **Client-Server Separation:** UI concerns separate from data storage concerns.

### Resource Naming

Use **nouns, not verbs**. Resources are things, not actions.

```
 GET /orders/{id}
 GET /getOrder/{id}

 POST /orders           (create an order)
 POST /createOrder

 PUT /orders/{id}       (full replace)
 PATCH /orders/{id}     (partial update)
 DELETE /orders/{id}
```

### HTTP Status Codes (Use Correctly)

| Code | Meaning | When to Use |
|---|---|---|
| 200 | OK | Successful GET, PATCH, PUT |
| 201 | Created | Successful POST |
| 204 | No Content | Successful DELETE |
| 400 | Bad Request | Validation errors, malformed input |
| 401 | Unauthorized | Missing/invalid authentication |
| 403 | Forbidden | Authenticated but not authorized |
| 404 | Not Found | Resource doesn't exist |
| 409 | Conflict | Duplicate resource, version conflict |
| 422 | Unprocessable Entity | Semantic validation failure |
| 429 | Too Many Requests | Rate limit exceeded |
| 500 | Internal Server Error | Unhandled server error |
| 503 | Service Unavailable | Temporarily down, circuit open |

### Pagination

Never return unbounded lists. Three patterns:

**Offset Pagination:**
```
GET /orders?offset=100&limit=20
```
- Simple to implement, easy to understand
- Problem: data shifts if items are inserted/deleted between pages (page drift)
- Expensive for large offsets (DB must scan through all skipped rows)

**Cursor Pagination:**
```
GET /orders?cursor=eyJpZCI6MTIzfQ&limit=20
```
- Cursor encodes position (usually base64'd last item ID or timestamp)
- Stable: no drift from concurrent writes
- Can't jump to arbitrary page
- Best for real-time feeds and large datasets

**Keyset Pagination:**
```
GET /orders?after_id=123&limit=20
```
- Uses indexed column to avoid full scans
- Efficient for DB (uses index seek instead of offset scan)
- Variation of cursor pagination

**Recommendation:** Use cursor/keyset for production APIs. Offset only for admin tools with small datasets.

### Versioning

Three approaches:

- **URL versioning:** `GET /v1/orders` — Most visible and commonly used. Easy to route. Creates duplication.
- **Header versioning:** `Accept: application/vnd.myapp.v2+json` — Cleaner URLs. Harder to test in browser.
- **Query param:** `GET /orders?version=2` — Least preferred. Versioning should be structural, not a query concern.

**Recommendation:** URL versioning for external/public APIs. Header versioning for internal where you control clients.

---

## gRPC

gRPC is a high-performance RPC framework using Protocol Buffers (Protobuf) as the IDL and serialization format, running over HTTP/2.

### Why gRPC

- **Performance:** Protobuf is binary — much smaller and faster to serialize than JSON
- **Strong typing:** Schema defined in `.proto` files. Code generated for both client and server.
- **Streaming:** Four communication patterns (see below)
- **HTTP/2:** Multiplexed connections, header compression, bidirectional streaming
- **Ecosystem:** Health checks, reflection, interceptors (like middleware)

### Communication Patterns

```protobuf
// Unary (request-response)
rpc GetOrder (GetOrderRequest) returns (Order);

// Server streaming (one request, many responses)
rpc ListOrders (ListOrdersRequest) returns (stream Order);

// Client streaming (many requests, one response)
rpc BatchCreateOrders (stream CreateOrderRequest) returns (BatchResult);

// Bidirectional streaming
rpc OrderUpdates (stream OrderRequest) returns (stream OrderEvent);
```

### When to Use gRPC

- Internal service-to-service communication
- Low latency, high throughput requirements
- Need for strong contracts between teams
- Streaming data (real-time updates, log streaming)

### When NOT to Use gRPC

- Browser clients (gRPC-Web adds complexity)
- Simple public APIs (REST is more universally understood)
- Teams without experience with protobuf tooling

---

## GraphQL

GraphQL is a query language for APIs and runtime for executing those queries. Clients specify exactly what data they need.

### Core Concepts

- **Schema:** Strongly typed definition of all types and operations
- **Query:** Read operations
- **Mutation:** Write operations
- **Subscription:** Real-time event stream
- **Resolver:** Function that fetches data for each field

```graphql
# Client asks for exactly what it needs
query {
  order(id: "123") {
    id
    status
    items {
      productName
      quantity
    }
    customer {
      name
      email
    }
  }
}
```

### Advantages

- **No over-fetching:** Client gets exactly what it asked for
- **No under-fetching:** One request can get data from multiple "resources"
- **Strongly typed schema:** Self-documenting, introspectable
- **Evolve without versioning:** Add fields; old clients ignore them

### Problems

- **N+1 problem:** Naively implemented, each nested field triggers a separate DB query. Fix: DataLoader (batching + caching).
- **Query complexity attacks:** Clients can craft deeply nested queries that are expensive. Implement query depth limits and complexity scoring.
- **Caching is harder:** HTTP caching is trivial for REST (URL = cache key). GraphQL POSTs don't cache easily. Use persisted queries.
- **Error handling:** GraphQL returns 200 even for errors (errors are in the response body). Requires explicit error handling conventions.

### DataLoader Pattern

```javascript
// Without DataLoader: N+1 queries
orders.map(order => db.getUser(order.userId)) // N separate queries

// With DataLoader: batched into 1 query
const userLoader = new DataLoader(userIds => db.getUsersByIds(userIds))
orders.map(order => userLoader.load(order.userId)) // batched
```

### When to Use GraphQL

- Client-facing APIs with diverse clients (mobile, web, third-party)
- Teams where frontend and backend evolve independently
- Complex, relationship-heavy data models

### When NOT to Use GraphQL

- Simple CRUD APIs
- Internal service-to-service communication (use gRPC)
- Teams unfamiliar with the ecosystem

---

## API Design Best Practices

### Idempotency

For non-idempotent operations (POST), support idempotency keys:

```
POST /payments
Idempotency-Key: a8098c1a-f86e-11da-bd1a-00112444be1e
```

Server stores the result for that key. Duplicate requests return the same result without side effects. Critical for payment and order creation APIs.

### Error Responses

Be consistent. Use a standard error schema:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid email format",
    "details": [
      { "field": "email", "issue": "Must be a valid email address" }
    ],
    "requestId": "req_abc123",
    "timestamp": "2024-01-15T10:30:00Z"
  }
}
```

Never expose stack traces or internal error messages to clients.

### Rate Limiting Headers

```
X-RateLimit-Limit: 1000
X-RateLimit-Remaining: 750
X-RateLimit-Reset: 1684800000
Retry-After: 30
```

### API Documentation

- Use OpenAPI (Swagger) for REST — machine-readable, generates clients and docs
- Use `.proto` files as documentation for gRPC
- Document every endpoint: purpose, request/response schemas, error codes, examples
- Changelog with breaking vs. non-breaking changes

### Backward Compatibility

Breaking changes:
- Removing fields
- Changing field types
- Changing required fields
- Changing URL structure

Non-breaking changes:
- Adding optional fields
- Adding new endpoints
- Adding new optional query params

When making breaking changes, version the API or use a deprecation period with warnings in response headers.

---

## API Security Essentials

- **Always use HTTPS** — Never transmit API keys or tokens over HTTP
- **Validate all input** — Never trust client data. Validate type, length, format, range.
- **Never expose internal IDs** — Use UUIDs or opaque tokens, not auto-increment IDs (enumeration attacks)
- **Implement CORS properly** — Whitelist specific origins, don't use `*` for authenticated endpoints
- **Audit logging** — Log who did what and when. Required for compliance.
