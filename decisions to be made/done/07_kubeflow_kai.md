# 04 — KubeFlow & KAI Scheduler (Deep Dive)

> Covers: KubeFlow components, KAI Scheduler architecture, Run.ai comparison, gang scheduling, queue management.

---

## 1. KubeFlow — ML Orchestration on K8s

**KubeFlow** is an open-source platform built on top of Kubernetes that makes it easy to develop, train, and deploy machine learning models. It's the ML layer that sits above raw K8s.

**Origin:** Originally developed by Google, open-sourced in 2017. Donated to CNCF.  
**GitHub:** github.com/kubeflow/kubeflow  
**Latest version:** 1.9.x (2024/2025)

### What KubeFlow Is NOT
KubeFlow is not a single tool — it's a **collection of components** (each independently usable). Your boss said it's used as an "orchestrator" — that's because it provides the ML workflow layer above K8s.

---

## 2. KubeFlow Components

### 2.1 KubeFlow Pipelines
**What:** Visual ML workflow/pipeline definition and execution system.  
**How it works:** You define a pipeline as a DAG (directed acyclic graph) of steps. Each step runs in a container.

```
[Data Ingestion] → [Preprocessing] → [Training] → [Evaluation] → [Deployment]
```

- Uses **Argo Workflows** under the hood for execution
- Pipelines are defined in Python using the KFP SDK
- Stores artifacts (models, datasets) in MinIO/S3

**Why it matters:** Automates the full ML training lifecycle. Teams can version and reproduce experiments.

---

### 2.2 KubeFlow Notebooks (JNaaS)
**What:** Managed Jupyter notebook environments running as Pods in K8s.  
**Direct mapping:** This is your **JNaaS (Jupyter Notebook as a Service)**.

```
User requests notebook in portal
    → Notebook CRD created
    → K8s creates a StatefulSet (1 Pod per user)
    → Pod has GPU resources (MIG 1g.10gb or full GPU)
    → User accesses via browser (Jupyter Lab interface)
```

- Each user gets an isolated namespace + persistent storage (PVC)
- Admin controls: resource quotas, GPU limits, image selection
- Supports GPU access natively via NVIDIA device plugin

---

### 2.3 KubeFlow Training Operator
**What:** Manages distributed training jobs across multiple GPU nodes.

**Supported frameworks:**
| CRD | Framework | Use Case |
|---|---|---|
| `PyTorchJob` | PyTorch | Most LLM training (most popular) |
| `TFJob` | TensorFlow | TF-based models |
| `MPIJob` | MPI + Horovod | Traditional HPC-style distributed training |
| `JAXJob` | JAX | Google TPU / JAX-based training |
| `PaddleJob` | PaddlePaddle | Baidu's framework |
| `MXNetJob` | MXNet | Amazon's framework (legacy) |

**How PyTorchJob works:**
```yaml
apiVersion: kubeflow.org/v1
kind: PyTorchJob
metadata:
  name: llama-finetune
spec:
  pytorchReplicaSpecs:
    Master:
      replicas: 1
      template:
        spec:
          containers:
          - resources:
              limits:
                nvidia.com/gpu: 8   # 8 GPUs on master node
    Worker:
      replicas: 7                    # 7 worker nodes × 8 GPUs = 56 GPUs total
      template:
        spec:
          containers:
          - resources:
              limits:
                nvidia.com/gpu: 8
```

The Training Operator creates all the Pods, sets up the distributed training environment variables (MASTER_ADDR, WORLD_SIZE, RANK), and manages retries on failure.

---

### 2.4 KServe (Model Serving)
**What:** Serverless inference serving framework — this is the **ModelaaS** component.

- Defines `InferenceService` CRD
- Supports: Triton, TGI, vLLM, sklearn, XGBoost, ONNX
- Auto-scaling (even scale to zero when no requests)
- Canary deployments (A/B testing model versions)
- Integrates with Knative Serving

```
User API call → Istio Gateway → KServe InferenceService → Model Container (vLLM/Triton)
```

---

