# 12 — Kubernetes Control Plane Architecture (Deep Dive)

> Covers: What the control plane is, its components, HA topologies (1-node vs 3-node vs 5-node), etcd quorum math, API load balancing strategies, hardware sizing, K8s distributions for bare metal, and the recommended standard for a 110-tenant GPU cloud platform.

---

## 1. What Is the Kubernetes Control Plane?

The **control plane** is the brain of the Kubernetes cluster. It makes all decisions about the cluster — scheduling workloads, managing state, and enforcing configuration. Worker nodes (your GPU compute servers) only take orders from the control plane; they never make cluster-level decisions themselves.

```
CONTROL PLANE LAYER (Master Nodes)
┌──────────────────────────────────────────────────────────────┐
│  kube-apiserver  │  etcd  │  kube-scheduler  │  controller-mgr  │
└──────────────────────────────────────────────────────────────┘
                              │
                  (kubelet heartbeats & API calls)
                              │
WORKER NODES (GPU Compute Servers)
┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│  kubelet     │  │  kubelet     │  │  kubelet     │
│  kube-proxy  │  │  kube-proxy  │  │  kube-proxy  │
│  containerd  │  │  containerd  │  │  containerd  │
│  [GPU Pods]  │  │  [GPU Pods]  │  │  [GPU Pods]  │
└──────────────┘  └──────────────┘  └──────────────┘
```

**Critical rule:** In a production multi-tenant platform, the control plane must NEVER share physical hardware with GPU compute workloads. Mixing them means a runaway training job can starve `kube-apiserver` of CPU and crash the cluster.

---

## 2. Control Plane Components — What Each One Does

| Component | What It Is | What Happens If It Dies |
|---|---|---|
| **`kube-apiserver`** | The REST API front door of Kubernetes. Every `kubectl` command, every Rafay GitOps push, every kubelet heartbeat hits this. Stateless — it reads/writes only to `etcd`. | If ALL API server instances die, cluster goes read-only. Existing pods keep running but nothing new can be scheduled, deleted, or modified. |
| **`etcd`** | A distributed key-value store using the **Raft consensus algorithm**. Holds ALL cluster state: pod specs, secrets, RBAC rules, namespaces, CRD definitions, resource quotas. | If `etcd` loses quorum (more than half the members fail), the entire cluster freezes. kube-apiserver refuses all write requests. This is the single most critical component. |
| **`kube-scheduler`** | Watches for unscheduled pods and decides which worker node to place them on, based on resource availability, affinity rules, taints, and tolerations. Only ONE active instance at a time (leader-elected). | Unscheduled pods stay in `Pending` state indefinitely. Running pods are unaffected. The backup scheduler takes over within seconds via leader election. |
| **`kube-controller-manager`** | Runs a bundle of control loops in one process. The Node Controller detects dead nodes. The Namespace Controller cleans up deleted namespaces. The ReplicaSet Controller maintains replica counts. Only ONE active at a time. | Running pods continue. No new self-healing, auto-scaling, or cleanup loops run until the backup takes over. |
| **`cloud-controller-manager`** | Manages cloud-provider integrations (load balancer provisioning, node lifecycle on cloud VMs). On bare metal, this is typically replaced by MetalLB or Kube-VIP for load balancer management. | On bare metal, usually not running. Load balancer VIPs managed by Kube-VIP or MetalLB instead. |
| **`kubelet` (on master)** | Even master nodes run a kubelet to run control plane components as Pods (in managed distributions like RKE2). | The node's own control plane containers stop restarting if kubelet dies. |

---

## 3. etcd — The Most Important Component

`etcd` deserves its own section because it is the single most failure-critical component in any Kubernetes cluster.

### How etcd Works (Raft Consensus)

`etcd` uses the **Raft distributed consensus algorithm**. Every write must be confirmed by a **quorum (majority)** of members before it is committed:

```
Quorum = floor(N / 2) + 1

3-member cluster: Quorum = 2   → Can lose 1 member
5-member cluster: Quorum = 3   → Can lose 2 members
7-member cluster: Quorum = 4   → Can lose 3 members
```

### Why etcd Is So Sensitive to Disk Latency

Every write operation to `etcd` (example: a new pod being created) uses `fsync()` — a system call that forces the OS to flush the write all the way to the physical disk platters before returning success. This is not optional; it is the mechanism that prevents data loss on power failure.

