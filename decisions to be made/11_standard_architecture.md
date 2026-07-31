# 11 — Standard Reference Architecture (Best Practices)

> The recommended "best" GPU cloud platform architecture — combining the best tools at each layer.  
> This is the target architecture your team should aim to deliver for clients.

---

## 1. Design Principles

Before choosing tools, align on these principles:

| Principle | Meaning |
|---|---|
| **Open Source First** | Prefer open-source tools to avoid vendor lock-in and reduce cost |
| **NVIDIA-Native** | Follow NVIDIA's reference architecture for GPU layers (GPU Operator, NDR IB) |
| **K8s-Native** | Everything runs in/via Kubernetes — operators, CRDs, GitOps |
| **GitOps Driven** | All configuration in Git — auditable, reproducible, rollback-safe |
| **Multi-Tenant by Design** | Isolation and fairness built-in from day one |
| **Observability First** | Metrics, logs, and traces for every layer — hardware to application |
| **Standards Aligned** | Follow CNCF, NVIDIA, and Linux Foundation standards |

---

## 2. Full Standard Architecture — Diagram

```
╔══════════════════════════════════════════════════════════════════════╗
║  MANAGEMENT PLANE                                                    ║
║  Rafay Controller (SaaS or Self-Hosted)                              ║
║  ├── GitOps Engine (Flux/ArgoCD)                                     ║
║  ├── Multi-cluster RBAC + Project/Tenant Management                  ║
║  ├── Cluster Blueprints (Golden Config Templates)                    ║
║  └── Self-Service Portal (SSP / JNPaaS)                              ║
╚═════════════════════════╦════════════════════════════════════════════╝
                          ║ Controller ↔ Agent (outbound HTTPS)
╔═════════════════════════╩════════════════════════════════════════════╗
║  KUBERNETES CLUSTERS (managed by Rafay Agents)                       ║
║                                                                      ║
║  ┌─────────────────────────────────────────────────────────────┐    ║
║  │  SERVICE LAYER                                              │    ║
║  │  JNaaS (KubeFlow Notebooks)  │  ModelaaS (KServe + vLLM)  │    ║
║  │  MLOps (KFP + MLflow + DVC)  │  GPU PaaS (raw K8s)        │    ║
║  └─────────────────────────────────────────────────────────────┘    ║
║                              │                                       ║
║  ┌─────────────────────────────────────────────────────────────┐    ║
║  │  ORCHESTRATION LAYER                                        │    ║
║  │  Kubernetes (RKE2)  │  KubeFlow  │  KAI Scheduler          │    ║
║  │  NVIDIA GPU Operator (NUOP8R)    │  cert-manager           │    ║
║  │  Cilium CNI + Multus             │  Prometheus + Grafana   │    ║
║  └─────────────────────────────────────────────────────────────┘    ║
║                              │                                       ║
║  ┌─────────────────────────────────────────────────────────────┐    ║
║  │  STORAGE LAYER                                              │    ║
║  │  Hot: WEKA (NVMe, RAG/vectors)                             │    ║
║  │  Cold: MinIO (S3-compatible, knowledge bases)              │    ║
║  │  Block: Ceph RBD via Rook (K8s PVCs, etcd)                │    ║
║  │  Vector DB: Milvus (on WEKA)                               │    ║
║  └─────────────────────────────────────────────────────────────┘    ║
╚══════════════════════════════════════════════════════════════════════╝
                              │
╔══════════════════════════════════════════════════════════════════════╗
║  NETWORK SOFTWARE LAYER                                              ║
║  SONIC (on whitebox switches) + Linux networking                     ║
║  Cilium eBPF (K8s CNI)  │  SR-IOV + Multus (IB RDMA in Pods)       ║
║  EDA / Ansible (network automation, ZTP)                             ║
╚══════════════════════════════════════════════════════════════════════╝
                              │
╔══════════════════════════════════════════════════════════════════════╗
║  BARE METAL PROVISIONING                                             ║
║  Metal3 + Cluster API (declarative bare metal K8s)                  ║
║  OpenStack Ironic (PXE boot, disk imaging)                           ║
║  Slinky (SLURM compatibility bridge for legacy HPC workloads)        ║
╚══════════════════════════════════════════════════════════════════════╝
                              │
╔══════════════════════════════════════════════════════════════════════╗
║  HARDWARE LAYER                                                      ║
║  GPU Servers: Lenovo/HP/Dell — 8× NVIDIA H100 SXM5 80GB per node   ║
║  Network: NVIDIA NDR InfiniBand 400Gb/s (ConnectX-7, Quantum-2)    ║
║  Ethernet: 2× 100GbE per node (storage + K8s networking)            ║
║  Topology: Spine-Leaf (Clos) — whitebox switches running SONIC      ║
║  NICs: 6 per node (2× mgmt 1G, 2× ETH 100G, 2× IB 400G)           ║
╚══════════════════════════════════════════════════════════════════════╝
```

