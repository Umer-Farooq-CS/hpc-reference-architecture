# ML Platform & GPU Scheduling

> Part of the [Chosen Architecture](index.md) specification.

---

## 1. Primary ML Orchestrator
**Decision:** **KubeFlow Suite**.

*   **Components Included:** KubeFlow Pipelines (for ML workflows via Argo), KubeFlow Notebooks (for Jupyter Notebook as a Service - JNaaS), Training Operator (for distributed PyTorch/MPI jobs), KServe (for ModelaaS inference serving), and Katib (for hyperparameter tuning).
*   **Rationale:** The open-source KubeFlow suite provides a complete, cloud-native ML platform without relying on proprietary SaaS platforms. It integrates natively with Kubernetes CRDs and operators to manage the entire ML lifecycle from exploration to training and serving.
*   **Deployment:** Installed automatically via Rafay Blueprint (ArgoCD GitOps) on all cluster types.

| Component | Role |
|---|---|
| **KubeFlow Pipelines** | DAG-based ML workflow automation (backed by Argo Workflows). Stores artifacts in MinIO `cold-s3` tier. |
| **KubeFlow Notebooks** | Managed JupyterLab Pods per user. Each notebook gets an isolated namespace, PVC, and GPU allocation. |
| **Training Operator** | CRD controller for `PyTorchJob`, `MPIJob`, `TFJob`. Manages multi-node distributed training across GPU worker nodes. |
| **KServe** | Serverless model inference (`InferenceService` CRD). Supports vLLM, Triton, ONNX. Auto-scales to zero. |
| **Katib** | Automated hyperparameter tuning. Runs parallel training trials with different configs, selects the best model. |

## 2. GPU Scheduler Selection
**Decision:** **NVIDIA KAI Scheduler** (Kubernetes AI Scheduler).

*   **Rationale:** The default Kubernetes scheduler is insufficient for distributed GPU workloads. The NVIDIA KAI Scheduler replaces proprietary alternatives (like Run.ai) by providing native, open-source advanced scheduling capabilities:
    *   **Gang Scheduling:** Ensures distributed training jobs receive all requested GPUs simultaneously, preventing deadlocks and wasted resources.
    *   **Priority Queues:** Enables queue-based resource management with guaranteed and burst quotas per tenant tier.
    *   **Topology-Awareness:** Optimizes GPU placement (same-node vs same-rack vs cross-rack) to minimize InfiniBand communication overhead.
    *   **Cost-Effectiveness:** It is free, open-source, and natively integrated with the NVIDIA ecosystem, saving massive per-GPU licensing fees.

!!! note "Note on Tenant Quotas"
    The specific mathematical allocation of GPU quotas (Guaranteed vs Maximum Burst) across the 110 tenants will be defined as part of the Tenant Models and Service Layer architecture.

---
*Back to [Chosen Architecture Index](index.md)*
