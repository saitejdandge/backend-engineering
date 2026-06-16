# Proxies and Load Balancers

## Forward Proxy vs Reverse Proxy

### Forward Proxy

Sits in front of **clients**. Clients send requests to the proxy; the proxy forwards to the internet.

```
Client → Forward Proxy → Internet
```

**Use cases:**
- Corporate firewall / content filtering
- Anonymization (VPN, Tor)
- Caching outbound requests
- Bypassing geo-restrictions

The server sees the proxy's IP, not the client's IP.

### Reverse Proxy

Sits in front of **servers**. Clients talk to the proxy; the proxy routes to backend servers.

```
Internet → Reverse Proxy → Backend Servers
```

**Use cases:**
- Load balancing
- SSL termination (decrypt once at proxy, use HTTP internally)
- Caching
- Compression
- Rate limiting
- A/B routing
- DDoS protection

The client sees one IP (the proxy), not the backend servers.

---

## How Nginx Works Internally

Nginx uses a **master process + worker process** model with an event-driven architecture.

```
Master process
  ├── Worker 1 (epoll event loop, handles N connections)
  ├── Worker 2 (epoll event loop)
  ├── Worker 3 (epoll event loop)
  └── Worker 4 (epoll event loop)
  
  (one worker per CPU core, default)
```

Each worker runs a single-threaded epoll event loop. No threads per connection. One worker can handle 50,000+ simultaneous connections.

### Request Flow

```
1. Client TCP connection accepted by master → handed to worker
2. Worker reads HTTP request (non-blocking, epoll)
3. Worker evaluates location blocks
4. For proxy_pass: creates upstream connection (or reuses from pool)
5. Forwards request to upstream
6. Reads response from upstream (epoll)
7. Sends response to client
8. Connection returned to keepalive pool
```

### Nginx Config — Key Concepts

```nginx
# Upstream pool (load balancer)
upstream backend {
    least_conn;                        # algorithm
    server 10.0.0.1:8080;
    server 10.0.0.2:8080;
    keepalive 32;                      # upstream connection pool size
}

server {
    listen 80;
    
    # SSL termination
    listen 443 ssl;
    ssl_certificate /etc/nginx/cert.pem;
    ssl_certificate_key /etc/nginx/key.pem;
    
    location /api/ {
        proxy_pass http://backend;
        proxy_set_header X-Real-IP $remote_addr;    # pass client IP
        proxy_set_header Host $host;
        proxy_connect_timeout 5s;
        proxy_read_timeout 30s;
        proxy_buffering on;            # buffer response before sending to client
        
        # Rate limiting
        limit_req zone=api burst=20;
    }
    
    location /static/ {
        root /var/www;
        expires 1d;                    # cache headers
        gzip on;
    }
}
```

### Upstream Connection Pool (keepalive)

Without keepalive, Nginx creates a new TCP connection to backend per request (expensive).

With `keepalive 32`: Nginx maintains up to 32 idle connections per worker to each upstream. Reuses them for subsequent requests.

**Impact:** For 4 workers × 32 connections = 128 persistent connections to each backend. Factor in when sizing backend connection pools.

---

## HAProxy

TCP/HTTP load balancer. More focused than Nginx, better at pure L4/L7 load balancing.

```
Layer 4 (TCP mode):
  - Routes based on IP/port only
  - Source NAT: changes src IP to HAProxy's IP
  - Used for WebSockets, raw TCP services

Layer 7 (HTTP mode):
  - Inspects HTTP headers, cookies
  - Can rewrite headers, add X-Forwarded-For
  - Sticky sessions via cookie
```

```
# HAProxy config snippet
frontend web
    bind *:80
    mode http
    default_backend servers

backend servers
    mode http
    balance roundrobin
    option httpchk GET /health
    cookie SERVERID insert indirect nocache
    server s1 10.0.0.1:8080 check cookie s1
    server s2 10.0.0.2:8080 check cookie s2
```

---

## Envoy Proxy (Service Mesh Sidecar)

Envoy is a modern L7 proxy designed for microservices. Used as the sidecar in Istio/Linkerd.

**Features beyond Nginx/HAProxy:**
- Dynamic configuration via xDS API (no reload needed)
- Built-in observability: metrics, distributed tracing, access logs
- Circuit breaking, retries, timeouts per route
- mTLS automatic (in service mesh)
- HTTP/2 and gRPC native support

```yaml
# Envoy route config (simplified)
routes:
  - match:
      prefix: "/api/users"
    route:
      cluster: user-service
      timeout: 5s
      retry_policy:
        retry_on: 5xx
        num_retries: 3
  - match:
      prefix: "/api/orders"  
    route:
      cluster: order-service
```

**xDS:** Control plane pushes config changes to Envoy without restart. Istio's Pilot sends cluster and route configs to all Envoy sidecars in real-time.

---

## L4 vs L7 Load Balancing Deep Dive

### L4 (Transport Layer)

```
Client IP:Port → L4 LB → Backend IP:Port
```

**How it works:**
1. Client opens TCP connection to LB's VIP (virtual IP)
2. LB selects a backend using the chosen algorithm
3. LB modifies destination IP to backend's IP (DNAT)
4. TCP connection packets flow through LB transparently
5. Backend and client think they have a direct TCP connection (almost)

