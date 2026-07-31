# 08 — Storage Architecture (Deep Dive)

> Covers: Hot/Cold/Block storage tiers, Ceph, WEKA, MinIO, NFS, ETCD, RAG vector storage, and how to size 1PB for 110 tenants.

---

## 1. Storage Tiers Overview

Your boss defined 3 storage tiers for the platform. Here's the expanded picture:

```
1 PB Total Storage
├── HOT STORAGE (~30-40% of total)     → RAG Vector Data, NVMe-backed
├── COLD STORAGE (~40-50% of total)    → Object Knowledge Bases, S3/NFS
└── BLOCK STORAGE (~20-30% of total)   → K8s, etcd, VMs, Pods
```

---

## 2. Hot Storage — RAG & Vector Data

### What is Hot Storage?
**Hot storage** = Lowest latency, highest bandwidth storage. Data accessed frequently and urgently.

**In your architecture:** Used for **RAG (Retrieval-Augmented Generation)** — a technique where LLMs retrieve relevant context from a vector database before generating a response.

**Why hot storage matters for RAG:**
- RAG vector search must complete in milliseconds before the LLM response
- A slow vector DB = slow LLM response = bad user experience
- Requires NVMe SSDs (not HDDs, not SATA SSDs)

### RAG Architecture
```
User Question
    ↓
Vector Embedding (convert question to vector)
    ↓
Vector DB Search (HOT STORAGE — milliseconds)
    ↓
Retrieve top-K relevant documents
    ↓
Combine question + context → LLM prompt
    ↓
LLM generates answer (referencing the retrieved context)
```

### Vector Databases (Hot Storage Backends)
| Tool | Type | Notes |
|---|---|---|
| **Milvus** | Open source | Most feature-rich, designed for billions of vectors |
| **Qdrant** | Open source (Rust) | Fast, simple, great K8s support |
| **Weaviate** | Open source | GraphQL API, built-in embedding models |
| **Pinecone** | SaaS | Managed, expensive, no self-host |
| **pgvector** | PostgreSQL extension | Simple, good for smaller scale |
| **ChromaDB** | Open source | Simple, dev-friendly |
| **Redis (RedisVSS)** | Redis extension | Ultra-fast for smaller vector sets |

**Recommendation for your platform:** **Milvus** (large scale, K8s-native, persistent volumes on hot NVMe) or **Qdrant** (simpler, very performant).

### Hot Storage Technology
| Technology | IOPS | Latency | Bandwidth | Notes |
|---|---|---|---|---|
| **Local NVMe (PCIe 5.0)** | ~2M IOPS | ~20 µs | ~14 GB/s | Fastest, per-node, not shared |
| **WEKA** | ~10M IOPS | ~100 µs | ~tens GB/s | Shared NVMe fabric, best for AI |
| **GPFS / Spectrum Scale** | Very high | ~100-200 µs | Very high | IBM's parallel FS, HPC standard |
| **Lustre** | High | ~200-500 µs | Very high | Open source parallel FS, used in supercomputers |
| **NFS over NVMe** | Medium | ~500 µs | Medium | Simpler, not optimal for hot |

**Best for AI workloads:** **WEKA** — it creates a shared NVMe fabric across all GPU nodes. Training jobs can all access the same dataset simultaneously at NVMe speeds. WEKA is specifically designed for AI/ML storage.

---

## 3. WEKA — Deep Dive

**WEKA** is a high-performance, cloud-native parallel file system designed for AI and HPC workloads.

- **Architecture:** Runs as software on the same servers (converged with compute) OR on dedicated storage nodes
- **Performance:** 10+ million IOPS, sub-100µs latency, terabytes/sec aggregate bandwidth
- **K8s integration:** CSI driver for K8s PVC provisioning
- **NVIDIA DGX certified:** Official recommended storage for NVIDIA DGX SuperPOD

```
GPU Servers
├── Server A: trains model, reads dataset from WEKA at 10 GB/s
├── Server B: trains model, reads dataset from WEKA at 10 GB/s
└── Server C: trains model, reads dataset from WEKA at 10 GB/s
              ↓ All accessing same WEKA namespace simultaneously
         WEKA filesystem (distributed across all NVMe drives)
```

**Alternatives:**
- **DDN (DataDirect Networks)** — traditional HPC storage vendor, very high performance
- **NetApp ONTAP** — enterprise storage, good K8s CSI
- **Pure Storage** — high performance, enterprise support