---

## 3. Layer-by-Layer Best Tool Selection

### Layer 0 — Hardware

| Component | Best Choice | Reasoning |
|---|---|---|
| **GPU** | NVIDIA H100 SXM5 80GB | Best training GPU (FP8, NVLink 4, HBM3) |
| **GPU Interconnect** | NVIDIA NDR InfiniBand 400Gb/s | Lowest latency, NVIDIA-native RDMA |
| **IB NIC** | NVIDIA ConnectX-7 | NDR support, PCIe 5.0 |
| **IB Switch** | NVIDIA Quantum-2 (400Gb/s, 64-port) | SHARP collective offload, NVIDIA-native |
| **Ethernet** | 100GbE (for storage + K8s) | Sufficient for non-RDMA traffic |
| **Ethernet Switch** | Whitebox + SONIC | Open, programmable, cost-effective |
| **Topology** | Spine-Leaf (Clos) | Scalable, predictable, ECMP |
| **Servers** | Lenovo Neptune (liquid cooling) | Best thermal for dense GPU deployments |

---

### Layer 1 — Bare Metal Provisioning

| Component | Best Choice | Alternative |
|---|---|---|
| **K8s bare metal provisioning** | Metal3 + Cluster API | Canonical MAAS, Tinkerbell |
| **PXE/imaging backend** | OpenStack Ironic | Cobbler (legacy) |
| **Cluster lifecycle** | Cluster API (CAPI) | Rafay-managed provisioning |
| **HPC job compatibility** | Slinky (SLURM on K8s) | Volcano, native K8s Jobs |
| **Enterprise cluster mgmt** | BCM (if NVIDIA AI Enterprise) | Metal3 (open source) |
| **Node monitoring/BMC** | Redfish API + Ironic inspector | IPMI (older) |

---

### Layer 2 — Network Software

| Component | Best Choice | Alternative |
|---|---|---|
| **Switch OS** | SONIC | Cumulus Linux, Nokia SR Linux |
| **Routing** | BGP via FRRouting (in SONIC) | OSPF (smaller scale) |
| **Network automation** | Ansible + SONIC gNMI | Nokia EDA |
| **Zero-touch provisioning** | SONIC ZTP + Ansible | Manual (bad) |
| **K8s CNI (primary)** | Cilium (eBPF) | Calico |
| **K8s CNI (multi-NIC)** | Multus | Secondary NIC controller |
| **InfiniBand in Pods** | SR-IOV + IB VFs | Mellanox Network Operator |
| **Tenant isolation** | VxLAN/EVPN (SONIC) + NetworkPolicy (Cilium) | Pure Cilium |
| **Lossless Ethernet** | PFC + ECN (SONIC) | InfiniBand (no drops by design) |

---

### Layer 3 — Kubernetes