**Two modes:**
- **NAT mode:** LB rewrites src/dst IP. All traffic passes through LB. LB is a bottleneck.
- **Direct Server Return (DSR):** LB only touches inbound packets. Backend sends responses directly to client. LB doesn't bottleneck on response traffic (responses are usually much larger than requests).

**Properties:**
- No TLS termination (LB doesn't see content)
- Persistent TCP sessions to same backend
- Low latency (minimal processing)
- Cannot make content-based routing decisions

**AWS equivalent:** NLB (Network Load Balancer)

### L7 (Application Layer)

```
Client TCP connection → L7 LB (terminates) → New TCP connection to backend
```

**How it works:**
1. Client opens TCP+TLS to LB
2. LB terminates TLS, decrypts content
3. LB reads HTTP request, inspects headers/URL
4. LB makes routing decision
5. LB creates NEW connection to selected backend (or reuses from pool)
6. LB forwards HTTP request to backend
7. LB receives response, sends to client

**Properties:**
- TLS termination (decrypt once, backends use HTTP internally)
- Content-based routing (URL, headers, cookies, body)
- Can inject/modify headers (X-Forwarded-For, auth headers)
- Can rate limit, authenticate, compress
- Higher CPU overhead (TLS + HTTP parsing)

**AWS equivalent:** ALB (Application Load Balancer)

---

## SSL Termination

**Without termination:** Client ↔ (HTTPS) ↔ Backend. Every backend needs TLS cert + decryption overhead.

**With termination at LB:**
```
Client ↔ (HTTPS) ↔ LB ↔ (HTTP) ↔ Backend
```

**Benefits:**
- Backends only deal with plain HTTP (simpler)
- TLS certificate managed in one place
- LB can inspect HTTP content (can't with end-to-end TLS)
- Less CPU load on backends

**Security concern:** Traffic between LB and backend is unencrypted. In a private network this is usually acceptable. For compliance requirements, use re-encryption: LB terminates client TLS, re-encrypts to backend.

---

## How Proxies Are Built — Internals

A proxy is fundamentally:

```
while (true):
    client_conn = accept_new_connection()
    
    # For L4: pipe bytes between client and backend
    spawn_goroutine/thread(pipe(client_conn, backend_conn))
    
    # For L7: parse HTTP, route, forward
    spawn_goroutine/thread(handle_http(client_conn))
```

### Building a Simple TCP Proxy (Kotlin)

```kotlin
import java.net.ServerSocket
import java.net.Socket

fun startProxy(listenPort: Int, backendHost: String, backendPort: Int) {
    val server = ServerSocket(listenPort)
    println("Proxy listening on :$listenPort → $backendHost:$backendPort")
    
    while (true) {
        val clientConn = server.accept()
        Thread {
            try {
                val backendConn = Socket(backendHost, backendPort)
                // Pipe in both directions simultaneously
                val t1 = Thread { pipe(clientConn.inputStream, backendConn.outputStream) }
                val t2 = Thread { pipe(backendConn.inputStream, clientConn.outputStream) }
                t1.start(); t2.start()
                t1.join(); t2.join()
            } finally {
                clientConn.close()
            }
        }.start()
    }
}

fun pipe(input: java.io.InputStream, output: java.io.OutputStream) {
    val buf = ByteArray(4096)
    var n: Int
    while (input.read(buf).also { n = it } != -1) {
        output.write(buf, 0, n)
        output.flush()
    }
}
```

### Adding L7 HTTP Routing

```kotlin
fun handleHttp(clientConn: Socket, routes: Map<String, String>) {
    val reader = clientConn.getInputStream().bufferedReader()
    val requestLine = reader.readLine()  // "GET /api/users HTTP/1.1"
    
    val path = requestLine.split(" ")[1]
    val backend = routes.entries
        .firstOrNull { path.startsWith(it.key) }
        ?.value ?: "default:8080"
    
    // Read remaining headers
    val headers = mutableListOf(requestLine)
    var line = reader.readLine()
    while (line?.isNotEmpty() == true) {
        headers.add(line)
        line = reader.readLine()
    }
    
    // Forward to selected backend
    val (host, port) = backend.split(":")
    val backendConn = Socket(host, port.toInt())
    val writer = backendConn.outputStream.bufferedWriter()
    
    // Rewrite Host header + add X-Forwarded-For
    headers.forEach { h ->
        val rewritten = when {
            h.startsWith("Host:") -> "Host: $backend"
            else -> h
        }
        writer.write(rewritten + "\r\n")
    }
    writer.write("X-Forwarded-For: ${clientConn.inetAddress.hostAddress}\r\n")
    writer.write("\r\n")
    writer.flush()
    
    // Pipe response back
    pipe(backendConn.inputStream, clientConn.outputStream)
}
```

---

## Connection Draining

When removing a backend from a load balancer (deployment), you don't want to kill active connections. **Connection draining** lets existing connections finish while new ones go elsewhere.

```
1. Mark backend as "draining" in LB
2. LB stops sending NEW connections to that backend
3. Wait for in-flight connections to complete (drain timeout = 30s)
4. Terminate backend
```

AWS ALB does this automatically when deregistering a target (`deregistration_delay.timeout_seconds = 300` default).

Kubernetes does this via `preStop` hook + `terminationGracePeriodSeconds`.
