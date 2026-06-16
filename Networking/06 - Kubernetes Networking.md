# Kubernetes Networking

## The Four Networking Problems K8s Solves

1. **Container-to-container** in the same pod: via localhost (shared network namespace)
2. **Pod-to-pod** across nodes: flat network, any pod can reach any pod by IP
3. **Pod-to-Service:** stable virtual IP for a group of pods
4. **External-to-Service:** expose services to the outside world

---

## Pod Networking

Every pod gets its own **network namespace** with a virtual ethernet interface (veth pair).

```
Node
├── eth0 (node's physical NIC)
├── Pod A namespace
│     └── eth0 (veth end inside pod) ← paired with → cbr0/veth-a (host side)
└── Pod B namespace
      └── eth0 (veth end inside pod) ← paired with → cbr0/veth-b (host side)

cbr0 (bridge): connects all veth pairs on the node
```

When Pod A sends to Pod B:
- **Same node:** Packet goes out pod-A eth0 → veth-a → bridge → veth-b → pod-B eth0. No host networking involved.
- **Different node:** Packet goes out bridge → node eth0 → network → other node eth0 → bridge → target pod.

**K8s requirement:** Every pod must be able to reach every other pod without NAT. Pod IP must be the source IP seen by the destination.

---

## CNI Plugins (How Pod Networking is Implemented)

CNI (Container Network Interface) is a spec for how networking plugins work. Kubelet calls the CNI plugin when creating/deleting pods.

### Flannel (Simple)

Uses **VXLAN** (Virtual Extensible LAN): encapsulates pod-to-pod packets in UDP for cross-node transport.

```
Pod A (10.244.1.5) on Node 1 → Pod B (10.244.2.7) on Node 2

Node 1:
  Pod A → veth → flannel → VXLAN encapsulate → UDP/8472 → Node 2 eth0

Node 2:
  eth0 → VXLAN decapsulate → flannel → veth → Pod B
```

Simple but adds overhead (VXLAN encapsulation). Good for simplicity.

### Calico (BGP-based, Production)

Uses **BGP routing** between nodes. No encapsulation. Each node acts as a BGP router advertising pod CIDR routes.

```
Node 1 advertises: 10.244.1.0/24 is on node1
Node 2 advertises: 10.244.2.0/24 is on node2

Pod A → veth → kernel routes (via BGP table) → node2 eth0 → veth → Pod B
```

Native routing = near-wire speed. Also provides **Network Policy** enforcement using iptables/eBPF.

### Cilium (eBPF-based, Modern)

Uses **eBPF** programs in the kernel instead of iptables. Higher performance, better observability.

- Replaces kube-proxy entirely
- Deep packet inspection without kernel changes
- Hubble: real-time network visibility (which pods talk to which)
- WireGuard encryption between nodes

---

## Services

A Service provides a stable virtual IP (ClusterIP) for a dynamic set of pods. Pods are selected by label selectors.

```yaml
apiVersion: v1
kind: Service
metadata:
  name: user-service
spec:
  selector:
    app: user-service        # routes to pods with this label
  ports:
    - port: 80               # service port (what clients use)
      targetPort: 8080       # pod port (what containers listen on)
  type: ClusterIP            # only accessible within cluster
```

### Service Types

**ClusterIP (default)**
- Virtual IP only accessible within cluster
- kube-proxy sets up iptables/IPVS rules to forward ClusterIP traffic to pod IPs
- `user-service.default.svc.cluster.local` → 10.96.45.123 (ClusterIP)

**NodePort**
- Opens a port (30000-32767) on every node
- External traffic to `<any-node-ip>:<nodeport>` → service
- Not production-grade (fixed ports, exposes all nodes)

```yaml
type: NodePort
ports:
  - port: 80
    targetPort: 8080
    nodePort: 30080    # optional, auto-assigned if omitted
```

**LoadBalancer**
- Provisions a cloud load balancer (AWS ALB/NLB, GCP LB)
- External IP → cloud LB → NodePort → pods
- One LB per service (expensive at scale, use Ingress instead)

```yaml
type: LoadBalancer
# AWS annotation for NLB
annotations:
  service.beta.kubernetes.io/aws-load-balancer-type: "nlb"
```

**ExternalName**
- DNS CNAME alias to an external hostname
- `SELECT * FROM db` → k8s resolves `db` → CNAME → rds.amazonaws.com

---

## kube-proxy: How Services Actually Work

kube-proxy runs on every node and maintains network rules (iptables or IPVS) to implement Service routing.

### iptables mode (default)

When a pod sends a packet to ClusterIP:

```
Pod → ClusterIP:80 → iptables DNAT → random pod IP:8080
```

kube-proxy watches the Endpoints API. When pods are added/removed, it updates iptables rules:

```
# Example iptables rules for service with 3 pod replicas
-A KUBE-SVC-XYZ -m statistic --mode random --probability 0.33 -j KUBE-SEP-POD1
-A KUBE-SVC-XYZ -m statistic --mode random --probability 0.50 -j KUBE-SEP-POD2  
-A KUBE-SVC-XYZ -j KUBE-SEP-POD3
```

Random probability = load balancing across pods.