This means:
- **On NVMe SSD:** `fsync` completes in ~50–200µs → `etcd` write latency stays under 1ms → healthy
- **On SATA SSD:** `fsync` takes 1–5ms → `etcd` write latency climbs → occasional leader re-elections
- **On HDD:** `fsync` takes 5–15ms → `etcd` is constantly holding elections → cluster instability
- **On NFS / network storage:** Latency is unpredictable → `etcd` CANNOT be run on NFS. This is a hard rule.

### etcd Sizing Rules

| Resource | Minimum | Recommended for Production |
|---|---|---|
| **vCPU** | 2 cores dedicated | 4–8 cores dedicated |
| **RAM** | 8 GB | 16–32 GB |
| **Disk** | 20 GB NVMe SSD | 50–100 GB NVMe SSD (for WAL + snapshots) |
| **Disk type** | NVMe or fast SSD only | Enterprise NVMe (RAID-1 mirrored) |
| **Network** | 1 GbE | 10+ GbE between etcd peers |
| **Backup** | Manual | Automated snapshot every 30 min → S3/MinIO |

---

## 4. Control Plane Topology Options

There are 4 topology patterns to consider when designing the control plane for a production bare-metal platform.

---

### Option A — Single Master Node (Development Only)

```
┌──────────────────────────┐
│     SINGLE MASTER        │
│  API + etcd + Scheduler  │
│  + Controller Manager    │
└──────────────────────────┘
        │
  (all worker nodes)
```

| Aspect | Detail |
|---|---|
| **etcd Members** | 1 (no quorum, no HA) |
| **Failure Tolerance** | Zero — master failure = total cluster outage |
| **Use Case** | Local development, CI/CD test clusters, lab environments |
| **Verdict for production** | NEVER use in production |

---

### Option B — 3-Node HA Control Plane

```
┌──────────┐   ┌──────────┐   ┌──────────┐
│ Master 1 │   │ Master 2 │   │ Master 3 │
│ API + etcd│  │ API + etcd│  │ API + etcd│
└──────────┘   └──────────┘   └──────────┘
      │               │               │
      └───────────────┼───────────────┘
             Raft Quorum = 2/3
           (can lose 1 master only)
                      │
               (worker nodes)
```

| Aspect | Detail |
|---|---|
| **etcd Members** | 3 |
| **Quorum Requirement** | 2 of 3 must be alive |
| **Failure Tolerance** | 1 master failure |
| **Rolling Upgrade Risk** | During a 1-node rolling OS upgrade, cluster is at zero fault tolerance — if a second master fails simultaneously, the cluster freezes |
| **Use Case** | Small to medium production clusters, non-critical workloads |
| **Verdict for production at scale** | Acceptable but tight. One maintenance event removes all redundancy. |

---

### Option C — 5-Node HA Control Plane (Recommended)

```
┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐
│ Master 1 │  │ Master 2 │  │ Master 3 │  │ Master 4 │  │ Master 5 │
│ API+etcd │  │ API+etcd │  │ API+etcd │  │ API+etcd │  │ API+etcd │
└──────────┘  └──────────┘  └──────────┘  └──────────┘  └──────────┘
      └──────────────────────┼──────────────────────────┘
                    Raft Quorum = 3/5
              (can lose 2 masters simultaneously)
                             │
                      (worker nodes)
```

| Aspect | Detail |
|---|---|
| **etcd Members** | 5 |
| **Quorum Requirement** | 3 of 5 must be alive |
| **Failure Tolerance** | 2 simultaneous master failures |
| **Rolling Upgrade Safety** | 1 master is taken offline for upgrades → 4 remain → still 2 above quorum → full redundancy maintained throughout |
| **Use Case** | Large-scale, mission-critical multi-tenant production clusters |
| **Verdict for a 110-tenant GPU cloud** | This is the right choice — see Section 8 |

---

### Option D — Stacked vs. External etcd

All options above use **stacked etcd** — where etcd runs on the same nodes as the API server. There is an alternative pattern:

