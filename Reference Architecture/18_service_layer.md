# 18_service_layer.md - Service Layer (Deep Dive)

> Covers: JNaaS, ModelaaS, MLOps, GPU PaaS — what each service is, how it works, the tools behind it, and alternatives.

---

## 1. Service Layer Overview

The service layer is what **tenants directly interact with**. It abstracts all the complexity of K8s, GPU Operator, networking, and storage. Tenants don't care about Pods or MIG — they care about:

- "I want a Jupyter notebook with 2 GPUs"
- "I want to serve my LLM as an API"
- "I want to run an ML training pipeline"

```
Tenant Facing Interface (SSP Portal / API)
     ↓
┌─────────────────────────────────────────────────┐
│  SERVICE LAYER                                  │
│  JNaaS  │  ModelaaS  │  MLOps  │  GPU PaaS     │
└─────────────────────────────────────────────────┘
     ↓                (powered by)
KubeFlow + KServe + KAI Scheduler + GPU Operator
     ↓
K8s on Bare Metal GPU Infrastructure
```

---

## 2. JNaaS — Jupyter Notebook as a Service

### What Is It?
A managed, GPU-accelerated Jupyter Notebook environment where each user gets their own isolated notebook server.

**Direct analogy:** Google Colab or Kaggle Notebooks, but on YOUR hardware, with YOUR GPU allocation, in YOUR isolated environment.

### Technology Stack
```
User opens browser → SSP Portal
    ↓ requests notebook (selects GPU: 1 × H100 MIG 1g.10gb, image: pytorch:24.01)
Rafay SSP API → creates KubeFlow Notebook CRD
    ↓
KubeFlow Notebook Controller → creates StatefulSet (1 Pod)
    ↓
KAI Scheduler → assigns GPU (1g.10gb MIG slice on node-03)
    ↓
Pod starts: JupyterLab UI accessible at https://nb.platform.com/user/alice
    ↓
User works in notebook → PVC stores workspace persistently
```

### Under the Hood — KubeFlow Notebook CRD
```yaml
apiVersion: kubeflow.org/v1
kind: Notebook
metadata:
  name: alice-notebook
  namespace: tenant-alice
spec:
  template:
    spec:
      containers:

      - name: notebook
        image: nvcr.io/nvidia/pytorch:24.01-py3
        resources:
          limits:
            nvidia.com/mig-1g.10gb: 1    # 1 MIG slice
            memory: "16Gi"
            cpu: "4"
        volumeMounts:

        - name: workspace
          mountPath: /home/jovyan/work
      volumes:

      - name: workspace
        persistentVolumeClaim:
          claimName: alice-workspace-pvc   # 200GB NVMe PVC
```

### Notebook Images (Environments)
Tenants select from pre-built images:
| Image | Contains | Use Case |
|---|---|---|
| `pytorch:24.01-py3` | PyTorch, CUDA 12.3, Python 3.11 | ML training |
| `tensorflow:24.01-tf2` | TensorFlow 2.15, CUDA 12.3 | TF-based work |
| `rapids:24.01-cuda12` | NVIDIA RAPIDS (GPU-accelerated pandas/sklearn) | Data science |
| `nvcr.io/nim/...` | NIM containers for inference | LLM serving |
| Custom images | Build your own | Specialized needs |

### JupyterHub vs KubeFlow Notebooks
| Feature | JupyterHub | KubeFlow Notebooks |
|---|---|---|
| **K8s native** | ✅ (via KubeSpawner) | ✅ Native CRD |
| **Resource management** | Via K8s quotas | Via K8s quotas + KAI |
| **GPU support** | ✅ | ✅ |
| **MLflow integration** | Manual | Built-in (KubeFlow) |
| **KFP Pipelines access** | Manual | Native |
| **Complexity** | Lower | Higher |

**Your architecture uses KubeFlow Notebooks** — better integration with the rest of the KubeFlow ecosystem (Pipelines, Training Operator, Katib).

---

## 3. ModelaaS — Model as a Service

### What Is It?
An API service where tenants can deploy their trained models (or use pre-packaged models) and expose them as HTTP/gRPC endpoints. Clients call the endpoint to get predictions/generations.

**Analogy:** OpenAI API, but on your own infrastructure. You send a request, the LLM processes it, you get a response.

### Use Cases
- **LLM inference API** — tenants deploy a fine-tuned LLaMA/Mistral model and expose an OpenAI-compatible API
- **Batch inference** — process thousands of documents asynchronously
- **Embedding service** — generate vector embeddings for RAG pipelines
- **Custom model serving** — sklearn, XGBoost, ONNX models via REST API

