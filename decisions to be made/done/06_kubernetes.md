# 03 — Kubernetes (K8s) Deep Dive

> Covers: K8s architecture, control plane, worker nodes, Pods, Operators, CRDs, GPU scheduling, and HPC-specific patterns.

---

## 1. What Is Kubernetes?

**Kubernetes (K8s)** is an open-source container orchestration system originally developed by Google (released 2014), now maintained by the CNCF (Cloud Native Computing Foundation).

**What it does:**
- Runs containers (Docker, containerd) across a cluster of machines
- Automatically schedules containers to the right nodes
- Restarts crashed containers (self-healing)
- Scales workloads up and down
- Manages networking, storage, and configuration for containers

**In your architecture:** K8s is the core layer that sits on top of bare metal hardware and manages ALL workloads — GPU training jobs, inference services, Jupyter notebooks, and infrastructure components.

---

## 2. K8s Architecture

```
CONTROL PLANE (Master nodes — usually 3 for HA)
┌─────────────────────────────────────────────────────┐
│  API Server  │  etcd  │  Controller Manager  │  Scheduler  │
└─────────────────────────────────────────────────────┘
                         |
          (API calls / kubelet heartbeats)
                         |
WORKER NODES (your GPU servers)
┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│  kubelet     │  │  kubelet     │  │  kubelet     │
│  kube-proxy  │  │  kube-proxy  │  │  kube-proxy  │
│  containerd  │  │  containerd  │  │  containerd  │
│  [Pods...]   │  │  [Pods...]   │  │  [Pods...]   │
└──────────────┘  └──────────────┘  └──────────────┘
```