### 2.5 Katib — Hyperparameter Tuning
**What:** Automated hyperparameter optimization and neural architecture search.
- Bayesian optimization, Random Search, Grid Search, Hyperband
- Runs dozens/hundreds of training runs with different hyperparameters
- Auto-selects best model configuration

---

## 3. KAI Scheduler — GPU-Aware Scheduling

**KAI Scheduler** is a Kubernetes scheduler extension designed specifically for GPU/AI workloads. It **replaces Run.ai** in your architecture.

**Full name:** KAI = Kubernetes AI (Scheduler)  
**Developed by:** NVIDIA (open-sourced in 2024)  
**GitHub:** github.com/NVIDIA/KAI-Scheduler

### Why a Special Scheduler?

The **default Kubernetes scheduler** (`kube-scheduler`) does NOT handle GPU workloads well:
- It assigns GPUs to Pods one at a time — a 8-GPU job might get stuck with 7 GPUs because the 8th is held by a small job
- No concept of "priority queues" for ML workloads
- No "borrow/lend" between tenant queues
- Cannot do gang scheduling (all-or-nothing assignment)

---

## 4. KAI Scheduler Key Concepts

### 4.1 Gang Scheduling (All-or-Nothing)
A distributed training job needs ALL of its Pods to run simultaneously. If you get 7/8 Pods scheduled, the job is stuck — it can never start because it's waiting for the 8th GPU.

**Gang scheduling:** Schedule ALL Pods of a job atomically, or don't schedule any of them.
```
8-GPU training job requested
    KAI checks: are there 8 GPUs available simultaneously?
    YES → schedule all 8 Pods at once → job starts
    NO  → hold job in queue, don't partially schedule
```

Without gang scheduling: Pods accumulate and waste GPU resources while waiting.

### 4.2 Queue-Based Resource Management
KAI Scheduler introduces the concept of **Queues** (like SLURM partitions in HPC):

```
Tenant A → Queue A (guaranteed: 32 GPUs, max: 64 GPUs)
Tenant B → Queue B (guaranteed: 16 GPUs, max: 64 GPUs)
Tenant C → Queue C (guaranteed: 16 GPUs, max: 64 GPUs)

Total: 64 GPUs physical
```

- **Guaranteed quota:** Tenant always gets at least this many GPUs
- **Borrowing:** If Tenant A is idle, Tenant B can borrow A's GPUs
- **Preemption:** When A submits a job, B's borrowed resources are reclaimed

### 4.3 Bin Packing vs. Spreading
- **Bin packing:** Put as many workloads as possible on as few nodes as possible (maximizes utilization)
- **Spreading:** Spread workloads across many nodes (maximizes availability)

KAI Scheduler supports both strategies and can switch per queue/workload type.

### 4.4 Priority Classes
```
Priority: Critical (infrastructure) > High (production training) > Normal (dev) > Low (batch)
```
High-priority jobs can preempt lower-priority jobs when resources are needed.

### 4.5 Topology-Aware Scheduling
KAI is aware of GPU topology — it tries to schedule multi-GPU jobs on:
1. GPUs within the same node (NVLink connected) — best
2. Nodes within the same rack (shortest IB hop) — second best
3. Nodes across racks — last resort

This minimizes training communication overhead.

---

## 5. Run.ai vs KAI Scheduler

| Feature | Run.ai | KAI Scheduler |
|---|---|---|
| **Type** | Commercial (SaaS + on-prem) | Open source (Apache 2.0) |
| **Cost** | $$$$ per GPU/year licensing | Free |
| **Gang scheduling** | ✅ Yes | ✅ Yes |
| **Queue management** | ✅ Yes | ✅ Yes |
| **GPU sharing** | ✅ Yes (proprietary) | ✅ Yes (via GPU Operator) |
| **Preemption** | ✅ Yes | ✅ Yes |
| **Topology-aware** | ✅ Yes | ✅ Yes |
| **NVIDIA-native** | ❌ No | ✅ Yes (by NVIDIA) |
| **UI / Dashboard** | ✅ Rich UI | ⚠️ Basic (use Grafana) |
| **Support** | Commercial SLA | Community / NVIDIA |
| **K8s integration** | Custom scheduler | Native K8s scheduler plugin |