### Technology Stack — KServe

**KServe** (formerly KFServing) is the primary model serving framework in your stack.

```
Tenant uploads model → MinIO (model registry)
    ↓ defines InferenceService CRD
KServe controller → creates serving infrastructure
    ↓
Predictor Pod: vLLM / Triton / sklearn runtime
    ↓ autoscales based on request rate
Istio Gateway → routes external traffic
    ↓
Users/apps call: POST https://api.platform.com/v1/chat/completions
```

### KServe InferenceService Example
```yaml
apiVersion: serving.kserve.io/v1beta1
kind: InferenceService
metadata:
  name: llama-3-70b
  namespace: tenant-productionai
spec:
  predictor:
    model:
      modelFormat:
        name: vllm
      storageUri: s3://models/llama-3-70b-instruct
      resources:
        limits:
          nvidia.com/gpu: 4          # 4 GPUs for this model
          memory: "320Gi"
    minReplicas: 1
    maxReplicas: 4                   # auto-scale up to 4 replicas
    scaleTarget: 50                  # scale when avg queue > 50 requests
```

### Inference Engines — vLLM vs Triton vs NIM

| Engine | Best For | Notes |
|---|---|---|
| **vLLM** | LLMs (generative AI) | PagedAttention, continuous batching, OpenAI API compatible, very fast |
| **NVIDIA Triton** | All model types (CV, NLP, ML) | Multi-framework, dynamic batching, gRPC + REST |
| **NIM** | NVIDIA-certified LLMs | Pre-optimized containers, TRT-LLM backend |
| **TGI (HuggingFace)** | LLMs | Good alternative to vLLM |
| **TorchServe** | PyTorch models | Simple, not LLM-optimized |

**Standard choice for LLM inference:** **vLLM** — it's the fastest open-source LLM serving framework.

### vLLM Key Features
- **PagedAttention:** Novel GPU memory management — KV cache paged like OS virtual memory → 20x more requests served vs naive implementation
- **Continuous batching:** Dynamically adds new requests to in-progress batches → maximizes GPU utilization
- **OpenAI compatible:** Same API format as OpenAI → drop-in replacement for clients
- **Multi-GPU:** Tensor parallelism across multiple GPUs for large models
- **AWQ/GPTQ quantization:** Serve large models with less VRAM

---

## 4. MLOps — Machine Learning Operations

### What Is MLOps?
**MLOps** is the practice of applying DevOps principles to machine learning — automating the full ML lifecycle from data to deployed model.

**Components of MLOps:**
```
Data Management → Training → Experiment Tracking → Model Registry → Deployment → Monitoring
```

### MLOps Tools in Your Stack

#### MLflow — Experiment Tracking + Model Registry
**The most widely adopted open-source MLOps tool.**

```
Training job runs:

    - Logs metrics (loss, accuracy) → MLflow Tracking Server
    - Logs parameters (learning_rate, batch_size) → MLflow
    - Logs model artifacts → MinIO (via MLflow artifact store)
    - Registers model version → MLflow Model Registry
    ↓
Best model promoted: "Staging" → "Production"
    ↓
KServe deploys from model registry: storageUri: s3://mlflow-artifacts/models/llama-v2/3
```

**MLflow components:**
| Component | Purpose |
|---|---|
| **Tracking Server** | Logs metrics, parameters, tags, artifacts per run |
| **Model Registry** | Versions models, tracks stage (Staging/Production) |
| **Projects** | Reproducible ML code packages |
| **Models** | Standardized model format for deployment |

#### KubeFlow Pipelines — Workflow Automation
End-to-end ML pipeline automation:
```
Pipeline: 
  Data collection → Data cleaning → Feature engineering 
  → Training (PyTorchJob) → Evaluation → Registration (MLflow) 
  → Deployment (KServe) → A/B test → Promote
```

Each step is a container. Steps are versioned, cached, and re-run only when inputs change.

#### DVC — Data Version Control
- Git-like versioning for large datasets
- Works with MinIO/S3 for actual data storage
- Tracks data lineage: which dataset version produced which model?

#### Prometheus + Grafana — ML Monitoring
Monitor production models:

- Request latency and throughput
- GPU utilization during inference
- Model prediction drift (via custom metrics)
- DCGM metrics (GPU health)

---

## 5. GPU PaaS — GPU Platform as a Service