### Control Plane Components
| Component | Role |
|---|---|
| **API Server (kube-apiserver)** | The front door of K8s — all kubectl commands hit this. Validates and stores state in etcd. |
| **etcd** | Distributed key-value store — stores ALL cluster state (what's running, config, secrets). If etcd dies, cluster is dead. |
| **Controller Manager** | Runs control loops — e.g., "if I want 3 replicas and only 2 are running, create 1 more" |
| **Scheduler (kube-scheduler)** | Decides WHICH node each new Pod goes to, based on resources, affinity rules, taints/tolerations |

### Worker Node Components
| Component | Role |
|---|---|
| **kubelet** | Agent on each node — talks to API server, ensures containers are running |
| **kube-proxy** | Network rules — implements K8s Services (load balancing) via iptables/IPVS |
| **containerd** | Container runtime — actually starts and stops containers |

---

## 3. Pods — The Basic Unit

A **Pod** is the smallest deployable unit in K8s. It wraps one or more containers that share:
- Network namespace (same IP, same ports)
- Storage volumes

### Pod Lifecycle
```
Pending → Running → Succeeded/Failed
    (scheduling)  (containers running)
```

### GPU Pod Example
```yaml
apiVersion: v1
kind: Pod
metadata:
  name: gpu-job
spec:
  containers:
  - name: training
    image: nvcr.io/nvidia/pytorch:24.01-py3
    resources:
      limits:
        nvidia.com/gpu: 1        # Request 1 GPU
        memory: "32Gi"
        cpu: "8"
      requests:
        nvidia.com/gpu: 1
        memory: "16Gi"
        cpu: "4"
```

The `nvidia.com/gpu: 1` resource is registered by the **GPU Device Plugin** (part of NVIDIA GPU Operator).

---

## 4. Key K8s Workload Types

| Type | Use Case | In Your Platform |
|---|---|---|
| **Pod** | Single job, one-off | Basic GPU job |
| **Deployment** | Long-running services (inference API) | ModelaaS serving |
| **StatefulSet** | Stateful apps (databases) | etcd, some ML databases |
| **DaemonSet** | Run on EVERY node | GPU Operator components (driver, DCGM) |
| **Job** | Batch processing, run-to-completion | Training jobs |
| **CronJob** | Scheduled jobs | Periodic batch inference |

---

## 5. Custom Resource Definitions (CRDs) and Operators

### CRDs — Extending K8s
**CRDs (Custom Resource Definitions)** let you add NEW types of resources to K8s beyond the built-ins. For example:
- `GPUJob` — a custom type for GPU training jobs
- `InferenceService` — a custom type for model serving (used by KServe)
- `MIGPolicy` — a custom type for MIG configuration

### Operators — Automating Complex Apps
An **Operator** is a controller that watches CRDs and takes action to make reality match the desired state.

```
You define: "I want a GPUJob with 4 GPUs for 2 hours"
Operator watches this CRD
Operator creates: Pods, ConfigMaps, Services, NetworkPolicies
Operator monitors: handles failures, scaling, cleanup
```

**This is exactly what the NVIDIA GPU Operator does** — it watches for GPU nodes joining the cluster and automatically installs drivers, device plugins, etc.

### Notable CRDs in Your Stack
| CRD Type | Source | Purpose |
|---|---|---|
| `PyTorchJob` | KubeFlow Training Operator | Distributed PyTorch training |
| `TFJob` | KubeFlow Training Operator | Distributed TensorFlow training |
| `MPIJob` | KubeFlow MPI Operator | MPI-based distributed training |
| `InferenceService` | KServe | Model serving |
| `Notebook` | KubeFlow Notebooks | Jupyter notebook instances |
| `ClusterPolicy` | NVIDIA GPU Operator | GPU Operator configuration |
| `MIGPolicy` | NVIDIA MIG Manager | MIG slicing rules |
| `Queue` | KAI Scheduler | Tenant queue definitions |

---

## 6. Taints, Tolerations & Node Affinity — GPU Node Selection

In HPC/GPU clusters, you want to ensure GPU workloads run on GPU nodes and NOT on control plane or CPU-only nodes.

### Taints
A **taint** marks a node as special — only Pods that "tolerate" the taint will be scheduled there.

```yaml
# Add a taint to GPU nodes (done by GPU Operator automatically)
kubectl taint nodes gpu-node-01 nvidia.com/gpu=present:NoSchedule
```

### Tolerations
A Pod that wants to run on GPU nodes must have a matching toleration:
```yaml
tolerations:
- key: "nvidia.com/gpu"
  operator: "Exists"
  effect: "NoSchedule"
```

### Node Affinity
More flexible — lets you prefer or require certain node labels:
```yaml
affinity:
  nodeAffinity:
    requiredDuringSchedulingIgnoredDuringExecution:
      nodeSelectorTerms:
      - matchExpressions:
        - key: nvidia.com/gpu.product
          operator: In
          values: ["NVIDIA-H100-SXM5-80GB"]
```

---

## 7. K8s Networking — CNI

**CNI (Container Network Interface)** plugins provide networking for K8s Pods.

| CNI Plugin | Notes | Used For |
|---|---|---|
| **Calico** | Most popular, network policy support, BGP routing | General K8s |
| **Cilium** | eBPF-based, very fast, deep observability | Modern K8s, preferred for HPC |
| **Flannel** | Simple, limited features | Small clusters |
| **Multus** | Allows multiple NICs per Pod | GPU clusters (IB + Eth) |
| **MACVLAN / IPVLAN** | Direct NIC access from Pod | InfiniBand, SR-IOV |

**Critical for GPU clusters:** **Multus** is used to give Pods access to BOTH Ethernet and InfiniBand NICs simultaneously. This is required for GPU training jobs that use RDMA.

---

## 8. Storage in K8s — PV/PVC

**PersistentVolume (PV):** A piece of storage in the cluster (e.g., 100GB Ceph block device)  
**PersistentVolumeClaim (PVC):** A request by a Pod to use a PV

```
[Ceph / NFS / local NVMe]
        ↓ PersistentVolume (PV)
[StorageClass] ← defines how to provision
        ↓ PersistentVolumeClaim (PVC)
        ↓
[Pod mounts PVC as a filesystem]
```

### Storage Classes in Your Architecture
| StorageClass | Backend | Tier |
|---|---|---|
| `hot-nvme` | Local NVMe or WEKA | Hot (RAG) |
| `cold-s3` | MinIO / Ceph Object | Cold (knowledge bases) |
| `block-rbd` | Ceph RBD | Block (Pods, etcd) |

---

## 9. RBAC — Role-Based Access Control

K8s has built-in RBAC that Rafay leverages for multi-tenancy.

```
ServiceAccount (identity for a Pod)
    |
ClusterRoleBinding or RoleBinding
    |
ClusterRole or Role (defines permissions)
    |
Rules (what API groups, resources, verbs are allowed)
```

**Example:** A tenant's Pods have a ServiceAccount with a Role that only allows them to create Pods in their own namespace.

---

## 10. etcd — The Brain of K8s

**etcd** is a distributed, strongly consistent key-value store. Every piece of K8s state is stored here:
- What Pods exist and their state
- Config (ConfigMaps, Secrets)
- RBAC rules
- CRD definitions
- Cluster membership

### Why etcd is Critical
- **If etcd loses quorum → K8s API server goes read-only or down**
- Requires dedicated **block storage** with low latency (SSD/NVMe)
- Typical etcd cluster: **3 or 5 nodes** (odd number for Raft quorum)
- Regular backups are mandatory (etcd snapshot)

### This is why etcd needs Block Storage
Block storage in your architecture (see storage doc) is partially dedicated to etcd — it needs fast, reliable block-level I/O. NFS is NOT suitable for etcd.

---

## 11. K8s Distributions for HPC

You're not running vanilla K8s — you're running a distribution. Common choices:

| Distribution | Vendor | Notes |
|---|---|---|
| **RKE2** | Rancher/SUSE | Security-focused, good for bare metal, used by Rafay |
| **K3s** | Rancher/SUSE | Lightweight, used for edge, not HPC |
| **Kubeadm** | CNCF | Vanilla K8s, manual, full control |
| **OpenShift** | Red Hat | Enterprise, very feature-rich, expensive |
| **Tanzu** | VMware | VMware-native, good if you have vSphere |
| **EKS/GKE/AKS** | AWS/GCP/Azure | Cloud-managed, not bare metal |

**Rafay typically uses RKE2** for bare metal clusters — it's hardened (FIPS, CIS Benchmark compliant) and has good GPU support.

---

## 12. HPC on K8s — Key Challenges & Solutions

| Challenge | Problem | Solution |
|---|---|---|
| **Gang scheduling** | 8-GPU job fails if even 1 GPU is unavailable | KAI Scheduler gang scheduling |
| **NUMA awareness** | CPU memory locality matters for GPU workloads | CPU Manager + Topology Manager in kubelet |
| **Huge pages** | Some HPC apps need large memory pages | K8s hugepages resource |
| **InfiniBand in Pods** | Need RDMA inside containers | Multus + SR-IOV device plugin |
| **MPI jobs** | MPI requires all pods to start together | KubeFlow MPI Operator |

---

## Summary

| K8s Concept | Relevance to Your Platform |
|---|---|
| Control Plane + etcd | Core cluster brain — needs block storage, 3-node HA |
| Pods + Jobs | How GPU workloads run |
| GPU Operator (CRDs) | Auto-provisions GPUs on every node |
| Taints/Tolerations | Keeps GPU nodes for GPU workloads |
| Multus CNI | Gives Pods access to InfiniBand |
| RBAC | Tenant isolation — Rafay builds on this |
| PV/PVC + StorageClasses | Connects Pods to hot/cold/block storage |
| CRDs + Operators | KubeFlow training, KAI scheduling, MIG management |

---

## Decisions to be Made for Reference Architecture
### 1. Kubernetes Distribution Selection
You need to decide which flavor of Kubernetes will run on your bare metal servers.
*   **Decision:** Confirm the use of **RKE2** (Rancher Kubernetes Engine 2) as your distribution. RKE2 is highly recommended for bare metal because it handles embedded etcd natively, is CIS benchmark hardened (government-grade security), and is fully supported by Rafay out of the box. The alternative is upstream `kubeadm` which is much more manual.

### 2. GPU Integration & Lifecycle
You need to decide how GPUs are exposed and managed across the cluster lifecycle.
*   **Decision:** Confirm the deployment of the **NVIDIA GPU Operator**. This is essentially mandatory to automatically install drivers, manage MIG profiles dynamically (`mig-parted`), and expose GPU metrics to Prometheus without logging into every single node to run scripts.

### 3. Storage Integration Mapping
You need to bridge the gap between K8s Pods and your physical storage tiers.
*   **Decision:** Confirm the mapping of Kubernetes `StorageClass` configurations to the underlying hardware: e.g. mapping `hot-nvme` to WEKA CSI, `cold-s3` to MinIO Operator, and `block-rbd` to Ceph via Rook. This ensures tenants can just request a generic PVC and get the right tier automatically.

---
*Next: See `04_kubeflow_kai.md` for KubeFlow and the KAI Scheduler.*