**Why KAI replaces Run.ai:**
1. **Cost** — Run.ai licensing per GPU is expensive at scale (e.g., 512 GPUs × $X/year)
2. **Vendor lock-in** — Run.ai is a proprietary commercial product
3. **NVIDIA ownership** — KAI is developed by NVIDIA, deeply integrated with GPU Operator and MIG
4. **Open source** — Community-driven, auditable, customizable

---

## 6. SLURM vs K8s vs KubeFlow — The Full Picture

Many HPC teams coming from traditional HPC are familiar with SLURM. Here's how they compare:

| Concept | SLURM (HPC) | Kubernetes (Cloud) | KubeFlow/KAI |
|---|---|---|---|
| **Job submission** | `sbatch job.sh` | `kubectl apply -f job.yaml` | KFP pipeline / `kubectl apply PyTorchJob` |
| **Queue** | Partition | Namespace + Queue | KAI Queue |
| **Node selection** | `--gres=gpu:8` | `nvidia.com/gpu: 8` | Resource request |
| **Gang scheduling** | Native | KAI Scheduler | KAI Scheduler |
| **Job dependencies** | `--dependency` | Argo Workflows | KFP Pipelines |
| **Interactive** | `srun --pty bash` | `kubectl exec -it` | KubeFlow Notebooks |
| **Monitoring** | `squeue`, `sacct` | Prometheus + Grafana | KFP UI |

**Slinky bridges SLURM and K8s** — see `05_bare_metal_provisioning.md` for details.

---

## 7. Recommended Standard — KubeFlow + KAI Setup

```
KubeFlow Components to Deploy:
├── KubeFlow Pipelines (Argo backend)    ← ML workflow automation
├── KubeFlow Notebooks                   ← JNaaS
├── Training Operator                    ← PyTorchJob, MPIJob for distributed training
├── KServe                               ← ModelaaS serving
└── Katib                                ← Hyperparameter tuning

KAI Scheduler:
├── Queues per tenant (guaranteed + max quota)
├── Gang scheduling enabled for all multi-GPU jobs
├── Topology-aware placement (same-node → same-rack → cross-rack)
├── Priority classes: critical > high > normal > low
└── Integration with NVIDIA GPU Operator for MIG-aware scheduling
```

**Additional tools alongside KubeFlow:**
| Tool | Purpose |
|---|---|
| **MLflow** | Experiment tracking, model registry (works WITH KubeFlow) |
| **DVC** | Data version control for datasets |
| **Prometheus + Grafana** | Metrics (GPU utilization, queue depth, job duration) |
| **Argo CD** | GitOps deployment of KubeFlow itself |

---

## Decisions to be Made for Reference Architecture
### 1. Primary ML Orchestrator
Tenants need a way to build ML pipelines, run distributed training, and launch notebooks.
*   **Decision:** Confirm the adoption of the **KubeFlow suite** (Pipelines, Notebooks, Training Operator, Katib). This open-source standard provides everything needed without relying on proprietary SaaS platforms.

### 2. GPU Scheduler Selection (KAI vs Run.ai)
Default Kubernetes is terrible at scheduling GPU jobs (no gang scheduling, no queues).
*   **Decision:** Confirm the replacement of Run.ai with **NVIDIA's KAI Scheduler**. KAI gives you the same capabilities (gang scheduling, priority queues, topology-awareness) but is free and native to the NVIDIA ecosystem, saving massive per-GPU licensing costs.

### 3. Tenant Queue Configuration (Resource Allocation)
You must define how the 64 GPUs are carved up mathematically among the 110 tenants.
*   **Decision:** Define the queue policies for the KAI Scheduler. You will need to formalize the **Guaranteed Quota** vs **Maximum Quota (Bursting)** for each tenant tier. For example: Do shared pool tenants get a guaranteed 2 GPUs with the ability to burst to 8 if the cluster is idle?

---
*Next: See `05_bare_metal_provisioning.md` for Metal3, Slinky, BCM, and VMetal.*
