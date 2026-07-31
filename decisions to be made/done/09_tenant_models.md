# 09 — Tenant Models (Deep Dive)

> Covers: All 3 tenant request models — Shared Clusters, vClusters, and Bare Metal Clusters.  
> Includes isolation levels, performance characteristics, use cases, and K8s stack per type.

---

## 1. Overview — Why 3 Tenant Models?

Not all tenants need the same thing. A data scientist exploring ideas needs something different from a production AI team training a 70B parameter model. Having 3 models lets you match resources and isolation to actual needs:

| Model | Isolation | Performance | Cost to Tenant | Time to Provision |
|---|---|---|---|---|
| **Shared Cluster** | Low (namespace) | Variable (noisy neighbor) | Low | Minutes |
| **vCluster** | Medium (virtual K8s) | Good (controlled) | Medium | Minutes |
| **Bare Metal** | High (physical) | Maximum (dedicated HW) | High | Hours |

---

## 2. Type 1 — Normal Shared Provisioning Clusters

### What Is It?
A single Kubernetes cluster shared by multiple tenants. Each tenant gets a **Namespace** within the cluster. Resources (CPUs, GPUs, memory) are pooled and allocated dynamically.

### How It Works
```
Physical K8s Cluster
├── Namespace: tenant-alice
│   ├── ResourceQuota: 4 GPUs, 64GB RAM, 500GB PVC
│   └── Pods: Jupyter, training jobs
├── Namespace: tenant-bob
│   ├── ResourceQuota: 2 GPUs, 32GB RAM, 200GB PVC
│   └── Pods: inference service
└── Namespace: tenant-charlie
    ├── ResourceQuota: 8 GPUs, 128GB RAM, 1TB PVC
    └── Pods: distributed training (4-node PyTorchJob)
```

**"You ask to run, it runs"** — as your boss described. Submit a request, it runs on available resources.

### Isolation Mechanisms
| Resource | Isolation Tool |
|---|---|
| **CPU / RAM** | ResourceQuota per namespace |
| **GPU** | KAI Scheduler Queue with guaranteed quota |
| **Storage** | PVC + StorageQuota per namespace |
| **Network** | Kubernetes NetworkPolicy (Cilium) |
| **Secrets** | Namespace-scoped, tenant can't see others |
| **API access** | K8s RBAC — tenant is admin of their namespace only |

### Noisy Neighbor Problem
**The main risk of shared clusters:** One tenant's heavy workload can affect others.
- A tenant running a large training job saturates InfiniBand → other tenants' jobs slow down
- A tenant consuming all NVMe I/O → hot storage performance degrades for all

**Mitigations:**
- Network QoS policies on SONIC switches (traffic shaping per namespace)
- I/O throttling via cgroups (Kubernetes I/O limits)
- KAI Scheduler queue priorities

### Best For
- Development and experimentation workloads
- Small teams with simple GPU needs
- Tenants that don't need Kubernetes expertise
- Maximum resource utilization (pooling helps)

---

## 3. Type 2 — vClusters (Virtual Clusters)

### What Is It?
A **vCluster** is a fully-functional, isolated Kubernetes cluster running inside a namespace of the physical cluster. The tenant gets their own K8s API server, their own control plane, and feels like they have a dedicated cluster — but the actual workloads still run on shared physical hardware.

**Technology:** vcluster by Loft Labs (github.com/loft-sh/vcluster)

### How vCluster Works
```
Physical K8s Cluster (host cluster — hidden from tenant)
└── Namespace: vcluster-tenant-A
    ├── [Pod] k3s API server (tenant's K8s control plane)
    ├── [Pod] syncer (syncs tenant Pods down to host cluster)
    ├── PVC: etcd data (tenant's cluster state)
    └── NetworkPolicy: isolated from other namespaces

Tenant's View (via kubeconfig):
└── My K8s Cluster (they think it's dedicated)
    ├── All standard K8s resources (Deployments, Services, etc.)
    ├── Custom CRDs (they can install their own operators)
    ├── KubeFlow (pre-installed by Rafay Blueprint)
    └── Their own namespaces within vCluster
```

### The Syncer — Key vCluster Component
The **syncer** is what makes vClusters work. It:
- Watches the tenant's vCluster API for Pod creation
- Translates those Pods into real Pods on the host cluster (with GPU resource requests)
- Maps tenant namespaces → host namespace
- Maps tenant PVCs → host PVCs (with the actual StorageClass)

The tenant sees their Pod as running in `default` namespace of their vCluster. The host cluster sees it in `vcluster-tenant-A` namespace.