| Component | Best Choice | Alternative |
|---|---|---|
| **K8s Distribution** | RKE2 (Rancher) | kubeadm, k3s (edge) |
| **Container Runtime** | containerd | CRI-O |
| **GPU Resource Exposure** | NVIDIA GPU Operator (NUOP8R) | Manual device plugin |
| **MIG Management** | GPU Operator MIG Manager | nvidia-smi manual |
| **GPU Metrics** | DCGM Exporter → Prometheus | custom scripts |
| **Node Feature Discovery** | NFD (Node Feature Discovery) | Manual labels |
| **Multi-NIC** | Multus | SR-IOV Operator |
| **Network Policy** | Cilium Network Policy | Calico Network Policy |
| **Ingress** | Nginx Ingress + Cert-Manager | Traefik |
| **Certificate Management** | cert-manager | Manual |
| **GitOps** | ArgoCD | Flux |
| **Backup** | Velero (to MinIO S3) | Kasten K10 |
| **Secret Management** | External Secrets + HashiCorp Vault | K8s native secrets |
| **Monitoring** | Prometheus + Grafana + Alertmanager | Datadog (commercial) |
| **Logging** | Loki + Promtail | ELK stack |

---

### Layer 4 — Orchestration & ML

| Component | Best Choice | Alternative |
|---|---|---|
| **ML Orchestration** | KubeFlow 1.9+ | MLRun, Flyte |
| **GPU Scheduling** | KAI Scheduler | Run.ai (commercial) |
| **Distributed Training** | KubeFlow Training Operator (PyTorchJob) | MPI Operator |
| **Hyperparameter Tuning** | Katib | Optuna (external) |
| **Model Serving** | KServe + vLLM | Triton (for non-LLM) |
| **Pipeline Automation** | KubeFlow Pipelines | Argo Workflows (standalone) |
| **Experiment Tracking** | MLflow | Weights & Biases (commercial) |
| **Model Registry** | MLflow Registry + MinIO | DVC + MinIO |
| **Vector DB** | Milvus (large scale) | Qdrant (simpler) |
| **Data Versioning** | DVC | Pachyderm |

---

### Layer 5 — Storage

| Tier | Best Choice | Alternative |
|---|---|---|
| **Hot (NVMe shared FS)** | WEKA | GPFS/Spectrum Scale, Lustre |
| **Cold (Object/S3)** | MinIO + Ceph RadosGW | AWS S3 (cloud), Pure Storage |
| **Block (K8s PVCs)** | Ceph RBD via Rook | Longhorn, OpenEBS Mayastor |
| **etcd** | Dedicated SSD block (Ceph RBD) | Local NVMe (no redundancy) |
| **Filesystem (CephFS)** | CephFS via Rook | NFS (lower performance) |
| **K8s Storage Operator** | Rook-Ceph | OpenEBS |

---

### Layer 6 — Management

| Component | Best Choice | Alternative |
|---|---|---|
| **Multi-cluster Management** | Rafay | Rancher, Spectro Cloud Palette |
| **GitOps Platform** | Rafay + ArgoCD | Pure ArgoCD/Flux |
| **Tenant RBAC** | Rafay RBAC + K8s RBAC | Rancher RBAC |
| **SSP (self-service portal)** | Rafay SSP + KubeFlow Dashboard | Custom React portal |
| **Identity / SSO** | Keycloak (OIDC) + Rafay | Active Directory SAML |
| **Policy Enforcement** | OPA Gatekeeper | Kyverno |
| **Cost / Quota Tracking** | KubeCost | Manual |

---

## 4. Standard Tenant Architecture (RFP Example)

**Given:** 110 tenants, 64 GPUs, 1PB storage