---

## 4. Cold Storage — Object Knowledge Bases

### What is Cold Storage?
**Cold storage** = Higher capacity, lower cost, higher latency. Data accessed less frequently.

**In your architecture:** Used for **Object Knowledge Bases** — the documents, PDFs, papers, codebases, and data that are indexed for RAG. Not the vectors themselves — the source documents.

**Technologies:**
- **S3 (Amazon S3 protocol)** — Object storage API, most widely supported
- **NFS (Network File System)** — Traditional shared filesystem, simple but less scalable
- **MinIO** — Open-source S3-compatible object storage (self-hosted)
- **Ceph Object (RadosGW)** — Ceph's S3-compatible gateway

### MinIO — Deep Dive
**MinIO** is the most popular open-source, self-hosted S3-compatible object storage.

- **Performance:** Very high (up to 325 GiB/s read on NVMe), best open-source object storage
- **K8s native:** MinIO Operator for K8s deployment
- **Erasure coding:** Data redundancy without RAID (survives N disk failures)
- **Tiering:** Automatic lifecycle policies (hot → warm → cold)
- **Used by:** KubeFlow Pipelines stores artifacts in MinIO, MLflow stores models in MinIO

```yaml
# MinIO in K8s via MinIO Operator
apiVersion: minio.min.io/v2
kind: Tenant
metadata:
  name: cold-storage
spec:
  pools:
  - servers: 4
    volumesPerServer: 4
    volumeClaimTemplate:
      spec:
        storageClassName: ceph-block
        resources:
          requests:
            storage: 50Ti   # 200TB per pool
```

### Ceph Object Storage (RadosGW)
If you're already running **Ceph** for block storage (see below), you can use **Ceph RadosGW** as your S3-compatible object store — no additional software needed. The same Ceph cluster can serve block + object + filesystem storage.

---

## 5. Block Storage — K8s, etcd, VMs, Pods

### What is Block Storage?
**Block storage** = Raw block devices. No filesystem on the storage side — applications format it themselves. Analogous to a raw SSD that a server formats and mounts.

**In your architecture:** Used for:
- **Kubernetes PVCs** — Pod persistent data (models, checkpoints)
- **etcd** — K8s control plane state (MUST be block storage, not NFS)
- **VMs** — If any VMs are part of the stack (vGPU, vCluster VMs)
- **Databases** — PostgreSQL for MLflow, KubeFlow metadata

### Ceph — The Standard Open-Source Block Storage

**Ceph** is the most widely deployed open-source distributed storage system. It provides SIMULTANEOUSLY:
- **Block storage** (RBD — RADOS Block Device) → K8s PVCs, etcd
- **Object storage** (RadosGW) → S3-compatible cold storage
- **Filesystem** (CephFS) → Shared filesystems for Pods

**Architecture:**
```
Ceph Cluster
├── MON (Monitors): 3+ nodes — track cluster state, quorum
├── MGR (Manager): Dashboard, telemetry, modules
├── OSD (Object Storage Daemons): 1 per disk — store the actual data
└── MDS (Metadata Server): Only for CephFS
```

**K8s Integration:** **Rook** is the K8s operator for Ceph — it manages the entire Ceph cluster lifecycle as K8s CRDs.

```
Rook Operator → manages → Ceph Cluster (in K8s)
                              ↓
                    StorageClass: ceph-block (RBD)
                    StorageClass: ceph-filesystem (CephFS)
                    StorageClass: ceph-bucket (RadosGW / S3)
```

### Ceph Performance Characteristics
| Metric | HDD Ceph | SSD Ceph | NVMe Ceph |
|---|---|---|---|
| **IOPS** | ~100-200 | ~10,000-50,000 | ~500,000+ |
| **Latency** | ~5-10ms | ~0.5-2ms | ~100-500µs |
| **Capacity** | Very high (cheap) | Medium | Lower (expensive) |
| **Best for** | Cold storage | Block/DB storage | Hot storage |

**For your architecture:**
- etcd → SSD-backed Ceph RBD (low latency required)
- Pod PVCs (models, checkpoints) → NVMe or SSD Ceph
- Cold object storage → HDD-backed Ceph RadosGW

