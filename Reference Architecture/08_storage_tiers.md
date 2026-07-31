# Storage Architecture & Tier Allocation Strategy

> Part of the [Chosen Architecture](index.md) specification.

---

## Storage Architecture & Tier Allocation Strategy

To satisfy the **1 PB storage RFP requirement** across **110 tenants** on **64 physical H100 GPUs**, the platform uses a **4-Tier Storage Architecture** split across two distinct physical server categories: **Compute Nodes** (local-attached) and **Dedicated Storage Rack** (network-attached).

---

## Physical Placement Overview

```
DATACENTER FOOTPRINT (3 Racks Total)
├── COMPUTE RACK A  (GPU Servers 1-4)      — local NVMe scratch inside servers
├── COMPUTE RACK B  (GPU Servers 5-8)      — local NVMe scratch inside servers
└── STORAGE RACK C  (Dedicated Storage)    — WEKA + MinIO + Ceph nodes + CP Nodes
```

---

## Master Storage Tier Table

| Tier | Sub-Category | Primary Contents | Software Tech | Physical Medium & Location | Capacity | Network Transport | K8s Access | Latency & IOPS |
|---|---|---|---|---|---|---|---|---|
| **1. LOCAL DIRECT NVMe** | **Compute Node Scratch** | OS root (`/`), Docker image layers, CUDA kernel cache, temporary PyTorch/vLLM scratch buffers | Linux `ext4 / xfs` | **4x 3.84 TB U.2 NVMe SSDs** inside each of the **8x Dell XE9680 GPU Compute Servers** | 15.36 TB per server<br>(**122.88 TB total** across 8 nodes) | Local PCIe Bus — No Network | K8s `emptyDir` / Local StorageClass | Latency: `< 50 µs`<br>IOPS: `> 500K` |
| **2. HOT STORAGE** | **Shared NVMe Fabric** | RAG Vector Databases (Milvus / Qdrant), high-bandwidth training datasets, active model checkpoints during training runs | **WEKA Data Platform** (Parallel File System) | Enterprise **PCIe 5.0 NVMe SSDs** in **3x Dedicated WEKA Storage Servers** in Storage Rack C | **200 TB** (20% of 1 PB) | 100GbE Ethernet via **RoCEv2** (RDMA) | WEKA CSI Driver — `weka-hot` StorageClass (RWX) | Latency: `< 100 µs`<br>IOPS: `> 10M` |
| **3. COLD STORAGE** | **S3 Object Store** | Raw source documents (PDFs, text, code) for RAG ingestion, base model weights (Llama 3, Mistral, Qwen), MLflow model artifacts, Velero cluster backups | **MinIO Enterprise** (S3-Compatible Object Store) | High-capacity **SATA/SAS HDDs** (7200 RPM) in **4x Dedicated MinIO Storage Servers** in Storage Rack C | **600 TB** (60% of 1 PB) | 100GbE Ethernet (TCP/IP — standard S3 HTTP) | MinIO Operator — S3 HTTP/HTTPS API Gateway per tenant bucket | Latency: `5 - 15 ms`<br>Bandwidth: `10 - 40 GB/s` |
| **4. BLOCK STORAGE** | **Persistent K8s Volumes** | Tenant PVCs (Jupyter home dirs, model checkpoints), PostgreSQL databases (KubeFlow metadata, MLflow tracking, Rafay state), vCluster root volumes | **Ceph RBD** via **Rook Operator** | Dedicated **Mixed NVMe + SATA SSD** drives in **3x Dedicated Ceph OSD Nodes** in Storage Rack C | **200 TB** (20% of 1 PB) | 100GbE Ethernet via **RBD / iSCSI** | Rook-Ceph CSI Driver — `ceph-block-ssd` StorageClass (RWO) | Latency: `1 - 3 ms`<br>IOPS: `> 100K` |

---

## Technology Selection Rationale

### Tier 1 — Compute Scratch on Local NVMe (Existing Hardware)
- **Why this matters:** The Dell XE9680 ships with 4x 3.84TB U.2 NVMe bays. These **already exist** and cost nothing extra. Directing container image caches, PyTorch scratch buffers, and CUDA compilation caches to local NVMe eliminates thousands of unnecessary IOPS against the shared WEKA / Ceph clusters.
- **Failure behaviour:** If a compute node's local NVMe fills up or fails, only that single node's ephemeral workloads are affected. The shared storage tiers (WEKA, MinIO, Ceph) remain completely unaffected.

