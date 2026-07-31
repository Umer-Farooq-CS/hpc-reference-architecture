# Kubernetes Control Plane Architecture

> Part of the [Chosen Architecture](index.md) specification.

---

## Control Plane Architecture & Metal3 Stack Integration

The Kubernetes Control Plane serves as the central brain of the GPU platform, managing cluster state, scheduling workloads, and enforcing security and tenant isolation policies.

In this architecture, the **5x dedicated 1U servers in Rack C** serve as standard highly-available Kubernetes master nodes. Because the platform uses **Metal3** for bare-metal provisioning, there are no dedicated monolithic "Head Nodes". Instead, the Metal3 stack (BareMetal Operator, OpenStack Ironic, and Cluster API) runs as native pods *inside* this Kubernetes Control Plane.

!!! info "Cloud-Native Provisioning"
    Metal3 `ironic-inspector` runs within the Kubernetes cluster, discovering and polling new hardware via the **1GbE Out-of-Band Management network**. Once a `BareMetalHost` is ready, Ironic PXE boots it and joins it to the cluster via the **100GbE Ethernet fabric**.

```
STORAGE & CONTROL RACK C  —  5x Dedicated 1U Physical Servers
┌────────────────────────────────────────────────────────────────────────┐
│  OS:  Ubuntu 22.04 LTS                                                 │
│                                                                        │
│  KUBERNETES LAYER  (RKE2 Control Plane)                                │
│    kube-apiserver         — K8s API, served via Kube-VIP VIP address   │
│    kube-controller-mgr    — cluster state reconciliation               │
│    kube-scheduler         — replaced at runtime by KAI Scheduler       │
│    etcd                   — Raft log on local NVMe RAID-1 (isolated)   │
│    Kube-VIP               — BGP VIP advertisement to SONiC switches    │
│                                                                        │
│  METAL3 PROVISIONING STACK (Runs as Pods inside K8s)                   │
│    BareMetal Operator     — custom controller for BareMetalHost CRDs   │
│    ironic-inspector       — hardware discovery via BMC/iDRAC           │
│    ironic                 — PXE server and image deployment engine     │
│    Cluster API (CAPI)     — declarative machine lifecycle management   │
└────────────────────────────────────────────────────────────────────────┘
                                    │
               100GbE SONiC Ethernet Plane (BGP ECMP) — Rack C switches
                                    │
                                    ▼
           WORKER NODES (Racks A & B — 8x Dell XE9680 GPU Servers)
```

### Cluster Lifecycle Phases

| Phase | What Happens | Metal3 State | K8s State |
|---|---|---|---|
| **Phase 0 — Switch Pre-Config** | Admin configures SONiC switches via EDA (VLANs, BGP, PFC, MLAG) | Not yet installed | Not yet installed |
| **Phase 1 — K8s Bootstrap** | Admin runs `rke2 server` on all 5 masters. etcd forms 5-node Raft quorum. kube-apiserver comes online. Metal3 stack is deployed via Helm | **Starting** | **Running** |
| **Phase 2 — Hardware Discovery** | Metal3 `ironic-inspector` discovers compute nodes via 1GbE OOB network and creates `BareMetalHost` CRDs | **Running** | **Running** |
| **Phase 3 — Node Provisioning** | Admin applies CAPI manifests via GitOps. Ironic PXE boots all 8 compute nodes and joins them to the cluster | **Running** | **Running** |
| **Phase 4 — Steady State** | Full platform operational. GPU Operator, Cilium, KubeFlow, KAI, Slinky all deployed via ArgoCD | **Running** | **Running** |

---

## Key Architecture Decisions

### 1. Control Plane Topology: 5-Node High Availability (HA)
*   **Choice:** **5-Node HA Control Plane**.
*   **Location:** 5x Dedicated 1U servers in Rack C.
*   **etcd Quorum Math:** Raft quorum is $\lfloor 5 / 2 \rfloor + 1 = 3$. The cluster can survive **2 simultaneous master node failures** without losing state or read/write access.
*   **Rationale:** A 110-tenant GPU cloud generates heavy API churn (namespace management, CRD watches for GPU Operator, KubeFlow, Ceph, MinIO, and Rafay). During routine rolling OS or K8s upgrades (where 1 node is taken offline), a 5-node cluster retains 4 active nodes (2 above quorum), ensuring zero-downtime maintenance and high fault tolerance.

### 2. Physical Hardware & Workload Isolation
*   **Choice:** **Dedicated Hardware (No GPU Workloads on Masters)**.
*   **Specification:** Dual-socket CPU, 256 GB RAM, 2x 1.92 TB Enterprise NVMe (RAID-1), Dual 100GbE NICs.
*   **Rationale:** Control plane nodes MUST NOT share physical hardware with GPU compute workloads. A runaway LLM training job or CUDA out-of-memory kernel panic could starve `kube-apiserver` or `etcd` of CPU/memory resources and crash the entire platform.

### 3. etcd Storage & Disk Performance
*   **Choice:** **Stacked etcd on Local Enterprise NVMe RAID-1**.
*   **Rationale:** `etcd` relies on system `fsync()` calls for Raft log persistence, demanding sub-millisecond write latency (< 1ms). `etcd` is run locally on dedicated NVMe drives on each master node. Running `etcd` on network-attached storage (NFS, Ceph, or WEKA) is strictly prohibited to prevent quorum timeouts and cluster instability.

### 4. API Load Balancing: Kube-VIP in BGP Mode
*   **Choice:** **Kube-VIP in BGP Mode via SONiC Leaf Switches**.
*   **Rationale:** Kube-VIP runs as a DaemonSet on the master nodes and advertises a `/32` Virtual IP (VIP) to the two 100GbE SONiC Leaf Switches using BGP. The switches perform 5-way Equal-Cost Multi-Path (ECMP) routing to distribute API server traffic across all 5 active masters. If a master node fails, its BGP session drops and traffic fails over within ~1 second without requiring expensive external hardware load balancers.

---

*Back to [Chosen Architecture Index](index.md)*