### Other Block Storage Options
| Tool | Notes |
|---|---|
| **Longhorn** | Lightweight Rancher block storage, K8s-native, simpler than Ceph |
| **OpenEBS** | CNCF, multiple backends (Mayastor for NVMe, Jiva for HDD) |
| **Portworx** | Commercial, feature-rich, high performance, expensive |
| **Local storage** | Fastest (direct NVMe), but no redundancy, not suitable for stateful apps |

---

## 6. etcd — Specific Storage Requirements

**etcd is extremely sensitive to storage latency.** It writes data with `fsync` — waiting for the disk to confirm the write before proceeding. On slow disks:
- etcd write latency goes up → K8s API becomes slow
- If etcd can't write fast enough → etcd elections → cluster instability

### etcd Storage Benchmarks
| Storage | P99 Latency | etcd Suitable? |
|---|---|---|
| **NVMe local** | < 1ms | ✅ Best |
| **NVMe Ceph RBD** | 1-3ms | ✅ Good |
| **SSD Ceph RBD** | 3-10ms | ⚠️ Marginal |
| **HDD** | > 10ms | ❌ No |
| **NFS** | Variable | ❌ Never use NFS for etcd |

**etcd sizing:**
- 3 nodes (minimum) or 5 nodes (recommended for large clusters)
- 8-32 GB RAM each, 2-4 fast SSD cores dedicated
- Snapshot backups every 30 minutes

---

## 7. Sizing Exercise — 110 Tenants, 64 GPUs, 1PB

This is the real-world RFP scenario from your notes. Here's how to approach it:

### Step 1 — GPU Allocation
```
64 GPUs total, 110 tenants
Option A: MIG 1g.10gb on H100 → 7 slices per GPU → 64×7 = 448 GPU slices
    448 / 110 = ~4 GPU slices per tenant (for small workloads)

Option B: Mixed — some tenants get full GPUs, some get MIG slices
    10 tenants × 4 GPUs (training) = 40 GPUs
    100 tenants × MIG 1g.10gb = 24 GPUs × 7 = 168 slices → 168 inference/notebook users
```

### Step 2 — Storage Allocation (1PB)
```
Total: 1,000 TB

Hot Storage (RAG vectors):       200 TB  (20%)
  → Vector DB data: 1-5 TB per tenant for embeddings
  → 200 TB / 110 tenants = ~1.8 TB per tenant of vector storage
  → Technology: WEKA or Ceph NVMe

Cold Storage (Knowledge bases):  600 TB  (60%)
  → Source documents: 5-10 TB per tenant
  → 600 TB / 110 tenants = ~5.5 TB per tenant
  → Technology: Ceph RadosGW / MinIO on HDD

Block Storage (K8s/etcd/models): 200 TB  (20%)
  → etcd: 5 × 20GB = 100GB (tiny but needs fast SSD)
  → K8s PVCs per tenant: ~500 GB each (models, checkpoints)
  → 110 × 500 GB = 55 TB
  → Infrastructure: 10 TB
  → Technology: Ceph RBD on SSD/NVMe
```

### Step 3 — Tenant Type Breakdown
```
110 tenants:
  30% Bare Metal        → 33 tenants, dedicated GPU nodes
  40% vCluster          → 44 tenants, virtual K8s environment
  30% Shared            → 33 tenants, submit jobs to shared pool
```

---

## 8. Recommended Standard — Storage Architecture

| Tier | Technology | Hardware | Capacity |
|---|---|---|---|
| **Hot (RAG/vectors)** | WEKA or Ceph NVMe | NVMe SSDs (PCIe 4/5) | 20-30% of total |
| **Cold (objects/docs)** | MinIO or Ceph RadosGW | HDD (7200 RPM, large capacity) | 50-60% of total |
| **Block (K8s/etcd)** | Ceph RBD (Rook operator) | SSD (SATA/NVMe mix) | 20-30% of total |
| **Vector DB** | Milvus or Qdrant | On hot WEKA/Ceph NVMe | Included in hot tier |
| **Model Registry** | MinIO + MLflow | On cold tier | Included in cold tier |
| **Backup** | Velero → S3-compatible | HDD or tape | Separate budget |

**Golden Rule:** Never use NFS for etcd. Always SSD/NVMe block storage for K8s control plane.

---
*Next: See `09_tenant_models.md` for detailed breakdown of the 3 tenant types.*
