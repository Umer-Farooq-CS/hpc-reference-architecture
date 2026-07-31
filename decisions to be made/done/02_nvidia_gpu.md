# 02 — NVIDIA GPU Ecosystem (Deep Dive)

> Covers: CUDA, NVIDIA GPU Operator, MIG, Time Slicing, vGPU, NIM, and how they fit together.  
> NUOP8R = NVIDIA GPU Operator (corrected from original notes).

---

## 1. CUDA — The Foundation

**CUDA (Compute Unified Device Architecture)** is NVIDIA's parallel computing platform and programming model. It is the lowest-level software layer that lets applications talk to NVIDIA GPUs.

### What CUDA Does
- Provides the compiler (`nvcc`), runtime libraries, and driver API
- Exposes GPU cores as programmable "threads" organized into blocks and grids
- Is the reason NVIDIA GPUs dominate AI/ML — PyTorch, TensorFlow, JAX all compile down to CUDA kernels

### CUDA in Your Architecture
```
Application (PyTorch / TensorFlow)
         |
  CUDA Runtime (libcudart)
         |
  CUDA Driver (kernel module: nvidia.ko)
         |
  GPU Hardware (A100 / H100)
```

### CUDA Versions Matter
Different ML frameworks require specific CUDA versions. In K8s, this is managed by the **NVIDIA GPU Operator** (NUOP8R) which ensures the right drivers and CUDA toolkit versions are deployed on each node.

| CUDA Version | Key Milestone |
|---|---|
| CUDA 11.x | A100 support, bf16, TF32 |
| CUDA 12.x | H100 support, NVLink 4.0, FP8 |
| CUDA 12.4+ | Current recommended for H100 clusters |

---

## 2. NVIDIA GPU Operator (NUOP8R)

This is what your boss wrote as "NUOP8R" — it is the **NVIDIA GPU Operator**, a Kubernetes Operator that automates all GPU-related software installation on cluster nodes.

### The Problem It Solves
Without the GPU Operator, on every new K8s node with GPUs you'd manually need to install:
- NVIDIA drivers
- CUDA toolkit
- Container Runtime (nvidia-container-toolkit)
- Device Plugin (to expose GPUs as K8s resources)
- DCGM Exporter (GPU metrics for Prometheus)
- MIG Manager (if using MIG)
- NFD (Node Feature Discovery)

This is tedious and error-prone across hundreds of nodes. The **GPU Operator automates all of it**.

### How the GPU Operator Works
```
GPU Operator (runs as a Pod in gpu-operator namespace)
    |
    |-- deploys --> NVIDIA Driver DaemonSet (one pod per GPU node)
    |-- deploys --> CUDA Toolkit DaemonSet
    |-- deploys --> Device Plugin DaemonSet (registers gpu: resource in K8s)
    |-- deploys --> DCGM Exporter DaemonSet (GPU metrics)
    |-- deploys --> MIG Manager DaemonSet (MIG configuration)
    |-- deploys --> Node Feature Discovery (labels nodes by GPU type)
    |-- deploys --> GPU Feature Discovery (detailed GPU capability labels)
```

### Key Stats
- **Current version:** 24.x (2024/2025)
- **Supported OS:** Ubuntu 20.04/22.04, RHEL 8/9, Rocky Linux
- **Supported GPU:** All NVIDIA data center GPUs (V100, A100, H100, L40S, etc.)
- **Install method:** Helm chart
- **GitHub:** github.com/NVIDIA/gpu-operator

### GPU Operator Components in Detail
| Component | Role |
|---|---|
| **NVIDIA Driver Container** | Installs the NVIDIA kernel module without touching host OS |
| **Container Toolkit** | Patches container runtime so containers can access GPUs |
| **Device Plugin** | Registers `nvidia.com/gpu` as a K8s schedulable resource |
| **DCGM Exporter** | Exports GPU metrics (utilization, temp, memory) to Prometheus |
| **MIG Manager** | Configures MIG slices on A100/H100 nodes per strategy |
| **Node Feature Discovery** | Labels nodes so workloads can target specific GPU types |
| **GPU Feature Discovery** | Adds fine-grained GPU labels (VRAM size, CUDA capability) |

### Why This Is Critical for Your Architecture
The GPU Operator is **mandatory** for any serious K8s-based GPU platform. It is the glue between Kubernetes and NVIDIA hardware. Without it, you can't schedule GPU workloads in K8s at all.