```
STACKED ETCD (simpler)          EXTERNAL ETCD (more resilient)
┌──────────────────┐            ┌────────────────┐  ┌──────────────┐
│ Master 1         │            │ Master 1       │  │ etcd Node 1  │
│ API + etcd 1     │            │ API only       │  │ etcd only    │
└──────────────────┘            └────────────────┘  └──────────────┘
┌──────────────────┐            ┌────────────────┐  ┌──────────────┐
│ Master 2         │            │ Master 2       │  │ etcd Node 2  │
│ API + etcd 2     │            │ API only       │  │ etcd only    │
└──────────────────┘            └────────────────┘  └──────────────┘
┌──────────────────┐            ┌────────────────┐  ┌──────────────┐
│ Master 3         │            │ Master 3       │  │ etcd Node 3  │
│ API + etcd 3     │            │ API only       │  │ etcd only    │
└──────────────────┘            └────────────────┘  └──────────────┘
```

| Topology | Pros | Cons |
|---|---|---|
| **Stacked etcd** | Fewer servers, simpler operations, less hardware cost | etcd and API share the same failure domain. A master node crashing loses both API and etcd member simultaneously. |
| **External etcd** | etcd and API have independent failure domains. A master node OS crash does NOT take down an etcd member. | Requires 6+ extra servers. Much higher CAPEX. Complex TLS certificate management. |

**For this platform:** Stacked etcd on 5 masters is the right balance. External etcd is typically reserved for hyperscaler-level deployments with hundreds of nodes and very high write rates.

---

## 5. Kubernetes API Load Balancing

With multiple master nodes, you need a single stable endpoint for all clients (worker node `kubelet`s, `kubectl` users, Rafay agents, and CI pipelines). There are 3 main approaches:

### Option 1 — External Hardware Load Balancer (F5, HAProxy)

```
Clients ──► F5 / HAProxy / NGINX ──► Master 1:6443
                                  ──► Master 2:6443
                                  ──► Master 3:6443
```

| Pros | Cons |
|---|---|
| Mature, well-understood technology | Introduces a new SPOF — the load balancer itself needs HA |
| Advanced health check features | Adds CAPEX (F5 license) or ops overhead (HAProxy VMs) |
| | Network hop adds latency |

---

### Option 2 — Kube-VIP (BGP or ARP Mode)

**Kube-VIP** runs as a DaemonSet on the master nodes. It advertises a shared Virtual IP (VIP) using either:
- **ARP mode:** Leader election selects one master to hold the VIP. Simple but only one master handles traffic at a time (active-passive).
- **BGP mode:** All masters advertise the VIP route. The upstream switch does ECMP hashing. True active-active.

```
Clients ──► VIP 10.0.0.10:6443
            ├── BGP ECMP via SONIC Switch ──► Master 1
            ├──                           ──► Master 2
            └──                           ──► Master 3
```

| Pros | Cons |
|---|---|
| Runs inside K8s — no external dependencies | BGP mode requires switch BGP configuration |
| No extra hardware required | ARP mode is active-passive only |
| Native integration with RKE2 and kubeadm | |

---

### Option 3 — MetalLB (for Service-type LoadBalancer)

MetalLB provides `LoadBalancer` type services for bare-metal clusters (normally a cloud-provider-only feature). It is used for **tenant-facing services** but is **NOT** the right tool for the kube-apiserver VIP.

---

### Recommended Approach for This Platform

**Kube-VIP in BGP mode** paired with the existing **SONIC Leaf Switch pair**. The SONIC switches already run L3 BGP (from the network design). Each master node runs `frr` (Free Range Routing) to advertise a `/32` host route for the VIP (`10.0.0.10/32`) to both SONIC switches. The switches do 5-way ECMP — all 5 masters handle API traffic in active-active. If a master dies, its BGP session drops, the route is withdrawn, and traffic shifts to the remaining masters within ~1 second.

---

## 6. Hardware Sizing for Control Plane Nodes

The right hardware depends on cluster scale. Here is the sizing matrix:

| Metric | Small (< 20 nodes, < 1000 pods) | Medium (20-100 nodes, < 5000 pods) | Large (100+ nodes, 10000+ pods) |
|---|---|---|---|
| **vCPU per Master** | 4 cores | 8–16 cores | 16–32 cores |
| **RAM per Master** | 16 GB | 64–128 GB | 128–256 GB |
| **etcd Disk** | 20 GB NVMe | 50 GB NVMe | 100 GB NVMe |
| **OS Disk** | 100 GB SSD | 200 GB SSD | 500 GB SSD |
| **NIC** | 1 GbE | 10 GbE | 25–100 GbE |
| **# of Masters** | 1 (dev) or 3 | 3 or 5 | 5 |