### Stack Inside a vCluster (from your notes)
| Component | What It Is |
|---|---|
| **K8s** | vCluster's own K8s API (typically k3s or k8s) |
| **CRD NOPs** | Custom Resource Definitions + NOP operators (tenant can install their own operators/CRDs) |
| **KFlow (KubeFlow)** | Pre-installed by Rafay blueprint — tenant's ML orchestration |
| **EDA** | Event-Driven Automation for the tenant's network config |
| **VRL** | Virtual Resource Layer — enforces resource quotas for the vCluster |

### VRL — Virtual Resource Layer
**VRL** is likely a resource quota enforcement layer for vClusters. It ensures:
- The vCluster cannot exceed its allocated GPU/CPU/memory limits on the host cluster
- Tenant resource requests are translated to host ResourceQuota constraints
- KAI Scheduler Queue is created for the vCluster (with its guaranteed/max GPU allocation)

### vCluster Isolation vs Shared Namespace
| Feature | Shared Namespace | vCluster |
|---|---|---|
| **K8s API isolation** | ❌ Shared | ✅ Separate API server |
| **CRD installation** | ❌ Requires admin | ✅ Tenant can install CRDs |
| **Operator installation** | ❌ Requires admin | ✅ Tenant can run operators |
| **RBAC customization** | ❌ Limited | ✅ Full cluster-admin within vCluster |
| **Custom networking** | ❌ Limited | ✅ Custom CNI within vCluster |
| **Isolation from host** | ❌ Namespace only | ✅ Full API isolation |
| **Overhead** | None | ~50-200MB RAM for k3s control plane |

### Best For
- Teams that need to install their own operators/CRDs
- KubeFlow pipeline customization
- Multi-team organizations where each team wants their own K8s environment
- Test/staging environments mirroring production
- Tenants with K8s expertise who need full cluster control

---

## 4. Type 3 — (Hard) Bare Metal Clusters

### What Is It?
The tenant receives **dedicated physical bare metal nodes** — no virtualization, no sharing. The tenant (or the platform team) provisions a dedicated K8s cluster on those physical machines.

**"You get this"** — as your boss said, pointing at a diagram of physical server racks.

### How It Works
```
Tenant Request: "I need 8 × H100 nodes dedicated to my team"
    ↓
Rafay + Metal3 provisions 8 physical servers
    ↓
K8s cluster installed on those 8 nodes
    ↓
NVIDIA GPU Operator installed (64 GPUs total, dedicated)
    ↓
KAI Scheduler, KubeFlow installed
    ↓
Rafay Agent runs on this cluster (Rafay still manages it)
    ↓
Tenant gets kubeconfig with full cluster-admin access
```

The tenant is **cluster-admin** of their own physical K8s cluster. The infrastructure team still manages hardware health and Rafay still provides lifecycle management.

### What the Tenant Gets
- **8 physical GPU servers** (example)
- **Full K8s cluster** on dedicated hardware
- **64 GPUs** (8 × H100 80GB) completely dedicated — no sharing
- **Dedicated InfiniBand fabric** — no bandwidth contention
- **Dedicated storage** — their share of hot/cold/block storage
- **Cluster-admin K8s access**

### Hardware Isolation Benefits
| Resource | Benefit of Dedicated Hardware |
|---|---|
| **GPU** | Zero contention, maximum VRAM and compute |
| **Network** | Dedicated InfiniBand bandwidth (400 Gb/s per GPU) |
| **CPU** | No noisy neighbor, NUMA topology fully available |
| **Memory** | Full DRAM capacity (e.g., 2TB per node) |
| **Storage I/O** | Dedicated NVMe IOPS for training datasets |

### When You Need Bare Metal
- **Large model training** (70B+ parameter models) — needs full InfiniBand bandwidth
- **Strict security/compliance** — regulated industries need full physical isolation
- **Consistent performance SLAs** — production AI systems needing guaranteed latency
- **Long-running jobs** — multi-week training runs where interruption is catastrophic
- **Specialized hardware** — tenant needs specific GPU model or memory config

### Best For
- Enterprise clients with critical production workloads
- Large-scale LLM training (70B, 175B, 400B+ parameter models)
- Regulated industries (healthcare, finance, government)
- Research organizations running months-long experiments

---

## 5. Comparison Matrix — All 3 Types

