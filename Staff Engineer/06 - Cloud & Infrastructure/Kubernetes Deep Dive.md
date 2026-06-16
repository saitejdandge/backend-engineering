# Kubernetes Deep Dive

## Core Architecture

### Control Plane

- **API Server:** Single entry point for all K8s operations. Validates and processes REST requests. Persists state to etcd.
- **etcd:** Distributed key-value store. Source of truth for all cluster state. Treat as critical infrastructure — back it up.
- **Scheduler:** Watches for unscheduled Pods. Assigns them to nodes based on resource requests, affinity, taints/tolerations.
- **Controller Manager:** Runs controllers that reconcile desired state with actual state (ReplicaSet controller, Deployment controller, etc.).

### Data Plane (Nodes)

- **kubelet:** Agent on each node. Watches API server for pods scheduled to its node. Starts/stops containers via CRI.
- **kube-proxy:** Maintains network rules (iptables/ipvs) for Service routing.
- **Container Runtime:** containerd or CRI-O (Docker removed as default in K8s 1.24).

---

## Workload Resources

### Pod

The smallest deployable unit. One or more containers sharing network namespace and volumes.

```yaml
apiVersion: v1
kind: Pod
spec:
  containers:
  - name: app
    image: myapp:v1.2.3
    resources:
      requests:
        cpu: "250m"       # 0.25 CPU cores guaranteed
        memory: "256Mi"   # 256MB guaranteed
      limits:
        cpu: "1000m"      # 1 CPU core max (throttled, not killed)
        memory: "512Mi"   # 512MB max (OOMKilled if exceeded)
    livenessProbe:
      httpGet:
        path: /health
        port: 8080
      initialDelaySeconds: 30
      periodSeconds: 10
      failureThreshold: 3
    readinessProbe:
      httpGet:
        path: /ready
        port: 8080
      initialDelaySeconds: 5
      periodSeconds: 5
```

### Requests vs Limits (Critical to Understand)

- **Requests:** Used by scheduler to find a node with enough capacity. Guaranteed to the container.
- **Limits:** Hard ceiling. CPU limit → throttled. Memory limit → OOMKilled.

**QoS classes:**
- **Guaranteed:** `requests == limits` for all containers. Highest priority, never evicted first.
- **Burstable:** `requests < limits`. Evicted before Guaranteed under pressure.
- **BestEffort:** No requests or limits set. Evicted first. Never use in production.

**Common mistake:** Setting CPU limits too low causes CPU throttling even when node is idle. Consider setting CPU requests but no CPU limits for latency-sensitive services.

### Deployment

Manages ReplicaSets. Provides declarative updates, rollouts, and rollbacks.

```yaml
apiVersion: apps/v1
kind: Deployment
spec:
  replicas: 3
  selector:
    matchLabels:
      app: myapp
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1           # At most 1 extra pod during rollout
      maxUnavailable: 0     # Never reduce below desired count
  template:
    spec:
      terminationGracePeriodSeconds: 30  # Time to finish in-flight requests
      containers:
      - name: app
        image: myapp:v1.2.3
```

### StatefulSet

For stateful applications (databases, Kafka, ZooKeeper). Provides:
- Stable, predictable pod names (`app-0`, `app-1`, `app-2`)
- Stable network identity (DNS: `app-0.app-service.namespace.svc.cluster.local`)
- Ordered, graceful deployment and scaling
- Persistent Volume Claims per pod (each pod gets its own PVC)

### DaemonSet

Runs exactly one pod per node. Used for:
- Log collectors (Fluentd, Filebeat)
- Node monitoring (Datadog agent, Prometheus node exporter)
- Network plugins (Calico, Weave)

---

## Probes

### Liveness Probe

Is the container alive? If it fails, kubelet restarts the container.

Use for: detecting deadlocks, infinite loops, hung processes.

**Don't fail liveness probes on dependency failures** (e.g., DB unavailable). That causes restart loops and makes things worse. Liveness should only fail if the container itself is broken.

### Readiness Probe

Is the container ready to receive traffic? If it fails, the pod is removed from Service endpoints (no traffic sent to it).

Use for: warmup period, dependency checks, graceful load shedding.

