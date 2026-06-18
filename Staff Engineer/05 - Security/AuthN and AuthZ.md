# Authentication & Authorization

## Core Distinction

- **Authentication (AuthN):** Who are you? Verifying identity. "I am user@example.com with this password."
- **Authorization (AuthZ):** What are you allowed to do? Verifying permissions. "User 123 can read order 456 but not order 789."

Never conflate the two. A system can authenticate perfectly and still have broken authorization.

---

## OAuth 2.0

An authorization framework (not authentication) that allows third-party apps to access resources on behalf of a user without sharing credentials.

### Roles

- **Resource Owner:** The user who owns the data
- **Client:** The application wanting access (your app)
- **Authorization Server:** Issues tokens (Auth0, Okta, Google, etc.)
- **Resource Server:** The API holding the protected resources

### Grant Types

**Authorization Code Flow (for web apps with a backend):**
```
User → Client → Authorization Server (login + consent) → Auth Code
Client → Auth Code + Client Secret → Authorization Server → Access Token + Refresh Token
Client → Access Token → Resource Server → Protected Resource
```

The auth code is exchanged for a token server-side — the access token never touches the browser.

**Authorization Code + PKCE (for SPAs and mobile):**
Same as above but instead of a client secret (which can't be safely stored client-side), uses a **Proof Key for Code Exchange**:
- Generate random `code_verifier`
- Hash it: `code_challenge = BASE64URL(SHA256(code_verifier))`
- Send `code_challenge` in auth request
- Send `code_verifier` in token exchange
- Authorization server verifies hash matches

**Client Credentials Flow (machine-to-machine):**
```
Service A → Client ID + Client Secret → Authorization Server → Access Token
Service A → Access Token → Resource Server (Service B)
```

No user involved. Used for microservice-to-microservice auth.

### Scopes

Scopes limit what an access token can do:
```
scope=read:orders write:orders read:profile
```

The resource server validates that the token has the required scope for the operation.

---

## OIDC (OpenID Connect)

OAuth 2.0 + identity. Adds an **ID Token** (JWT containing user identity) on top of OAuth 2.0's access token.

OIDC is what makes OAuth 2.0 useful for authentication. The ID Token tells you *who* the user is; the Access Token tells you *what* they can do.

**Key endpoint:** `/.well-known/openid-configuration` — discovery document with all OIDC endpoints, supported scopes, and public key URLs.

---

## JWT (JSON Web Token)

A compact, URL-safe token format. Three parts: `Header.Payload.Signature`

```
eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9   ← Header (base64)
.eyJzdWIiOiJ1c2VyMTIzIiwiZW1haWwiOiJ1c2VyQGV4YW1wbGUuY29tIiwiZXhwIjoxNzE2ODI1NjAwfQ==   ← Payload (base64)
.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c   ← Signature
```

**Payload claims:**
- `sub`: Subject (user ID)
- `iss`: Issuer (who created the token)
- `aud`: Audience (who the token is for)
- `exp`: Expiration timestamp
- `iat`: Issued at timestamp
- `jti`: JWT ID (unique ID for this token — enables revocation)

### Signing Algorithms

- **HS256 (HMAC):** Symmetric — same secret used to sign and verify. Simple but both parties need the secret. Use for internal tokens where you control both sides.
- **RS256 (RSA):** Asymmetric — private key signs, public key verifies. Anyone can verify without the private key. Use for tokens consumed by third parties or multiple services.
- **ES256 (ECDSA):** Like RS256 but smaller key sizes and faster. Preferred over RS256 for new systems.

**JWKS (JSON Web Key Set):** Public endpoint exposing public keys for JWT verification. Clients fetch and cache these.

### JWT Validation Checklist

```python
import jwt

decoded = jwt.decode(
    token,
    public_key,           # Verify signature
    algorithms=["RS256"],  # Don't allow algorithm=none!
    audience="my-api",    # Verify aud claim
    issuer="https://auth.example.com",  # Verify iss claim
    options={"verify_exp": True}  # Verify expiration
)
```

**Critical:** Always validate `alg`, `iss`, `aud`, and `exp`. Never accept `alg: none`.

### JWT Revocation Problem

JWTs are stateless — the server doesn't track issued tokens. If a token is stolen, it remains valid until expiry.

Solutions:
- **Short expiry:** 15 minutes for access tokens. Use refresh tokens to get new access tokens.
- **Token blocklist:** Store revoked JTIs in Redis. Check on every request. Adds latency.
- **Refresh token rotation:** Issue new refresh token on every use. Old one invalid. Detects theft.

---

## Authorization Models

### RBAC (Role-Based Access Control)

Users assigned roles. Roles have permissions. Simple and well-understood.

```
User → Role (admin, viewer, editor) → Permissions (read:orders, write:orders, delete:orders)
```

**Problem:** Roles proliferate over time. "Admin" role ends up meaning different things for different contexts.

### ABAC (Attribute-Based Access Control)

Policies based on attributes of the user, resource, and environment.

```
Policy: Allow access if user.department == resource.department AND time.hour in [9, 17]
```

More expressive but complex. Hard to audit ("who has access to X?").

### ReBAC (Relationship-Based Access Control)

Access based on relationships between entities. Google Zanzibar model. Used by Google Drive ("user X can edit doc Y because they're a member of group Z which has editor access").

```
user:alice can view document:123
  because user:alice is member of group:engineering
  and group:engineering has viewer on document:123
```

Tools: SpiceDB, OpenFGA (open-source Zanzibar implementations).

**Best for:** Complex permission models with ownership, sharing, and hierarchies.

### OPA (Open Policy Agent)

Policy-as-code framework. Write policies in Rego language. Decouple policy from application code.

```rego
# Rego policy: allow only if user owns the resource
allow {
    input.method == "GET"
    input.user.id == input.resource.owner_id
}
```

Applications query OPA with input data; OPA returns allow/deny. Policies can be updated without redeployment.

---

## API Security Patterns

### Service-to-Service Auth

Options:
1. **Shared secret (API key):** Simple but hard to rotate, no identity granularity
2. **Mutual TLS (mTLS):** Both parties present certificates. Identity is cryptographic. Best for microservices.
3. **JWT with client credentials:** Service authenticates to auth server, gets a JWT, presents it downstream

### API Gateway Auth

Centralize authentication at the API gateway:
- Gateway validates JWT/API key before forwarding to services
- Services trust the gateway (validate gateway's internal token or rely on network policy)
- Services don't need to implement auth — reduces duplication, reduces attack surface

### Row-Level Security (RLS) in PostgreSQL

Enforce authorization at the database level:

```sql
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY orders_isolation ON orders
    USING (user_id = current_setting('app.current_user_id')::bigint);

-- Application sets the context before querying
SET app.current_user_id = 123;
SELECT * FROM orders;  -- Only returns orders where user_id = 123
```

Prevents bugs where application code fails to filter by user — the DB enforces it.


---

## Related

[[API Security & OWASP]]