| Feature | Shared Cluster | vCluster | Bare Metal |
|---|---|---|---|
| **Provisioning time** | Minutes | Minutes | Hours |
| **GPU isolation** | Namespace quota | vCluster quota | Physical (100%) |
| **Network isolation** | NetworkPolicy | vCluster + NetworkPolicy | Physical (dedicated) |
| **K8s control** | Namespace admin | Cluster-admin (virtual) | Cluster-admin (real) |
| **Install own CRDs** | ❌ No | ✅ Yes | ✅ Yes |
| **Performance** | Variable | Good | Maximum |
| **Cost** | Lowest | Medium | Highest |
| **Use case** | Dev/explore | Team isolation | Production/large-scale |
| **Noisy neighbor** | Risk | Mitigated | None |
| **Customization** | Limited | High | Full |

---

## 6. Tenant Onboarding Flow (All 3 Types)

### Shared Cluster Onboarding
```
1. Tenant submits request via SSP (portal)
2. Rafay creates Namespace + RBAC
3. KAI Queue created with GPU quota
4. ResourceQuota applied
5. StorageClass PVC quota applied
6. Tenant gets kubeconfig (namespace-scoped)
7. Total time: < 5 minutes
```

### vCluster Onboarding
```
1. Tenant submits vCluster request via SSP
2. Rafay provisions vCluster (k3s API + syncer)
3. Blueprint applied: KubeFlow, KAI, Monitoring pre-installed
4. VRL resource limits configured
5. Tenant gets kubeconfig (cluster-admin of vCluster)
6. Total time: 5-15 minutes
```

### Bare Metal Onboarding
```
1. Tenant requests dedicated nodes via SSP or account manager
2. Hardware allocated, Metal3 provisions OS on dedicated nodes
3. RKE2 K8s cluster bootstrapped on those nodes
4. Rafay Agent installed, cluster registered in Rafay
5. Blueprint applied: GPU Operator, KubeFlow, KAI, Storage CSI
6. RBAC configured (tenant = cluster-admin)
7. Network provisioned (dedicated VLANs/IB ports)
8. Storage allocated from hot/cold/block pools
9. Tenant gets kubeconfig + documentation
10. Total time: 2-8 hours
```

---

## 7. Standard Architecture Recommendation

```
Tenant Tiers:
├── Tier 1: Shared Pool (80% of tenants)
│   ├── Max GPU per tenant: 4 GPUs (or 16 MIG slices)
│   ├── Namespace isolation + NetworkPolicy
│   └── KAI Queue: guaranteed 2 GPUs, max burst 8
│
├── Tier 2: vCluster (15% of tenants)
│   ├── Max GPU per vCluster: 16 GPUs
│   ├── Pre-installed: KubeFlow, MLflow, monitoring
│   ├── Full CRD/operator freedom
│   └── VRL enforced GPU + storage quotas
│
└── Tier 3: Bare Metal (5% of tenants)
    ├── Dedicated nodes: minimum 4 × H100 nodes (32 GPUs)
    ├── Full K8s cluster, full GPU access
    ├── Dedicated InfiniBand ports
    └── SLA: 99.9% uptime
```

---

## Decisions to be Made for Reference Architecture
### 1. Tenant Tier Standardization
You need to officially define the service catalog that tenants can purchase or request.
*   **Decision:** Confirm the adoption of the **3-Tier Model**: 
    *   Tier 1: Shared Cluster (Namespace isolation, MIG slices)
    *   Tier 2: vCluster (Virtual API isolation, medium burst capacity)
    *   Tier 3: Bare Metal (Physical isolation, dedicated H100 nodes)

### 2. Resource Caps per Tier
With 110 tenants competing for 64 GPUs and 1PB of storage, you must strictly define the limits to prevent over-provisioning.
*   **Decision:** Define the maximum allowable GPU slices and Storage PVC sizes for each tier. For example, capping Shared tenants at a maximum of 4 MIG slices and 500GB storage.

### 3. VRL (Virtual Resource Layer) Definition
The notes mentioned VRL for vClusters, which needs architectural clarity.
*   **Decision:** Clarify the exact mechanism that will act as the VRL. Usually, this means configuring the vCluster syncer to translate tenant requests into physical `ResourceQuotas` and connecting them to a specific KAI Scheduler queue.

### 4. Tenant Queue Configuration (Resource Allocation)
You must define how the 64 GPUs are carved up mathematically among the 110 tenants.
*   **Decision:** Define the queue policies for the KAI Scheduler. You will need to formalize the **Guaranteed Quota** vs **Maximum Quota (Bursting)** for each tenant tier. For example: Do shared pool tenants get a guaranteed 2 GPUs with the ability to burst to 8 if the cluster is idle?

---
*Next: See `10_service_layer.md` for JNaaS, ModelaaS, MLOps, and GPU PaaS.*
