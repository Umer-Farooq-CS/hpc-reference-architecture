# HPC / GPU Cloud Platform — Learning Context
> **Role:** HPC Engineer | Rafay Learner | Kubernetes (K8s) Learner  
> **Source:** Boss's reference architecture explanation (whiteboard/notebook notes + diagrams)  
> **Purpose:** Master index + base context. Read deep-dive docs for full detail on each topic.

## Document Index

| # | File | What It Covers |
|---|---|---|
| 0 | context.md (this file) | Master index + glossary + open questions |
| 1 | [01_hardware_networking.md](01_hardware_networking.md) | Servers, InfiniBand, RDMA, Spine-Leaf, NICs, NS/EW |
| 2 | [02_nvidia_gpu.md](02_nvidia_gpu.md) | CUDA, GPU Operator, MIG, Time Slicing, vGPU, NIM |
| 3 | [03_storage.md](03_storage.md) | Hot/Cold/Block tiers, WEKA, Ceph, MinIO, etcd sizing |
| 4 | [04_bare_metal_provisioning.md](04_bare_metal_provisioning.md) | Metal3, Slinky, BCM, VMetal, Ironic |
| 5 | [05_network_software.md](05_network_software.md) | SONIC, EDA, Linux networking, SR-IOV |
| 6 | [06_kubernetes.md](06_kubernetes.md) | K8s architecture, Pods, Operators, CRDs, etcd, RBAC |
| 6a | [06a_control_plane.md](06a_control_plane.md) | Control plane HA topologies, etcd quorum math, API load balancing, hardware sizing, K8s distributions |
| 7 | [07_kubeflow_kai.md](07_kubeflow_kai.md) | KubeFlow components, KAI Scheduler, Run.ai comparison |
| 8 | [08_rafay.md](08_rafay.md) | Rafay Controller/Agent, GitOps, RBAC, vClusters |
| 9 | [09_tenant_models.md](09_tenant_models.md) | Shared clusters, vClusters, Bare metal clusters |
| 10 | [10_service_layer.md](10_service_layer.md) | JNaaS, ModelaaS, MLOps, GPU PaaS, vLLM, KServe |
| 11 | [11_standard_architecture.md](11_standard_architecture.md) | **Full recommended standard architecture** |

---

## 1. Big Picture — What Are We Building?

A **multi-tenant GPU cloud platform** designed to:
- Run LLMs and AI/ML workloads on bare-metal GPU hardware
- Provide GPU-as-a-Service to multiple tenants (teams, clients, organizations)
- Abstract physical hardware complexity behind an orchestration and management layer
- Be fully managed end-to-end by **Rafay** (the platform/control plane provider)

The whole stack — from bare metal up to tenant self-service — is what the team is responsible for designing, sizing, and delivering as a **Reference Architecture (RA)**.

---

## 2. Full Architecture Stack (Bottom to Top)

```
+------------------------------------------------------+
|           MANAGEMENT LAYER (RBAC)                    |  <- Role-Based Access Control for tenants
+------------------------------------------------------+
|           SERVICE LAYER: SSP / JNPaaS                |  <- Self-Service Portal / Jupyter Notebook PaaS
+------------------------------------------------------+
|  ORCHESTRATION: K8s + KubeFlow + KAI Scheduler       |  <- Workload scheduling & ML pipelines
+------------------------------------------------------+
|  NETWORK LAYER: SONIC (EDA) + LINUX                  |  <- Programmable switch OS + Linux networking
+------------------------------------------------------+
|  HARDWARE LAYER: Bare Metal (Lenovo / HP / Dell)     |  <- Physical GPU servers in racks
+------------------------------------------------------+
         ALL OF THIS IS MANAGED BY RAFAY
```

---

## 3. Hardware Layer & Networking

### 3.1 Physical Infrastructure
- **Servers:** Bare metal GPU servers from **Lenovo**, **HP**, and **Dell** — housed in racks
- **Network Topology:** Spine-leaf architecture
  - **Top:** Multiple Racks / Servers / Nodes
  - **Connections:** All-to-all cross-links between servers and spine switches
  - **Bottom:** Multiple Spine Switches forming the switch fabric

### 3.2 Network Protocols
| Protocol | Purpose |
|---|---|
| **InfiniBand** | Ultra-low latency, high-bandwidth GPU-to-GPU communication (RDMA) — used for AI training |
| **Ethernet** | Standard control plane and management traffic (North-South / East-West) |

### 3.3 NIC Structure
- **6 NICs per Node** — multiple network interface cards per server
- **NS/EW Traffic:** North-South (client <-> datacenter) and East-West (server <-> server) traffic are separated

