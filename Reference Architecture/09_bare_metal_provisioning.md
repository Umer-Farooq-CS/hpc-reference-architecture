# Bare Metal Provisioning & HPC Management

> Part of the [Chosen Architecture](index.md) specification.

---

## Bare Metal Provisioning Architecture

To automate the discovery and provisioning of the 64-GPU physical cluster, the platform utilizes the **Metal3** stack natively within Kubernetes. The architecture operates entirely on **bare metal**, removing the need for a hypervisor (such as VMware Cloud Foundation) while treating physical infrastructure as code.

### 1. The Core Provisioning Engine: Metal3 and Cluster API
*   **Technology:** Metal3, OpenStack Ironic, and Cluster API (CAPI).
*   **Architecture Choice:** Cloud-Native Bare Metal (No Hypervisor).
*   **Rationale:**
    *   **Maximum Performance (Zero Overhead):** In a high-performance computing (HPC) and AI training environment, any virtualization layer introduces latency and CPU/PCIe overhead. Direct bare-metal installation ensures 100% of the hardware (GPUs, CPUs, RAM, and InfiniBand fabric) is dedicated to workloads.
    *   **GitOps Driven (IaC):** Hardware management becomes declarative. When a new node is plugged in, `ironic-inspector` automatically creates a `BareMetalHost` CRD in Kubernetes. A platform engineer simply commits a YAML manifest to link this host to a Cluster API machine. Ironic then powers on the server via IPMI/Redfish, PXE boots it, installs a minimal Ubuntu OS via `cloud-init`, and joins it to the Kubernetes cluster automatically.
    *   **Self-Healing:** Cluster API `MachineHealthCheck` detects unresponsive hardware and can automatically instruct Metal3 to power-cycle or re-image a failed node.

### 2. SLURM & Legacy HPC Compatibility
*   **Technology:** Slinky (SLURM on Kubernetes).
*   **Rationale:** To provide a seamless experience for legacy HPC data scientists used to submitting jobs via `sbatch`, we deploy **Slinky**. Slinky operates as a compatibility layer inside Kubernetes, intercepting SLURM commands and translating them into Kubernetes Pods. This completely eliminates the need for a legacy standalone SLURM controller on bare metal.

### 3. The Visibility Stack
*   **Technology:** Metal3 CRDs + Prometheus + Grafana + DCGM Exporter.
*   **Rationale:** The observability stack operates in **two complementary layers**:

| Layer | Tool | What It Monitors |
|---|---|---|
| **Hardware Layer** | Metal3 `BareMetalHost` CRDs + IPMI Exporters | Physical server health, power states, BMC alerts, hardware provisioning status |
| **Kubernetes Layer** | Prometheus + Grafana + DCGM Exporter | Pod-level GPU utilization, MIG slice occupancy, namespace quotas, PVC usage, kube-apiserver latency, etcd health, KAI queue depth |
| **Workload Layer** | Prometheus + Grafana (same stack) | Training job throughput, WEKA filesystem IOPS, MinIO request rates, Ceph OSD health, NCCL bandwidth |

Both layers run simultaneously and are aggregated into a single Prometheus/Grafana instance. Metal3 and IPMI exporters monitor the physical hardware via the Out-of-Band 1GbE management network. Prometheus scrapes Kubernetes and workload metrics via the 100GbE Ethernet fabric.

---

*Back to [Chosen Architecture Index](index.md)*