### Tier 2 — WEKA over Ceph NVMe or Lustre
- **Why WEKA over Ceph for hot storage:** Ceph NVMe IOPS top out at ~500K under heavy concurrent AI training. WEKA delivers 10M+ IOPS by running directly on the same NVMe drives in a POSIX-compliant parallel filesystem. WEKA is also **NVIDIA DGX SuperPOD certified** — the official recommended storage for H100 GPU clusters.
- **Why WEKA over DDN:** DDN requires fully dedicated proprietary storage appliances and separate InfiniBand or 200GbE connections, adding significant CAPEX and a third network fabric. WEKA runs converged on standard 100GbE RoCEv2 — the Ethernet fabric already present in this architecture.

### Tier 3 — MinIO over Ceph RadosGW
- **Why MinIO:** MinIO has a purpose-built Kubernetes Operator, native first-class integration with KubeFlow Pipelines (artifact store) and MLflow (model registry), and achieves up to 325 GiB/s read throughput. Ceph RadosGW adds Ceph cluster management overhead and is operationally more complex for the same S3-compatible outcome.
- **Multi-tenancy:** Each tenant or vCluster gets an isolated S3 bucket with its own IAM access key pair, enforced by MinIO bucket policies and storage quotas.

### Tier 4 — Ceph RBD via Rook over Longhorn or Portworx
- **Why Ceph RBD over Longhorn:** Longhorn is excellent for single-node development or small clusters. At 110-tenant scale with hundreds of simultaneous PVCs and database volumes, Longhorn's single-disk replication model and lack of CEPH-style pool management becomes a bottleneck.
- **Why Ceph RBD over Portworx:** Portworx Enterprise is commercial and licensed per node — adding significant and recurring OPEX at 10+ node scale. Rook-Ceph is 100% open-source and CNCF-graduated.
- **Why Rook Operator:** Rook manages the entire Ceph cluster lifecycle as Kubernetes CRDs — no manual Ceph cluster administration required.

---

## 1 PB Capacity Breakdown — 110 Tenants

```
1,000 TB TOTAL (1 PB)
├── 200 TB  HOT  (WEKA)         — 20%  →  ~1.8 TB per tenant  (RAG vectors, active checkpoints)
├── 600 TB  COLD (MinIO)        — 60%  →  ~5.4 TB per tenant  (documents, model weights, backups)
└── 200 TB  BLOCK (Ceph RBD)   — 20%  →  ~500 GB per tenant  (PVCs, databases, home dirs)

Plus: 122.88 TB Local Scratch (across 8 GPU compute servers — not counted in 1 PB RFP budget)
```

---

## Storage Network & Physical Architecture Diagram

<object type="image/svg+xml" data="../assets/diagrams/08_storage_tiers.svg" class="mermaid-svg"></object>

---

## Storage Traffic Flow Summary

### What travels over 100GbE Ethernet (SONIC Leaf Switches)
| Traffic Type | Source | Destination | Protocol |
|---|---|---|---|
| **WEKA dataset reads** | GPU Compute Nodes 1-8 | WEKA NVMe Storage Nodes | RoCEv2 (RDMA) |
| **WEKA checkpoint writes** | GPU Compute Nodes 1-8 | WEKA NVMe Storage Nodes | RoCEv2 (RDMA) |
| **MinIO model weight reads** | GPU Compute Nodes 1-8 | MinIO HDD Nodes | S3 HTTP |
| **MLflow / KubeFlow artifacts** | GPU Compute Nodes 1-8 | MinIO HDD Nodes | S3 HTTP |
| **Ceph RBD PVC reads/writes** | GPU Compute Nodes 1-8 | Ceph OSD Nodes | RBD (RADOS) |


### What does NOT travel over Ethernet (InfiniBand Only)
| Traffic Type | Protocol |
|---|---|
| GPU-to-GPU gradient synchronization (AllReduce) | InfiniBand NDR 400G |
| NCCL collective communications | InfiniBand NDR 400G |
| SHARP in-network compute offload | InfiniBand NDR 400G |

### What stays local (Never hits the network)
| Traffic Type | Location |
|---|---|
| Docker image layer cache | Local NVMe on GPU compute nodes |
| CUDA kernel compilation cache | Local NVMe on GPU compute nodes |
| PyTorch/vLLM temporary tensors | Local NVMe on GPU compute nodes |

---

*Back to [Chosen Architecture Index](index.md)*