**Problem:** With thousands of services, iptables rules grow O(N) and become slow to update.

### IPVS mode (Better Performance)

Uses Linux IPVS (IP Virtual Server) — a kernel-level load balancer. O(1) lookup vs O(N) iptables scan.

```
kube-proxy --proxy-mode=ipvs
```

Supports multiple LB algorithms: round-robin, least connection, source-hash.

---

## CoreDNS: Kubernetes DNS

Every K8s cluster runs CoreDNS as the cluster DNS server.

```
Service discovery:
user-service.default.svc.cluster.local.
└── service name
         └── namespace
                  └── svc
                       └── cluster.local (cluster domain)
```

```bash
# Inside a pod:
nslookup user-service                   # → 10.96.45.123 (ClusterIP)
nslookup user-service.default           # same
nslookup user-service.default.svc.cluster.local  # fully qualified

# Cross-namespace:
nslookup user-service.other-namespace
```

DNS search path is configured in `/etc/resolv.conf` inside pods:
```
search default.svc.cluster.local svc.cluster.local cluster.local
nameserver 10.96.0.10   # CoreDNS ClusterIP
```

So `curl user-service` works because it tries `user-service.default.svc.cluster.local` first.

---

## Ingress: HTTP Routing at Scale

Instead of a LoadBalancer Service per app (expensive), use one Ingress controller + Ingress rules.

```
Internet → AWS ALB (one load balancer) → Ingress Controller (Nginx/Traefik/ALB Ingress)
                                              ├── /api/* → api-service:80
                                              ├── /app/* → web-service:3000
                                              └── api.example.com → api-service:80
```

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: main-ingress
  annotations:
    nginx.ingress.kubernetes.io/rewrite-target: /
spec:
  ingressClassName: nginx
  tls:
    - hosts: [api.example.com]
      secretName: tls-cert
  rules:
    - host: api.example.com
      http:
        paths:
          - path: /users
            pathType: Prefix
            backend:
              service:
                name: user-service
                port:
                  number: 80
          - path: /orders
            pathType: Prefix
            backend:
              service:
                name: order-service
                port:
                  number: 80
```

**Ingress Controllers:** Nginx Ingress, Traefik, HAProxy Ingress, AWS ALB Ingress Controller, Kong.

---

## Network Policies

By default, all pods can talk to all pods. Network Policies restrict this.

```yaml
# Allow user-service only from order-service and api-gateway
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: user-service-policy
  namespace: default
spec:
  podSelector:
    matchLabels:
      app: user-service     # applies to these pods
  policyTypes:
    - Ingress
    - Egress
  ingress:
    - from:
      - podSelector:
          matchLabels:
            app: order-service
      - podSelector:
          matchLabels:
            app: api-gateway
      ports:
        - protocol: TCP
          port: 8080
  egress:
    - to:
      - podSelector:
          matchLabels:
            app: postgres
      ports:
        - protocol: TCP
          port: 5432
    - to:                   # allow DNS
      - namespaceSelector: {}
      ports:
        - protocol: UDP
          port: 53
```

Requires a CNI that supports NetworkPolicy (Calico, Cilium, Weave).

---

## Service Mesh (Istio/Linkerd)

A service mesh adds a **sidecar proxy (Envoy)** to every pod. The proxy intercepts all network traffic.

```
Pod A                              Pod B
├── app container                  ├── app container
└── envoy sidecar ←──mTLS──────→  └── envoy sidecar
```

**What you get automatically:**
- **mTLS between all services** — encrypted, authenticated service-to-service
- **Distributed tracing** — every request gets a trace ID, propagated through sidecars
- **Traffic management** — canary deployments, A/B testing, circuit breaking
- **Observability** — golden signals (rate, errors, duration) for every service pair

**Istio architecture:**
```
istiod (control plane)
  ├── Pilot: service discovery, routes config → Envoy sidecars
  ├── Citadel: certificate management for mTLS
  └── Galley: config validation

Envoy sidecar (data plane) — runs in every pod
```

**Traffic shaping:**
```yaml
# 90% to v1, 10% to v2 (canary)
apiVersion: networking.istio.io/v1alpha3
kind: VirtualService
spec:
  http:
    - route:
      - destination:
          host: user-service
          subset: v1
        weight: 90
      - destination:
          host: user-service
          subset: v2
        weight: 10
```

---

## Practical Networking Debugging in K8s

```bash
# Pod-to-pod connectivity
kubectl exec -it pod-a -- curl http://pod-b-ip:8080

# Service DNS resolution
kubectl exec -it pod-a -- nslookup user-service

# Check endpoints (are pods registered?)
kubectl get endpoints user-service

# iptables rules for a service
kubectl exec -it kube-proxy-pod -n kube-system -- iptables -t nat -L KUBE-SERVICES

# Network policy trace (Cilium)
kubectl exec -n kube-system cilium-xxx -- cilium monitor

# Port forward for debugging (bypass service)
kubectl port-forward pod/user-service-abc123 8080:8080
kubectl port-forward svc/user-service 8080:80

# Check pod network namespace
kubectl exec -it pod-a -- ip addr
kubectl exec -it pod-a -- ip route
kubectl exec -it pod-a -- cat /etc/resolv.conf
```