### 3.4 RDMA
- **RDMA (Remote Direct Memory Access)** is used for GPU cluster interconnects
- Allows GPUs on different servers to communicate at near-memory speeds, bypassing CPU overhead
- Critical for distributed training workloads (e.g., large LLM training)
- Aligned with **NVIDIA Reference Architecture**

### 3.5 Drawing / Topology Mapping Tools
| Tool | Purpose |
|---|---|
| **Miro (MIRA/MIRO)** | Online whiteboard for topology diagrams — designated as 1st Task |
| **Draw.io** | Free diagramming tool for network/architecture diagrams |

---

## 4. GPU Virtualization & Slicing (NVIDIA)

Node ID format: `B1-G1-A`
- **B** = Bare Metal node identifier
- **G** = GPU number on that node
- **A** = Slice of that GPU

### 4.1 GPU Sharing Techniques (NVIDIA)
| Technique | Description |
|---|---|
| **Time Slicing** | GPUs shared by switching between workloads over time. Simple but no memory isolation. |
| **MIG (Multi-Instance GPU)** | Hardware-level GPU partitioning into isolated instances. Supported on A100/H100. |
| **vGPU (Virtual GPU)** | Software virtualization layer (NVIDIA GRID). Enables GPU sharing for VMs. Has licensing costs. |
| **NIM (NVIDIA Inference Microservices)** | Pre-built containers for deploying AI inference (LLMs etc.) on NVIDIA hardware |

### 4.2 LLMs on Hardware
- **LLMs** are hosted and executed directly on this bare metal GPU layer
- LLM visibility and bare metal provisioning use: **Slinky, Metal3, VMetal, BCM**

---

## 5. Orchestration Layer

### 5.1 Core Orchestration Stack
| Component | Role |
|---|---|
| **CUDA** | NVIDIA GPU programming API — the foundation for GPU compute |
| **Kubernetes (K8s)** | Container orchestration — manages Pods, scheduling, resources |
| **NVIDIA GPU Operator (NUOP8R)** | Kubernetes Operator that auto-installs all NVIDIA software (drivers, device plugin, DCGM, MIG manager) on GPU nodes |
| **KAI Scheduler** | GPU-aware Kubernetes scheduler — **replaces Run.ai** |
| **KubeFlow** | Open-source ML platform on top of K8s — primary orchestrator for ML workloads |

### 5.2 How Workloads Are Scheduled
```
Pod -> vCPU allocation
    -> RAM allocation
    -> GPU allocation
    -> Scheduled by KAI Scheduler
```

### 5.3 Why KAI Scheduler Replaces Run.ai
- **Run.ai** was previously the dominant GPU scheduling platform for K8s
- **KAI Scheduler** is a newer open-source alternative
- Provides gang scheduling, preemption, queue management for GPU workloads
- Avoids Run.ai licensing costs

---

## 6. Bare Metal Provisioning Tools
| Tool | Description |
|---|---|
| **Slinky** | SLURM + K8s integration for HPC job scheduling |
| **Metal3** | Kubernetes-native bare metal provisioning (uses Ironic) |
| **VMetal** | Virtual/bare metal abstraction layer |
| **BCM** | Bare metal cluster manager (e.g., Bright Cluster Manager) |

---

## 7. Service Layer (What Tenants Get)
| Service | Full Name | Description |
|---|---|---|
| **JNaaS** | Jupyter Notebook as a Service | Managed Jupyter environments on GPU |
| **ModelaaS** | Model as a Service | Pre-trained models served via API |
| **MLOps** | ML Operations | Pipeline automation, versioning, monitoring |
| **GPU PaaS** | GPU Platform as a Service | Raw GPU compute access via the platform |
| **SSP / JNPaaS** | Self-Service Portal | Front-end for tenants to request resources |

---

## 8. Network Software Layer
| Technology | Description |
|---|---|
| **SONIC** | Software for Open Networking in the Cloud — open-source NOS for whitebox switches |
| **EDA** | Event-Driven Automation — for network programmability |
| **LINUX** | Linux-based network stack on switches/servers |

---

## 9. Rafay — The Management Platform

Rafay manages the ENTIRE stack from network/hardware through the management layer.

### 9.1 Rafay Architecture
```
+-------------------------+
|     Rafay Controller    |  <- Central control plane
+----------+--------------+
           | manages/pushes config
           v
+-------------------------+
|      Rafay Agents       |  <- Deployed on target clusters
+----------+--------------+
           | deployed on
           v
+-------------------------+
|   Bare Metal / Cloud    |  <- Physical servers or cloud VMs
+-------------------------+
```

### 9.2 What Rafay Provides
- **RBAC** at the management layer
- Multi-cluster management
- GitOps-based deployment workflows
- Tenant isolation and cluster lifecycle management
- SSP (Self-Service Portal) for JNPaaS workloads

