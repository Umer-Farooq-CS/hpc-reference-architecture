# Kubernetes Platform Layer

> Part of the [Chosen Architecture](index.md) specification.

---

## 1. Kubernetes Distribution Selection
**Decision:** **RKE2 (Rancher Kubernetes Engine 2)**.

*   **Rationale:** RKE2 is a highly secure, FIPS and CIS Benchmark-hardened Kubernetes distribution ideal for bare metal deployments. It supports embedded etcd out of the box and is fully supported by downstream platforms like Rafay. It avoids the heavy operational burden of manual `kubeadm` setups while avoiding vendor lock-in associated with platforms like OpenShift or Tanzu. Containerd is used as the default container runtime.

## 2. GPU Integration & Lifecycle
**Decision:** **NVIDIA GPU Operator**.

*   **Rationale:** The NVIDIA GPU Operator automates the lifecycle of all software components needed to provision GPUs on Kubernetes. It eliminates the need to manually install NVIDIA drivers, container runtimes, device plugins, and DCGM monitoring tools on every bare metal node. It also manages dynamic MIG (Multi-Instance GPU) profiles via `mig-parted`, enabling declarative GPU slicing.

## 3. Storage Integration Mapping (StorageClasses)
**Decision:** Kubernetes native `StorageClass` objects mapped directly to the underlying physical storage tiers using CSI (Container Storage Interface) drivers and operators.

*   **Mapping:**
    *   `hot-nvme` ➜ **WEKA CSI Driver**: For high-performance, sub-100us latency workloads (e.g., RAG vector databases, active training datasets).
    *   `cold-s3` ➜ **MinIO Operator**: For S3-compatible object storage (e.g., model weights, checkpoints, document archives).
    *   `block-rbd` ➜ **Rook-Ceph Operator**: For resilient block storage (e.g., K8s PVCs, stateful database pods, user home directories).
*   **Rationale:** This mapping abstracts the underlying hardware complexity. Tenants simply request a generic PVC from a standard `StorageClass`, and Kubernetes automatically provisions the volume on the correct hardware tier.

## 4. Worker Node Operational Components
The following components run on every GPU Worker Node and are managed by the Rafay Blueprint:

| Component | Role |
|---|---|
| **containerd** | Default container runtime for RKE2. Low-overhead, OCI-compliant. |
| **Node Feature Discovery (NFD)** | Automatically labels each node with its hardware capabilities (GPU model, IB port presence, NUMA topology). Allows KAI Scheduler to make topology-aware scheduling decisions. |
| **DCGM Exporter** | NVIDIA Data Center GPU Manager. Exports per-GPU metrics (utilization, temperature, memory bandwidth, NVLink throughput) to Prometheus for Grafana dashboards. |
| **MetalLB** | Bare-metal load balancer. Assigns real IP addresses (from a configured pool) to Kubernetes `LoadBalancer` type Services. Used to expose the SSP portal, KubeFlow UI, and KServe inference endpoints externally. |
| **cert-manager** | Automates TLS certificate issuance and renewal for all platform endpoints using Let's Encrypt or an internal CA. |

---
*Back to [Chosen Architecture Index](index.md)*