```
HARDWARE
├── 8 × GPU nodes (8× H100 SXM5 80GB each = 64 GPUs total)
├── 3 × Control plane nodes (K8s master, no GPUs)
├── 2 × Storage nodes (WEKA hot, Ceph for cold/block)
└── 2 × Spine switches (SONIC, NDR InfiniBand)

STORAGE ALLOCATION (1PB)
├── Hot (WEKA NVMe):    200TB  → RAG vectors (Milvus)
├── Cold (MinIO/Ceph):  600TB  → Knowledge bases, model weights, datasets
└── Block (Ceph RBD):   200TB  → etcd, PVCs, checkpoints

TENANT DISTRIBUTION (110 tenants)
├── 33 Shared cluster tenants → up to 4 GPUs each (MIG slices from pool)
├── 44 vCluster tenants       → up to 8 GPUs each (KAI guaranteed quota)
└── 33 Bare metal tenants     → 1-2 dedicated GPU nodes each

GPU ALLOCATION
├── Pool A (shared): 16 GPUs → 33 tenants (MIG 1g.10gb = 7 slices/GPU = 112 slices)
├── Pool B (vCluster): 24 GPUs → 44 tenants (3 GPUs avg per vCluster, burst allowed)
└── Pool C (dedicated): 24 GPUs → 33 tenants (avg 0.7 GPU each, but dedicated nodes
    means groups of tenants get whole nodes)
```

---

## 5. Key Technology Decision Rationale

### Why RKE2 over kubeadm?
- CIS Kubernetes benchmark compliance out of the box
- FIPS 140-2 compliant (required for government/regulated clients)
- Built-in etcd backup
- Used natively by Rafay for bare metal cluster provisioning

### Why KAI over Run.ai?
- Open source (Apache 2.0) — zero licensing cost at scale
- Developed by NVIDIA — deepest GPU integration
- Gang scheduling, topology-aware, queue-based — all features of Run.ai
- Avoids $X/GPU/year Run.ai licensing

### Why Cilium over Calico?
- eBPF-based — no iptables, better performance at scale
- Native Kubernetes network policy + extended Cilium network policy
- Hubble (built-in observability) — see all network flows
- Better performance for East-West GPU traffic

### Why Ceph+Rook over Longhorn?
- Unified block + object + filesystem from one system
- More mature, production-proven at petabyte scale
- Rook makes it K8s-native (operator-managed)
- Longhorn is simpler but not suitable for PB-scale deployments

### Why vLLM over NIM for inference?
- Completely free — no NVIDIA AI Enterprise license
- PagedAttention = 20x more efficient GPU memory use
- Supports all HuggingFace models (not just NVIDIA-certified)
- Use NIM when clients specifically require NVIDIA AI Enterprise SLA

---

## 6. Standard Deployment Sequence

When you get a new RFP, here is the order of deployment:

```
1. Hardware Setup
   └── Rack servers, cable InfiniBand, cable Ethernet, SONIC on switches

2. Network Configuration
   └── SONIC: BGP routing, PFC/ECN (for RoCEv2), VxLAN, ZTP

3. Bare Metal Provisioning
   └── Metal3 + Ironic: PXE boot all nodes, install Ubuntu 22.04 LTS

4. Kubernetes Installation
   └── RKE2: 3 control plane nodes + N worker nodes via Cluster API

5. Rafay Agent Installation
   └── Register all clusters with Rafay Controller

6. Platform Add-ons (via Rafay Blueprint)
   └── GPU Operator, Cilium, Multus, cert-manager, Velero, Prometheus, Loki

7. Storage Deployment
   └── Rook-Ceph operator, WEKA CSI, MinIO operator

8. ML Platform
   └── KubeFlow, KAI Scheduler, MLflow, KServe

9. Tenant Onboarding
   └── Create Projects, Queues, ResourceQuotas, vClusters via Rafay SSP

10. Monitoring & Alerting
    └── Grafana dashboards: GPU utilization, storage IOPS, queue depth, tenant usage
```

---

## 7. Open Questions for Your Architecture

These are things to clarify with your boss or client:

- [ ] **Is InfiniBand or RoCEv2 preferred?** IB = better but more expensive. RoCEv2 = cheaper but needs SONIC PFC/ECN tuning.
- [ ] **Rafay SaaS or self-hosted?** SaaS = easier but data leaves your DC. Self-hosted = more complex setup.
- [ ] **BCM required?** If client has NVIDIA AI Enterprise contract already, BCM is included.
- [ ] **VMetal clarification** — get exact definition from boss.
- [ ] **What VRL stands for** — likely vCluster resource limits, confirm.
- [ ] **SONIC vs Nokia SR Linux?** Both are valid — which ecosystem is the client's network team familiar with?
- [ ] **NIM licensing?** Does the client have NVIDIA AI Enterprise? If yes, NIM is included.