---

## 10. Tenant Request Models (3 Types)

### Type 1: Normal Shared Provisioning Clusters
- **Model:** Shared, multi-tenant cluster
- **How it works:** You submit a workload -> it runs on shared cluster resources
- **Analogy:** Submitting a job to a shared HPC queue (like SLURM)

### Type 2: vClusters (Virtual Clusters)
- **Model:** Dedicated virtual Kubernetes cluster within a physical cluster
- **Stack provisioned:**
  - K8s, CRD NOPs, KubeFlow, EDA, VRL
- **Who gets this:** Teams needing K8s-level isolation without dedicated hardware
- **Tool:** vcluster (by Loft Labs)

### Type 3: (Hard) Bare Metal Clusters
- **Model:** Dedicated physical bare metal nodes
- **How it works:** You request dedicated nodes -> you get the physical machines
- **Who gets this:** Tenants needing maximum performance and full hardware isolation

---

## 11. RFP Sizing & Storage Architecture

### 11.1 RFP Process
- Determine if hardware is sufficient for stated requirements
- Define the resource division strategy
- Example: **110 Tenants**, **64 GPUs**, **1 PB Storage**

### 11.2 Storage Tiers
| Tier | Type | Used For |
|---|---|---|
| **Hot Storage** | NVMe / Flash | RAG Vector data |
| **Cold Storage** | Object (S3 / NFS) | Object Knowledge Bases, archives |
| **Block Storage** | Block (Ceph etc.) | VMs, K8s Pods, ETCD |

---

## 12. Reference Architecture Standards
- Incorporate **RDMA** for GPU interconnect
- Align with **NVIDIA Reference Architecture**
- Use Rafay as the control plane
- Follow industry standards ("According to Standards")

---

## 13. Key Terms Glossary

| Term | Definition |
|---|---|
| HPC | High Performance Computing |
| K8s | Kubernetes |
| KubeFlow | ML workload orchestration on K8s |
| KAI Scheduler | GPU-aware K8s scheduler, replaces Run.ai |
| InfiniBand | High-speed low-latency network for GPU clusters |
| RDMA | Remote Direct Memory Access |
| MIG | Multi-Instance GPU — hardware GPU partitioning |
| SONIC | Open-source network OS for whitebox switches |
| EDA | Event-Driven Automation |
| Metal3 | Bare metal provisioning via K8s |
| BCM | Bare metal cluster manager |
| Slinky | SLURM + K8s integration |
| vCluster | Virtual K8s cluster within a physical cluster |
| NIM | NVIDIA Inference Microservices |
| ETCD | K8s distributed key-value store |
| RAG | Retrieval-Augmented Generation |
| RFP | Request for Proposal |
| RA | Reference Architecture |
| RBAC | Role-Based Access Control |
| Run.ai | Commercial GPU scheduling platform (being replaced by KAI) |
| Rafay | Multi-cluster management and GitOps platform |
| NS/EW | North-South / East-West traffic |
| SSP | Self-Service Portal |
| JNaaS | Jupyter Notebook as a Service |
| NUOP8R | Custom K8s operator framework (NUOperator?) |

---

## 14. Open Questions / Things to Dig Into

- [ ] What exactly is NUOP8R? Internal tool or known open-source project?
- [ ] What is VMetal specifically? VMware Metal or custom?
- [ ] What is VRL in the vCluster stack?
- [ ] How exactly does Slinky bridge SLURM and K8s?
- [ ] What is the exact role of EDA here — Nokia EDA or something else?
- [ ] How does BCM (Bright Cluster Manager) integrate with K8s?
- [ ] What is the full flow of an RFP -> RA delivery process?
- [ ] How does Rafay SSP/JNPaaS interface work for tenants?

---

## 15. Learning Roadmap (To Be Built Out)

1. Phase 1: Hardware & Networking fundamentals (InfiniBand, RDMA, Spine-Leaf, NIC bonding)
2. Phase 2: Kubernetes deep-dive (Pods, Schedulers, Operators, CRDs)
3. Phase 3: GPU virtualization (MIG, Time Slicing, vGPU, CUDA)
4. Phase 4: KubeFlow & KAI Scheduler
5. Phase 5: Rafay platform (Controller, Agents, GitOps, RBAC)
6. Phase 6: Bare metal provisioning (Metal3, Slinky, BCM)
7. Phase 7: Storage architecture (Hot/Cold/Block, Ceph, S3, NFS)
8. Phase 8: Tenant models & multi-tenancy patterns
9. Phase 9: RFP sizing exercises & Reference Architecture delivery

---
Last Updated: 2026-07-28 | Source: Boss reference architecture notes (4 notebook pages + 8 diagrams)