### What Is It?
**GPU PaaS** is the most basic offering — tenants get raw GPU compute access via the K8s API. No pre-installed ML tools, just bare GPU resources. Power users who want to bring their own stack.

### How It Works
```
Tenant gets:

- Namespace with GPU quota (e.g., 8 GPUs)
- kubeconfig (namespace-scoped)
- StorageClass for PVCs
- Direct GPU access (nvidia.com/gpu resource)
```

Tenant brings their own:

- Container images
- Workload definitions (Jobs, Deployments)
- ML framework, inference server, etc.

### Use Cases
- Custom research frameworks not in the standard stack
- Legacy HPC workloads containerized
- Niche ML frameworks (Julia-based, custom CUDA)
- Container-based HPC (MPI jobs via MPIJob CRD)

---

## 6. SSP — Self-Service Portal

### What Is the SSP?
The **Self-Service Portal** is the web UI that tenants use to access all services. It abstracts the K8s complexity into simple forms and dashboards.

**Capabilities:**
```
Dashboard:
├── My Resources (GPU usage, storage usage)
├── My Notebooks (start/stop/resize Jupyter)
├── My Models (deployed inference services)
├── My Jobs (training pipeline status)
├── My vCluster (access to vCluster kubeconfig)
└── Billing / Quota (usage tracking)
```

**Technology options for SSP:**
| Option | Notes |
|---|---|
| **Rafay SSP (built-in)** | Native Rafay self-service, deepest integration |
| **KubeFlow Central Dashboard** | KubeFlow's own UI for notebooks, pipelines |
| **Custom portal (React + Rafay API)** | Full customization, brand it yourself |
| **Backstage (Spotify)** | Developer portal framework, highly customizable |

**Standard recommendation:** Use **KubeFlow's central dashboard** for ML-specific functions + **Rafay's SSP** for cluster/vCluster provisioning. Optionally wrap both with a custom-branded portal via APIs.

---

## 7. Full Service Layer Architecture

```
TENANT (browser / CLI / API)
    ↓
SSP Portal (Rafay + KubeFlow Dashboard)
    ↓
┌──────────────────────────────────────────────────────────┐
│  JNaaS              ModelaaS         MLOps       GPU PaaS │
│  KubeFlow           KServe +         MLflow +    Raw K8s  │
│  Notebooks          vLLM/NIM         KFP         + GPU    │
└──────────────────────────────────────────────────────────┘
    ↓
KAI Scheduler (GPU-aware, queue-based)
    ↓
NVIDIA GPU Operator (driver, device plugin, MIG)
    ↓
Bare Metal GPU Nodes (H100 × N)
```

---

## 8. Standard Recommendation — Service Layer

| Service | Tool | Why |
|---|---|---|
| **JNaaS** | KubeFlow Notebooks + JupyterLab | K8s-native, KFP integration, GPU-aware |
| **ModelaaS** | KServe + vLLM | Best LLM inference, auto-scaling, OpenAI-compatible |
| **MLOps** | KubeFlow Pipelines + MLflow + DVC | Full lifecycle, open source, vendor-neutral |
| **Experiment Tracking** | MLflow | Most widely adopted, easy, integrates everywhere |
| **Model Registry** | MLflow Registry + MinIO | Simple, reliable, S3-backed |
| **GPU PaaS** | Native K8s + KAI Queues | Raw access for power users |
| **SSP** | Rafay SSP + KubeFlow Dashboard | Best integration with your full stack |
| **Monitoring** | Prometheus + Grafana + DCGM | GPU metrics + application metrics unified |

---

## Final Architecture Decisions

### 1. JNaaS (Jupyter Notebook as a Service) Engine
**Decision:** Adopted **KubeFlow Notebooks** as the JNaaS backend. This leverages native Kubernetes CRDs and integrates cleanly with the KAI Scheduler for GPU allocation.

### 2. ModelaaS Inference Engine
**Decision:** Adopted **vLLM** as the default inference backend integrated with KServe. It provides the fastest open-source performance, PagedAttention, and an OpenAI-compatible API.

### 3. MLOps Registry
**Decision:** Adopted **MLflow** for experiment tracking and model versioning, using the MinIO (Cold Storage) tier as the artifact backend.

### 4. Tenant Frontend (SSP)
**Decision:** We will use the built-in **KubeFlow Central Dashboard** for ML-specific functions combined with **Rafay\'s SSP** for cluster/vCluster provisioning. This provides the best integration without requiring custom development upfront.
