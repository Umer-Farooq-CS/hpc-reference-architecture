# 17_tenant_models.md - Tenant Models (Deep Dive)

> Covers: All 3 tenant request models — Shared Clusters, vClusters, and Bare Metal Clusters.  
> Includes isolation levels, performance characteristics, use cases, and K8s stack per type.

---

## 1. Overview — Why 3 Tenant Models?

Not all tenants need the same thing. A data scientist exploring ideas needs something different from a production AI team training a 70B parameter model. Having 3 models lets you match resources and isolation to actual needs:

| Model | Isolation | Performance | Cost to Tenant | Time to Provision |
|---|---|---|---|---|
| **Shared Cluster** | Low (namespace) | Variable (noisy neighbor) | Low | Minutes |
| **vCluster** | Medium (virtual K8s) | Good (controlled) | Medium | Minutes |
| **Dedicated Node** | High (node taints & full GPUs) | Maximum (dedicated HW) | High | Minutes |

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

## 4. Type 3 — Dedicated Node Allocation (Full GPU Pass-Through)

### What Is It?
The tenant receives **exclusive access to full physical bare metal nodes** on the shared physical cluster — utilizing the `7g.80gb` full un-sliced GPUs from Pool 1. The tenant uses the shared Kubernetes control plane, but their workloads are isolated onto dedicated physical machines using Kubernetes Taints, Tolerations, and dedicated KAI Scheduler queues.

**"You get this"** — as your boss said, pointing at a diagram of physical server racks, but without the overhead of managing a separate control plane.

### How It Works
```
Tenant Request: "I need 2 × H100 nodes dedicated to my team"
    ↓
Rafay creates Namespace + RBAC on the main cluster
    ↓
KAI Queue created with guaranteed 16x 7g.80gb GPU quota
    ↓
Node Taints applied to 2x Physical Servers (e.g., node-01, node-02)
    ↓
Tenant workloads are scheduled exclusively on those nodes
```

The tenant gets namespace-scoped access but enjoys the performance of dedicated hardware. The infrastructure team maintains a single "pane of glass" for the entire 64-GPU cluster.

### What the Tenant Gets
- **Up to 2 physical GPU servers** (from Pool 1)
- **16 GPUs** (2 × 8 H100 80GB) completely dedicated — no sharing (full `7g.80gb` profile)
- **Dedicated InfiniBand fabric** — no bandwidth contention on those nodes
- **Dedicated NVMe scratch storage**
- **Namespace-admin K8s access**

### Hardware Isolation Benefits
| Resource | Benefit of Dedicated Node Allocation |
|---|---|
| **GPU** | Zero contention, maximum VRAM and compute via full `7g.80gb` slices |
| **Network** | Dedicated InfiniBand bandwidth (400 Gb/s per GPU) |
| **CPU** | No noisy neighbor, NUMA topology fully available |
| **Memory** | Full DRAM capacity (e.g., 1.5TB per node) |
| **Storage I/O** | Dedicated local NVMe IOPS for training datasets |

### When You Need Dedicated Nodes
- **Large model training** (70B+ parameter models) — needs full InfiniBand bandwidth
- **Strict performance SLAs** — production AI systems needing guaranteed latency
- **Long-running jobs** — multi-week training runs where interruption is catastrophic

### Best For
- Enterprise clients with critical production workloads
- Large-scale LLM training (70B, 175B, 400B+ parameter models)
- Research organizations running months-long experiments

---

## 5. Comparison Matrix — All 3 Types

| Feature | Shared Cluster | vCluster | Dedicated Node |
|---|---|---|---|
| **Provisioning time** | Minutes | Minutes | Minutes |
| **GPU isolation** | Namespace quota | vCluster quota | Physical (Node Taints) |
| **Network isolation** | NetworkPolicy | vCluster + NetworkPolicy | NetworkPolicy |
| **K8s control** | Namespace admin | Cluster-admin (virtual) | Namespace admin |
| **Install own CRDs** | ❌ No | ✅ Yes | ❌ No |
| **Performance** | Variable | Good | Maximum |
| **Cost** | Lowest | Medium | Highest |
| **Use case** | Dev/explore | Team isolation | Production/large-scale |
| **Noisy neighbor** | Risk | Mitigated | None |
| **Customization** | Limited | High | Limited |

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

### Dedicated Node Onboarding
```

1. Tenant requests dedicated nodes via SSP or account manager
2. Rafay provisions Namespace + RBAC
3. KAI Queue created for full `7g.80gb` instances
4. Target node(s) from Pool 1 are cordoned/tainted for this tenant
5. Storage allocated from hot/cold/block pools
6. Tenant gets kubeconfig (namespace-scoped) + documentation
7. Total time: < 5 minutes
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
└── Tier 3: Dedicated Node (5% of tenants)
    ├── Dedicated nodes: 1 to 2 × H100 nodes (8 to 16 GPUs) from Pool 1
    ├── Full un-sliced `7g.80gb` GPUs via K8s Taints
    ├── Dedicated InfiniBand ports per node
    └── SLA: 99.9% uptime
```

---

## Final Architecture Decisions

### 1. Tenant Tier Standardization
**Decision:** Adopted the **3-Tier Model**: 

*   **Tier 1: Shared Cluster** (Namespace isolation, MIG slices) - For ~80% of tenants.
*   **Tier 2: vCluster** (Virtual API isolation, medium burst capacity) - For ~15% of tenants.
*   **Tier 3: Dedicated Node** (Physical isolation via K8s Taints, dedicated H100 nodes from Pool 1) - For ~5% of tenants.

### 2. Resource Caps per Tier
**Decision:** 

*   **Shared Tenants (Tier 1):** Capped at a maximum of 4 MIG slices and 500GB storage (base quota).
*   **vCluster Tenants (Tier 2):** Capped at 16 GPUs and 2TB storage (base quota).
*   **Dedicated Node (Tier 3):** Allocated in increments of full nodes (e.g., up to 2x H100 nodes = 16 GPUs) from Pool 1.

### 3. Storage Allocation Strategy
**Decision:** Base quotas are set conservatively (500 GB / 2 TB). However, the massive **1 PB** cluster capacity allows for dynamic expansion of these quotas upon request. The vast majority of the 1 PB is intentionally reserved for central, platform-managed Foundation Models, shared datasets, and vector databases that all tenants can access without duplicating storage.

### 4. VRL (Virtual Resource Layer) Definition
**Decision:** The VRL is implemented by configuring the **vCluster syncer** to translate tenant requests into physical ResourceQuotas on the host namespace, which are then connected to a specific KAI Scheduler queue for that vCluster.

### 4. Tenant Queue Configuration (Resource Allocation)
**Decision:** KAI Scheduler queue policies are defined as follows:

*   **Tier 1 (Shared):** Guaranteed 2 GPUs (MIG slices) with the ability to burst up to 4 if the cluster is under-utilized.
*   **Tier 2 (vCluster):** Guaranteed 8 GPUs with the ability to burst up to 16.