**This is the right place to check dependencies.** If DB is unavailable, fail readiness → no traffic → no 500s.

### Startup Probe

For slow-starting containers. Disables liveness and readiness checks until startup probe succeeds. Prevents premature restarts during initialization.

---

## Networking

### Services

Abstract a set of pods behind a stable DNS name and IP.

- **ClusterIP (default):** Internal-only. Accessible within the cluster.
- **NodePort:** Exposes on each node's IP at a static port. Rarely used directly.
- **LoadBalancer:** Creates a cloud load balancer (AWS ALB/NLB, GCP). For external traffic.
- **Headless (ClusterIP: None):** No stable IP. DNS returns pod IPs directly. Used by StatefulSets for direct pod addressing.

### Ingress

HTTP/HTTPS routing into the cluster. Defines URL path and hostname routing rules. Requires an Ingress controller (nginx-ingress, AWS Load Balancer Controller, Traefik).

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
spec:
  rules:
  - host: api.example.com
    http:
      paths:
      - path: /v1/orders
        pathType: Prefix
        backend:
          service:
            name: order-service
            port:
              number: 80
```

### Network Policies

Default: all pods can talk to all pods. Network policies enforce allow/deny rules.

```yaml
# Only allow order-service to talk to payment-service on port 8080
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
spec:
  podSelector:
    matchLabels:
      app: payment-service
  ingress:
  - from:
    - podSelector:
        matchLabels:
          app: order-service
    ports:
    - port: 8080
```

Requires a network plugin that supports NetworkPolicy (Calico, Cilium, Weave).

---

## Scheduling

### Affinity and Anti-Affinity

```yaml
# Spread replicas across availability zones (hard requirement)
affinity:
  podAntiAffinity:
    requiredDuringSchedulingIgnoredDuringExecution:
    - labelSelector:
        matchLabels:
          app: myapp
      topologyKey: topology.kubernetes.io/zone
```

Use `preferredDuringScheduling...` for soft rules (scheduler tries but doesn't block).

### Taints and Tolerations

Taints mark nodes as "avoid unless tolerated." Tolerations on pods allow scheduling on tainted nodes.

```yaml
# Node taint (only GPU workloads go here)
kubectl taint nodes gpu-node-1 nvidia.com/gpu=present:NoSchedule

# Pod toleration
tolerations:
- key: "nvidia.com/gpu"
  operator: "Equal"
  value: "present"
  effect: "NoSchedule"
```

---

## Resource Management

### Resource Quotas (Namespace Level)

Limit total resources a namespace can consume:
```yaml
apiVersion: v1
kind: ResourceQuota
spec:
  hard:
    requests.cpu: "10"
    requests.memory: 20Gi
    limits.cpu: "20"
    limits.memory: 40Gi
    pods: "50"
```

### Horizontal Pod Autoscaler (HPA)

Scale based on CPU, memory, or custom metrics:
```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: myapp
  minReplicas: 2
  maxReplicas: 20
  metrics:
  - type: Resource
    resource:
      name: cpu
      target:
        type: Utilization
        averageUtilization: 70
```

### Vertical Pod Autoscaler (VPA)

Automatically adjusts pod resource requests/limits based on actual usage. Don't use with HPA on the same metric. Good for initial sizing.

---

## Graceful Shutdown

Critical for zero-downtime deployments:

1. K8s sends `SIGTERM` to the container
2. Container starts graceful shutdown (stops accepting new requests, finishes in-flight)
3. K8s waits `terminationGracePeriodSeconds` (default 30s)
4. If still running after grace period, K8s sends `SIGKILL`

**Application must handle SIGTERM:**
```python
import signal, sys

def handle_sigterm(signum, frame):
    # Stop accepting new requests
    server.close()
    # Wait for in-flight requests
    executor.shutdown(wait=True)
    sys.exit(0)

signal.signal(signal.SIGTERM, handle_sigterm)
```

**Also:** Use `preStop` hook to add a sleep before SIGTERM if your service is behind a load balancer that needs time to de-register the pod:
```yaml
lifecycle:
  preStop:
    exec:
      command: ["sleep", "5"]
```
