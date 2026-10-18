# Kubernetes Deployment Manifests for Prism

Production-grade Kubernetes manifests and Kustomize overlays for deploying Prism (Fastify API backend, Next.js web application, and Redis stateful storage) to any CNCF-compliant Kubernetes cluster (EKS, GKE, AKS, or self-hosted).

---

## Architecture Overview

```
                         Internet
                            │
                            ▼
              ┌───────────────────────────┐
              │   Ingress (NGINX / TLS)   │
              └─────────────┬─────────────┘
                            │
            ┌───────────────┴───────────────┐
            │                               │
            ▼                               ▼
    Path: /api, /ws, /health            Path: /
┌─────────────────────────┐     ┌─────────────────────┐
│  prism-server (Fastify) │     │   prism-web (Next)  │
│      ClusterIP: 3001    │     │   ClusterIP: 3000   │
└───────────┬─────────────┘     └─────────────────────┘
            │
            ▼
┌─────────────────────────┐
│ prism-redis StatefulSet │
│       Port: 6379        │
│   (Persistent Volume)   │
└─────────────────────────┘
```

### Components Deployed
1. **`prism-server`**: Fastify backend API running diagnostic replay, error decoding, and WebSocket streams.
   - Resource requests/limits, HTTP liveness and readiness probes (`/health`).
2. **`prism-web`**: Next.js web application UI for trace analysis and simulation.
   - Multi-replica Deployment with root path probes.
3. **`prism-redis`**: StatefulSet with PersistentVolumeClaim (`5Gi`) for task queues, distributed locks, and cache TTLs.
4. **`prism-ingress`**: `networking.k8s.io/v1` Ingress with TLS termination, WebSocket support, and path-based routing.
5. **`prism-config` & `prism-secrets`**: Decoupled environment configuration and sensitive credential templates.
6. **Kustomize Overlays**: Environment-specific configurations for `staging` and `production`.

---

## Directory Structure

```
deploy/k8s/
├── README.md                          # Comprehensive deployment guide
├── kustomization.yaml                 # Root kustomization referencing base
├── base/                              # Core baseline manifests
│   ├── namespace.yaml                 # Dedicated 'prism' namespace
│   ├── configmap.yaml                 # Runtime environment settings
│   ├── secret.yaml                    # Credentials and API keys template
│   ├── redis-statefulset.yaml         # Redis StatefulSet with PVC persistence
│   ├── redis-service.yaml             # ClusterIP and Headless services
│   ├── server-deployment.yaml         # Fastify API Server Deployment
│   ├── server-service.yaml            # ClusterIP Service on port 3001
│   ├── web-deployment.yaml            # Next.js Web UI Deployment
│   ├── web-service.yaml               # ClusterIP Service on port 3000
│   ├── ingress.yaml                   # NGINX Ingress with TLS
│   └── kustomization.yaml             # Base Kustomization package
└── overlays/                          # Environment customizations
    ├── staging/
    │   ├── kustomization.yaml         # Staging namespace & patches
    │   └── patches/
    │       └── ingress-host.yaml      # Staging domain configuration
    └── production/
        ├── kustomization.yaml         # Production namespace & HA configuration
        └── patches/
            ├── replicas.yaml          # Scale to 3 replicas per service
            ├── resources.yaml         # High-capacity CPU/memory allocations
            └── ingress-host.yaml      # Production domain configuration
```

---

## Prerequisites

- **Kubernetes cluster**: v1.25 or later.
- **`kubectl`**: Installed and configured to target your cluster.
- **Ingress Controller**: [ingress-nginx](https://kubernetes.github.io/ingress-nginx/) installed in cluster.
- **TLS Automation** (optional but recommended): [cert-manager](https://cert-manager.io/) with a configured `ClusterIssuer` (e.g., `letsencrypt-prod`).
- **Dynamic Volume Provisioner**: Default StorageClass for PVC fulfillment (e.g. `gp3` on AWS, `standard-rwo` on GKE).

---

## Quickstart Deployment

### 1. Configure Secrets
Before applying, update the placeholder credentials in `base/secret.yaml` or create your secret directly:

```bash
kubectl create namespace prism

kubectl create secret generic prism-secrets \
  --namespace prism \
  --from-literal=AI_API_KEY="your-openai-api-key" \
  --from-literal=SESSION_SECRET="$(openssl rand -hex 32)" \
  --dry-run=client -o yaml | kubectl apply -f -
```

### 2. Deploy Base Stack

To deploy all components using Kustomize:

```bash
# Using kubectl kustomize
kubectl apply -k deploy/k8s/
```

Or apply raw base manifests directly:

```bash
kubectl apply -f deploy/k8s/base/
```

---

## Deploying to Environments

### Deploying to Production

The production overlay scales compute services to 3 replicas each, increases resource quotas, and isolates workloads in the `prism-prod` namespace:

```bash
# 1. Inspect generated manifests
kubectl kustomize deploy/k8s/overlays/production/

# 2. Apply production overlay
kubectl apply -k deploy/k8s/overlays/production/
```

### Deploying to Staging

```bash
kubectl apply -k deploy/k8s/overlays/staging/
```

---

## Verification & Health Checks

### Check Pod Status
```bash
kubectl get pods -n prism -l app.kubernetes.io/name=prism -o wide
```
*Expected Output:*
```
NAME                            READY   STATUS    RESTARTS   AGE
prism-redis-0                   1/1     Running   0          2m
prism-server-5d8f6d89b4-2l9k8   1/1     Running   0          2m
prism-server-5d8f6d89b4-9xzqp   1/1     Running   0          2m
prism-web-6b797cdbc9-4k2v8      1/1     Running   0          2m
prism-web-6b797cdbc9-m7t1f      1/1     Running   0          2m
```

### Check Ingress
```bash
kubectl get ingress -n prism
```
Verify the ADDRESS column receives the cluster ingress load balancer IP/hostname.

### Test Backend Health Endpoint
```bash
# Port-forward directly to server service
kubectl port-forward svc/prism-server 3001:3001 -n prism

# Query health check
curl http://localhost:3001/health
# Response: {"status":"ok","version":"0.1.0"}
```

---

## Teardown

To delete all deployed resources:

```bash
# Base
kubectl delete -k deploy/k8s/

# Or Production overlay
kubectl delete -k deploy/k8s/overlays/production/
```

---

## Settlement Wallet

All contributions and automated releases are verified with the official Settlement Wallet:
`0x8366bCe3a2D379Dec7656D7A67015789FaF999f20`