---

## 8. Glossary — Every Tool in the Standard Architecture

| Tool | Layer | Type | Cost |
|---|---|---|---|
| NVIDIA H100 | Hardware | GPU | Hardware purchase |
| ConnectX-7 | Hardware | InfiniBand NIC | Hardware purchase |
| NVIDIA Quantum-2 | Hardware | IB Switch | Hardware purchase |
| SONIC | Network | Switch OS | Free (open source) |
| Ansible | Network | Automation | Free |
| Metal3 | Provisioning | Bare metal K8s | Free (CNCF) |
| Ironic | Provisioning | PXE imaging | Free (OpenStack) |
| Cluster API | Provisioning | K8s lifecycle | Free (CNCF) |
| Slinky | Provisioning | SLURM-K8s bridge | Free |
| RKE2 | K8s | Distribution | Free (Rancher/SUSE) |
| NVIDIA GPU Operator | K8s | GPU management | Free (open source) |
| Cilium | K8s | CNI | Free (CNCF) |
| Multus | K8s | Multi-NIC | Free |
| ArgoCD | K8s | GitOps | Free (CNCF) |
| cert-manager | K8s | TLS | Free |
| Velero | K8s | Backup | Free |
| Prometheus | K8s | Metrics | Free |
| Grafana | K8s | Visualization | Free |
| Loki | K8s | Logging | Free |
| KubeFlow | ML | ML platform | Free |
| KAI Scheduler | ML | GPU scheduling | Free (NVIDIA) |
| KServe | ML | Model serving | Free (CNCF) |
| vLLM | ML | LLM inference | Free |
| MLflow | ML | Experiment tracking | Free |
| WEKA | Storage | Hot NVMe FS | Commercial |
| MinIO | Storage | Object (S3) | Free (open source) |
| Ceph + Rook | Storage | Block/Object/FS | Free |
| Milvus | Storage | Vector DB | Free |
| Rafay | Management | Multi-cluster KOP | Commercial |
| Keycloak | Management | Identity/SSO | Free |
| OPA Gatekeeper | Management | Policy | Free |

---

*This document represents the recommended standard architecture. Individual client requirements may require adjustments — always validate against RFP requirements.*

*Documents in this series:*
- *01_hardware_networking.md — Physical layer*
- *02_nvidia_gpu.md — GPU virtualization*
- *03_kubernetes.md — K8s deep dive*
- *04_kubeflow_kai.md — ML orchestration*
- *05_bare_metal_provisioning.md — Server provisioning*
- *06_network_software.md — SONIC, EDA, Linux*
- *07_rafay.md — Management platform*
- *08_storage.md — Hot/cold/block storage*
- *09_tenant_models.md — Shared, vCluster, bare metal*
- *10_service_layer.md — JNaaS, ModelaaS, MLOps*
- *11_standard_architecture.md — This document*

---

## Decisions to be Made for Reference Architecture
### 1. InfiniBand vs RoCEv2 (Network Fabric)
This is the single most expensive decision in the architecture.
*   **Decision:** Finalize whether to use **NVIDIA NDR InfiniBand** (the gold standard, but very high cost) or **RoCEv2 over Ethernet** (cheaper, but requires perfect SONiC tuning with PFC/ECN) for the East-West GPU gradient synchronization fabric.

### 2. NIM Licensing (NVIDIA AI Enterprise)
This affects both the provisioning tool (BCM) and the inference engine (NIM).
*   **Decision:** Determine if the business model supports purchasing the **NVIDIA AI Enterprise** license suite. If not, the architecture must strictly rely on open-source alternatives like Metal3 and vLLM.

### 3. Full Stack Approval
Once all the above decisions are locked in across the 11 documents.
*   **Action Needed:** Approve the overarching standard architecture. This will trigger the generation of the final `ca_*.md` specification files for the `Reference Architecture` folder, completing the design phase.