**Key drivers of control plane resource consumption:**
- **Number of namespaces:** Each tenant namespace = more RBAC objects, more API watch streams.
- **Number of CRDs:** GPU Operator, KubeFlow, Rook, MinIO, Rafay each install dozens of CRDs.
- **Watch stream count:** Every `kubelet`, every Operator, every Rafay agent holds open watch streams to the API server. More tenants = more operators = more watch streams = more API server memory.
- **etcd write rate:** High pod churn (many short-lived training jobs) generates high etcd write rates.

---

## 7. Control Plane Isolation — Why Dedicated Nodes Matter

In a multi-tenant GPU cloud, the control plane MUST run on dedicated physical servers. Here is why mixing it with compute nodes is dangerous:

| Risk Scenario | What Happens Without Dedicated Masters |
|---|---|
| **Training job fills /tmp or local disk** | The OS root partition fills up → `kube-apiserver` or `etcd` crashes because they cannot write logs or temporary data |
| **Noisy neighbor GPU process starves CPU** | GPU training jobs competing for CPU cycles on the same physical server delay `etcd` fsync responses past the 1ms threshold → `etcd` elections → cluster instability |
| **CUDA Out-of-Memory kernel panic** | A GPU OOM condition can cause kernel panics on some driver versions → the entire node, including the master processes, goes down |
| **MIG reconfiguration by GPU Operator** | The NVIDIA GPU Operator may reboot a node to apply MIG profile changes → if master is on that node, a control plane node is taken offline unexpectedly |

---

## 8. K8s Distributions for Bare Metal HPC

You are not running vanilla upstream Kubernetes. You will use a distribution. The main choices for a bare-metal GPU cloud platform:

| Distribution | Vendor | Security Hardening | GPU Support | Bare Metal Fit | Notes |
|---|---|---|---|---|---|
| **RKE2** | Rancher / SUSE | FIPS 140-2, CIS Benchmark | Excellent (via GPU Operator) | Excellent | Default choice for Rafay-managed bare metal clusters. Embedded containerd, etcd management built in. |
| **kubeadm** | CNCF upstream | Manual | Full | Good | Most control but most manual work. No built-in HA setup tooling. |
| **OpenShift (OCP)** | Red Hat | Very strong (NSA/DISA STIG) | Good | Good | Expensive. Uses `cri-o` instead of containerd. Overkill for most HPC scenarios unless government/regulated. |
| **Talos Linux** | Sidero Labs | Immutable OS (no SSH, no shell) | Good | Good | Extremely secure but unusual operations model. Steep learning curve. |
| **K3s** | Rancher / SUSE | Moderate | Good | Poor | Too lightweight for production scale. Designed for edge devices. |

**Rafay officially supports and recommends RKE2** for bare-metal managed clusters. RKE2 handles embedded etcd bootstrapping, TLS certificate management, and cluster upgrade orchestration automatically.

---

## 9. Control Plane Components Unique to This Platform

Beyond the standard Kubernetes control plane, the following additional controllers and operators run on the master nodes:

| Component | Type | Role |
|---|---|---|
| **KAI Scheduler** | Operator + Webhook | GPU-aware scheduling, gang scheduling, tenant queue management, priority preemption across MIG pools |
| **NVIDIA GPU Operator** | Operator | Manages NVIDIA driver installation, MIG profile reconfiguration (`mig-parted`), DCGM monitoring export, and CUDA toolkit deployment on GPU worker nodes |
| **Rafay Controller Agent** | Operator / Daemon | GitOps sync, multi-cluster state management, tenant RBAC enforcement, vCluster lifecycle management, SSP request handling |
| **Metal3 + Ironic** | Operator | Kubernetes-native bare metal provisioning for new worker nodes and bare-metal tenant clusters |
| **Rook-Ceph Operator** | Operator | Manages the entire Ceph block storage cluster as Kubernetes CRDs. Handles OSD lifecycle, volume provisioning, and snapshot management |
| **MinIO Operator** | Operator | Manages MinIO tenants (per-platform and per-tenant S3 buckets), storage pool expansion, and lifecycle policies |
| **WEKA CSI Controller** | CSI Driver Controller | Manages dynamic PVC provisioning and volume binding for the WEKA hot storage tier |
| **Cert-Manager** | Operator | Automated TLS certificate lifecycle management for all internal and external HTTPS endpoints |
| **Kube-VIP** | DaemonSet | BGP-based Virtual IP advertisement for the Kubernetes API server endpoint |