---

## 3. GPU Sharing — The 3 NVIDIA Methods

### 3.1 Time Slicing

**What it is:** Multiple containers share a single GPU by taking turns (time-multiplexed). NVIDIA GTS (GPU Time Slicing) was introduced in 2021.

**How it works:**
```
GPU (one physical device)
  [Job A gets 10ms] → [Job B gets 10ms] → [Job C gets 10ms] → repeat
```

**Configured in K8s via:** GPU Operator / Device Plugin config

**Key properties:**
| Property | Value |
|---|---|
| **Isolation** | None — no memory isolation between jobs |
| **Overhead** | Context switch overhead (~microseconds) |
| **Memory** | All slices share the same GPU VRAM pool |
| **Supported GPUs** | All NVIDIA GPUs |
| **Oversubscription** | Yes — you can expose 1 GPU as 4, 8, 16 "virtual" GPUs |

**Limitation:** If Job A uses 10GB VRAM and Job B uses 10GB VRAM on a 40GB A100 — fine. But if either crashes or uses too much memory, it affects ALL other jobs on that GPU. No isolation.

**Best for:** Dev/test workloads, inference, small jobs that don't need full GPU memory.

---

### 3.2 MIG — Multi-Instance GPU

**What it is:** Hardware-level partitioning of an NVIDIA A100 or H100 into isolated GPU instances. Each instance has dedicated SM (streaming multiprocessor) cores, memory bandwidth, and L2 cache.

**How it works:**
```
H100 (80GB HBM3, 132 SMs)
  ├── MIG 1g.10gb  (1/7 of GPU,  10GB, ~19 SMs)
  ├── MIG 1g.10gb
  ├── MIG 2g.20gb  (2/7 of GPU,  20GB, ~38 SMs)
  └── MIG 3g.40gb  (3/7 of GPU,  40GB, ~57 SMs)
```

**MIG Profiles for H100 80GB:**
| Profile | SMs | VRAM | Instances per GPU |
|---|---|---|---|
| 1g.10gb | 1/7 | 10 GB | 7 max |
| 2g.20gb | 2/7 | 20 GB | 3 max |
| 3g.40gb | 3/7 | 40 GB | 2 max |
| 4g.40gb | 4/7 | 40 GB | 1 max |
| 7g.80gb | Full | 80 GB | 1 (whole GPU) |

**Key properties:**
| Property | Value |
|---|---|
| **Isolation** | Full hardware isolation (memory, compute, L2 cache) |
| **Error isolation** | A crash in one MIG instance does NOT affect others |
| **Supported GPUs** | A100, A30, H100 ONLY (not V100, not RTX) |
| **Configuration** | Done via GPU Operator MIG Manager (or nvidia-smi manually) |
| **K8s resource** | `nvidia.com/mig-1g.10gb`, `nvidia.com/mig-3g.40gb` etc. |

**MIG Strategies in GPU Operator:**
- `none` — MIG not used (whole GPU per workload)
- `single` — All MIG instances on a node are the same profile
- `mixed` — Different profiles on same node (more flexible)

**Best for:** Multi-tenant inference (different users get isolated GPU slices), JNaaS (each user gets a MIG slice of an H100).

---

### 3.3 vGPU (Virtual GPU)

**What it is:** NVIDIA's software virtualization layer (previously called NVIDIA GRID) that creates virtual GPUs for VMs.

**How it works:**
- A physical GPU is divided into virtual GPUs using NVIDIA's hypervisor driver
- Works with VMware vSphere, Microsoft Hyper-V, KVM
- Each VM sees a "full" GPU with its own virtual VRAM

**License types:**
| License | Use Case |
|---|---|
| **vPC (Virtual PC)** | Virtual desktops, simple graphics |
| **vApps** | Application virtualization |
| **vCS (Compute Server)** | ML/AI compute workloads in VMs |

**Key difference from MIG:**
- MIG = hardware partition, bare metal containers
- vGPU = software virtualization for **VMs** (hypervisor layer)
- In a K8s-on-bare-metal setup (your architecture) → **MIG is preferred over vGPU**
- vGPU is used when you have a VM layer (e.g., vSphere on the compute nodes)

**Licensing cost:** vGPU requires an annual NVIDIA AI Enterprise license ($$$). This is a significant cost driver.

