# API Security & OWASP Top 10

## OWASP API Security Top 10 (2023)

### 1. Broken Object Level Authorization (BOLA / IDOR)

The most common and dangerous API vulnerability. Attacker accesses resources belonging to other users by manipulating object IDs.

```
# Attacker's request (user_id=456 but requesting user_id=789's orders)
GET /api/orders/789/details
Authorization: Bearer <user_456_token>
```

**Fix:**
- Always verify the authenticated user has access to the specific object being requested
- Never trust client-supplied IDs without authorization check
- Use indirect references (UUIDs instead of sequential integers reduce guessability, but don't fix the underlying auth bug)

```python
def get_order(order_id: str, current_user: User):
    order = db.get_order(order_id)
    if order is None:
        raise NotFoundError()
    # CRITICAL: verify ownership
    if order.user_id != current_user.id and not current_user.is_admin:
        raise ForbiddenError()
    return order
```

### 2. Broken Authentication

- Weak passwords allowed
- No account lockout on brute force
- JWT secrets that are too weak or predictable
- JWT algorithm not validated (accepts `alg: none`)
- Access tokens with no expiry
- Sensitive tokens in URLs (logs, browser history)

**Fix:**
- Enforce strong password policy
- Implement rate limiting on auth endpoints
- Use short-lived JWTs (15 min) + refresh tokens
- Always validate JWT algorithm, issuer, audience, expiry

### 3. Broken Object Property Level Authorization

Similar to BOLA but at the field level. Attacker reads or writes fields they shouldn't access.

```json
// Request to update profile
PUT /api/users/123
{"name": "Alice", "role": "admin"}  // ← Attacker injects 'role' field
```

**Fix:**
- Use explicit allowlist of fields that can be updated (not blacklist)
- Never bind request body directly to ORM model (mass assignment vulnerability)

```python
# BAD: Mass assignment
user.update(request.json)  # Attacker can set any field

# GOOD: Explicit allowlist
allowed_fields = {"name", "email", "phone"}
updates = {k: v for k, v in request.json.items() if k in allowed_fields}
user.update(updates)
```

### 4. Unrestricted Resource Consumption

No limits on request payload size, query depth, or computation. Enables DoS.

**Fix:**
- Limit request body size (nginx `client_max_body_size`, app-level limits)
- Limit pagination page size (max 100 items, not unlimited)
- Limit GraphQL query depth and complexity
- Rate limit expensive operations

### 5. Broken Function Level Authorization

Users can access admin-only functions. Often hidden endpoints assumed "safe by obscurity."

```
GET /api/admin/users       # Should require admin role — sometimes doesn't
DELETE /api/users/789      # Should require admin or own account
```

**Fix:**
- Enforce role/permission checks at the function level, not just at the route level
- Don't rely on hiding endpoints
- Use middleware/decorator that enforces permissions

### 6. Unrestricted Access to Sensitive Business Flows

APIs designed for legitimate use but with no abuse protection. Inventory reservation abuse, automated form submission, scalper bots.

**Fix:**
- CAPTCHA for human-verification flows
- Device fingerprinting
- Business logic rate limiting (max 3 promo codes per user per day)
- Bot detection (ML-based or rule-based)

### 7. Server-Side Request Forgery (SSRF)

Attacker tricks server into making requests to internal infrastructure.

```
# Attacker provides a URL to fetch
POST /api/fetch-preview
{"url": "http://169.254.169.254/latest/meta-data/iam/credentials"}
# ↑ AWS instance metadata — can expose credentials
```

**Fix:**
- Validate and allowlist URLs that can be fetched
- Block requests to private IP ranges (10.x, 172.16.x, 192.168.x, 169.254.x)
- Run fetch operations in isolated network environments

### 8. Security Misconfiguration

- Debug mode enabled in production
- Default credentials
- Overly permissive CORS
- Unnecessary HTTP methods enabled
- Verbose error messages exposing internals
- Unpatched dependencies

**Fix:**
- Security hardening checklist for every deployment
- Automated security scanning in CI (SAST, dependency scanning)
- Regular dependency updates (Dependabot)
- CORS allowlist — never `*` for authenticated endpoints

### 9. Improper Inventory Management

Undocumented APIs, deprecated versions still running, shadow APIs.

**Fix:**
- API versioning with explicit deprecation schedule
- API discovery/documentation (OpenAPI)
- Decommission old API versions on schedule
- API gateway that shows all registered routes

### 10. Unsafe Consumption of APIs

Trusting downstream API data without validation. Blind deserialization. Following redirects blindly.

**Fix:**
- Validate and sanitize data received from third-party APIs
- Don't deserialize untrusted data into executable code
- Handle errors from downstream APIs explicitly

---

## Injection Attacks

### SQL Injection

```python
# VULNERABLE: string interpolation
query = f"SELECT * FROM users WHERE email = '{user_input}'"
# Input: ' OR '1'='1  → returns all users

# SAFE: parameterized query
query = "SELECT * FROM users WHERE email = %s"
cursor.execute(query, (user_input,))
```

**Prevention:**
- Always use parameterized queries / prepared statements
- Use an ORM (but still use parameterized queries for raw SQL)
- Principle of least privilege for DB user (no DROP, no admin permissions)

### NoSQL Injection

```javascript
// VULNERABLE: MongoDB query built from user input
db.users.findOne({ username: req.body.username, password: req.body.password })
// Input: { "username": {"$gt": ""}, "password": {"$gt": ""} } → bypasses auth

// SAFE: validate input types
if (typeof req.body.username !== 'string') throw new Error('Invalid input');
```

### Command Injection

```python
# VULNERABLE
import os
os.system(f"convert {filename} output.png")  # filename = "; rm -rf /"

# SAFE: use subprocess with argument list (no shell=True)
import subprocess
subprocess.run(["convert", filename, "output.png"], check=True)
```

---

## Secrets Management

### What Counts as a Secret

- Database passwords
- API keys (third-party services)
- Private keys (TLS, JWT signing)
- OAuth client secrets
- Encryption keys

### Where NOT to Store Secrets

-  Source code / git repositories (even private repos)
-  Environment variables set at startup (visible in process list, logs)
-  Config files committed to source control
-  Docker images

### Where to Store Secrets

**HashiCorp Vault:**
- Dynamic secrets (generates DB credentials on demand with automatic expiry)
- Fine-grained access policies
- Secret leasing and renewal
- Audit log of all secret access

**AWS Secrets Manager:**
- Managed service. Automatic rotation for RDS passwords.
- Integrated with IAM for access control.
- `secretsmanager:GetSecretValue` API call at runtime.

**Kubernetes Secrets + External Secrets Operator:**
- Store secrets in Vault/AWS Secrets Manager
- External Secrets Operator syncs them into Kubernetes Secrets
- Applications consume as environment variables or mounted files

### Rotation

Rotate secrets regularly and immediately upon suspected compromise:
- Service credentials: every 90 days
- Root/admin credentials: every 30 days
- API keys: every 6 months (or upon staff departure)

Support zero-downtime rotation: accept both old and new secret during transition period.

---

## Transport Security

### TLS Best Practices

- **TLS 1.2 minimum**, TLS 1.3 preferred (faster handshake, better cipher suites)
- **Disable SSLv3, TLS 1.0, TLS 1.1** — all have known vulnerabilities
- **HSTS (HTTP Strict Transport Security):** Browser won't connect over HTTP after first HTTPS visit
  ```
  Strict-Transport-Security: max-age=31536000; includeSubDomains; preload
  ```
- **Certificate pinning** (mobile apps): Reject certificates not matching expected fingerprint

### mTLS (Mutual TLS)

Both client and server present certificates. Server verifies client identity cryptographically.

Used for:
- Service-to-service authentication in microservices
- API authentication for high-security clients
- Zero-trust network access

Implementation with a service mesh (Istio) handles mTLS automatically between services — no application code changes.


---

## Related

[[AuthN and AuthZ]]