---

## 10. Standard Architecture Recommendation

For a **110-tenant, 64 H100 GPU, 1 PB storage** platform running under Rafay management:

```
Control Plane Configuration:
├── Node Count:       5x Dedicated Physical Master Nodes
├── Distribution:     RKE2 (Rancher Kubernetes Engine 2)
├── etcd Topology:    Stacked (etcd co-located on master nodes)
├── etcd Quorum:      5-member Raft → Quorum = 3 → Can lose 2 masters
├── API HA:           Kube-VIP BGP mode → 5-way ECMP via SONIC switches
├── API VIP:          Dedicated /32 host route advertised via BGP
├── Node Hardware:    Dedicated 1U servers — NO GPU workloads on masters
├── etcd Storage:     Local NVMe RAID-1 (never NFS, never shared storage)
├── etcd Backup:      Automated snapshot every 30 min → MinIO Cold Tier
└── Placement:        Storage & Control Plane Rack C (physically separate from GPU racks)

Per Master Node Hardware (Recommended Sizing):
├── CPU:    Dual-socket Xeon Gold or EPYC → 32+ physical cores
├── RAM:    256 GB DDR5 ECC
├── Disk:   2x 1.92 TB Enterprise NVMe (RAID-1) → etcd + OS
└── NIC:    Dual 100GbE → dual-homed to SONIC Leaf Switch 1 and 2
```

### Why 5 Masters instead of 3?

With 110 tenants and a mixture of Shared Clusters, vClusters, and Bare Metal tenants, the K8s control plane will be heavily loaded with:
- 110 namespaces with ResourceQuotas and RBAC objects
- Hundreds of active CRDs (GPU Operator, KAI, KubeFlow, Rook, MinIO, Rafay)
- Thousands of simultaneous pod watch streams from GPU workloads
- High pod churn (short training jobs spawning and completing frequently)

A **3-master cluster** during a routine OS upgrade would have only 2 masters available. In that state, **any unexpected failure kills the cluster**. For a production-grade multi-tenant platform this risk is unacceptable.

A **5-master cluster** means you can take 1 master offline for any reason (upgrade, hardware replacement, network maintenance) and the cluster still has 4 masters — 2 above quorum. True zero-disruption maintenance.

---

## Decisions to be Made for Reference Architecture
### 1. Control Plane Topology (3-Node vs 5-Node HA)
You need to balance cost vs. resilience for your Kubernetes master nodes.
*   **Decision:** Will you deploy a **3-node** or a **5-node** control plane? A 3-node cluster can tolerate 1 failure, but during a rolling upgrade it runs with ZERO fault tolerance. For a 110-tenant platform with heavy API churn, a 5-node setup (which survives 2 simultaneous failures) is strongly recommended.

### 2. etcd Configuration and Hardware
`etcd` is incredibly sensitive to disk latency. If it slows down, the entire cluster freezes.
*   **Decision:** Confirm the use of **Stacked etcd** (running on the master nodes) backed by dedicated **enterprise NVMe RAID-1 disks**. It is critical to mandate that etcd is NEVER placed on network storage like NFS or Ceph to avoid quorum timeouts.

### 3. API Load Balancing (Kube-VIP vs Hardware LB)
All worker nodes and tenants need a single stable IP address to talk to the K8s API.
*   **Decision:** Confirm the use of **Kube-VIP in BGP mode**. This advertises a Virtual IP directly to your SONiC switches and does ECMP load balancing across all 5 master nodes. The alternative is buying a physical F5 load balancer, which adds cost and a single point of failure.

### 4. Hardware Isolation
You need to decide if control plane components can share servers with GPU workloads.
*   **Decision:** Confirm that the master nodes will be **dedicated 1U servers without GPUs**. Running control plane workloads on the same nodes as heavy LLM training jobs guarantees that a runaway tenant workload could starve the API server of CPU and crash the entire platform.

---
*Next: See `decisions/` folder for finalized control plane architecture decisions once the design is confirmed.*