**Best for:** Enterprises already running VMware who need to share GPUs across VMs.

---

### Comparison: Time Slicing vs MIG vs vGPU

| Feature | Time Slicing | MIG | vGPU |
|---|---|---|---|
| **Memory isolation** | ❌ No | ✅ Yes | ✅ Yes |
| **Compute isolation** | ❌ No | ✅ Yes | ✅ Yes |
| **Crash isolation** | ❌ No | ✅ Yes | ✅ Yes |
| **GPU support** | All GPUs | A100/H100 only | Most NVIDIA GPUs |
| **Works with K8s** | ✅ Yes | ✅ Yes | ✅ (complex) |
| **Works with VMs** | ❌ No | ❌ No | ✅ Yes |
| **License cost** | Free | Free | Paid ($$$) |
| **Best for** | Dev/test | Multi-tenant ML | VM-based clouds |

---

## 4. NIM — NVIDIA Inference Microservices

**What it is:** Pre-packaged, optimized Docker containers for deploying LLMs and AI models for inference on NVIDIA hardware.

**What NIMs include:**
- Optimized model weights (NVIDIA-quantized or TRT-LLM compiled)
- TensorRT-LLM inference engine
- OpenAI-compatible REST API server
- NVIDIA Triton Inference Server backend
- Health checks, metrics endpoints

**Why this matters:**
- Instead of building your own inference stack (install vLLM, convert weights, configure, test) — you pull a NIM container and it runs immediately
- The model is already optimized for your specific GPU (H100, A100, L40S)

**Example NIMs available:**
- `nvcr.io/nim/meta/llama-3.1-70b-instruct`
- `nvcr.io/nim/mistralai/mistral-7b-instruct-v0.3`
- `nvcr.io/nim/nvidia/nv-embedqa-e5-v5` (embeddings)
- `nvcr.io/nim/nvidia/reranking-ms-marco-multiling-v1` (reranking for RAG)

**License:** Requires NVIDIA AI Enterprise license OR free NGC API key (limited usage)

**Alternative to NIM for inference:**
| Tool | Notes |
|---|---|
| **vLLM** | Most popular open-source LLM server, OpenAI-compatible, free |
| **Triton Inference Server** | NVIDIA's general model server (NIM is built on top of it) |
| **TGI (Text Generation Inference)** | HuggingFace's LLM server |
| **Ollama** | Simple local inference, not for production at scale |

**Best practice:** Use vLLM for open-source models (free, fast, great K8s support). Use NIM if your client requires NVIDIA AI Enterprise support and SLAs.

---

## 5. Full NVIDIA Stack in Your Architecture

```
Application Layer (JNaaS, ModelaaS, RAG)
         |
   NIM / vLLM (Inference Serving)
         |
   KubeFlow (Training Pipelines)
         |
   KAI Scheduler (GPU-aware scheduling)
         |
   NVIDIA GPU Operator (NUOP8R)
   ├── Device Plugin (nvidia.com/gpu resources)
   ├── MIG Manager (H100 partitioning)
   ├── DCGM Exporter (GPU metrics)
   └── Driver Container (kernel module)
         |
   CUDA 12.x (GPU runtime)
         |
   H100 / A100 Bare Metal Hardware
```

---

## 6. Recommended Standard — NVIDIA GPU Strategy

| Workload Type | Recommended GPU Sharing | Why |
|---|---|---|
| **LLM Training** | Dedicated GPU (no sharing) | Needs full VRAM + full bandwidth |
| **LLM Fine-tuning** | Dedicated GPU or MIG 3g.40gb | VRAM intensive |
| **LLM Inference (large)** | Dedicated or MIG 4g.40gb | Throughput matters |
| **LLM Inference (small)** | MIG 1g.10gb or Time Slicing | Cost efficiency |
| **Jupyter Notebooks** | MIG 1g.10gb | Small workloads, max isolation |
| **Batch jobs (dev)** | Time Slicing | Cost-effective for non-critical |

**Standard GPU Node Configuration:**
- **GPU:** NVIDIA H100 SXM5 80GB (8 per node)
- **MIG Strategy:** `mixed` — mix of 1g.10gb and 7g.80gb profiles
- **GPU Operator version:** Latest stable (24.x+)
- **CUDA version:** 12.4+

---
*Next: See `03_kubernetes.md` for K8s architecture, Pods, Operators, and CRDs.*
