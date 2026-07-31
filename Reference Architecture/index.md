# Chosen Architecture Specification — HPC / GPU Cloud Platform

!!! info "Status: Confirmed Architecture Decisions"
    **Target Scope:** 64 GPU Baseline Sizing & Network Topology  
    **Last Updated:** 2026-07-29

---

## Document Index

| File | What It Covers |
|---|---|
| [Rfp Requirements](01_rfp_requirements.md) | RFP baseline — 110 Tenants, 64 GPUs, 1 PB Storage |
| [Compute Servers](03_compute_servers.md) | Server specs, sizing calculation, physical rack layout |
| [Nic Interfaces](04_nic_interfaces.md) | NIC blueprint, port layout, 12-connection interface table |
| [Network Switching](05_network_switching.md) | Switch topology, InfiniBand fabric, Ethernet & management planes |
| [Network Software](06_network_software.md) | Switch OS (SONiC), EDA automation, CNI (Cilium+Multus), and tenant overlay (VxLAN/EVPN) |
| [Mig Gpu Slicing](07_mig_gpu_slicing.md) | MIG GPU slicing, 75/25 Warm & Dynamic Pool strategy, tenant matrix |
| [Storage Tiers](08_storage_tiers.md) | 4-Tier storage architecture — Local NVMe, WEKA Hot, MinIO Cold, Ceph Block |
| [Bare Metal Provisioning](09_bare_metal_provisioning.md) | Bare metal provisioning with Metal3, OpenStack Ironic, and Cluster API |
| [Control Plane](10_control_plane.md) | 5-Node HA Kubernetes control plane hosting the Metal3 stack |
| [Kubernetes](11_kubernetes.md) | Kubernetes distribution (RKE2), GPU Operator, and StorageClass mapping |
| [Kubeflow Kai](12_kubeflow_kai.md) | ML Orchestration (KubeFlow suite) and GPU Scheduling (KAI Scheduler) |
| [Rafay](13_rafay.md) | Multi-cluster management, SaaS controller, and ArgoCD GitOps engine |
| [Summary](02_summary.md) | Architecture summary table |
| [Hardware Diagram](14_hardware_diagram.md) | Full hardware topology diagram — racks, switches, NICs, storage, and control plane |
| [Software Diagram](15_software_diagram.md) | Software layer diagram — all 7 layers with component interactions |
| [Control Flow Diagram](16_control_flow_diagram.md) | End-to-end control flow — Notebook launch, training job, and cluster bootstrap sequences |
| [Tenant Models](17_tenant_models.md) | 3-Tier Tenant Model — Shared Clusters, vClusters, Bare Metal allocations |
| [Service Layer](18_service_layer.md) | Service Layer — JNaaS (KubeFlow), ModelaaS (vLLM), MLOps (MLflow), and SSP portal |

---

## Diagram Reading Guide

All Mermaid diagrams across all sub-files use a consistent colour and line-style convention:

### Node Colours

| Colour | Node Type | Class Name |
|---|---|---|
| **Dark Navy / Purple border** | InfiniBand switches & IB port groups | `ibSwitch` / `ibPort` |
| **Dark Blue / Cyan border** | Ethernet switches & Ethernet port groups | `ethSwitch` / `ethPort` |
| **Dark Grey / Grey border** | Management switches & BMC port groups | `mgmtSwitch` / `bmcPort` |
| **Dark Navy / Gold border** | GPU compute servers & GPU nodes | `gpuNode` |
| **Dark Brown / Orange border** | Heavy Training GPU Pool (Pool 1) | `heavyPool` |
| **Dark Purple / Purple border** | Balanced Warm Pool (Pool 2) | `warmPool` |
| **Dark Green / Green border** | Rafay Dynamic Reserve Pool (Pool 3) | `dynPool` |

### Line & Arrow Styles

| Style | Meaning | Traffic Type |
|---|---|---|
| **Thick double arrows** (==>) | InfiniBand NDR 400G GPU training traffic | East-West GPU gradient synchronization |
| **Solid thick lines** (===) | 100GbE Ethernet | Storage (RoCEv2) & Kubernetes control plane |
| **Dotted lines** (-.-) | 1GbE Out-of-Band Management | BMC / iDRAC / IPMI remote hardware control |

---

## Quick Architecture Summary

| Layer | Architecture Choice | Key Benefit |
|---|---|---|
| **Compute Sizing** | 8x 8-GPU Servers (64 H100 GPUs) | Maximum NVLink density per chassis |
| **Rack Layout** | 3 Racks (2x Compute + 1x Storage) | Compute racks at ~40 kW; storage rack isolated |
| **GPU Virtualization** | MIG 75/25 Hybrid Warm & Dynamic Pool | 144+ tenants, 100% hardware utilization |
| **GPU Network** | 1x NVIDIA Quantum-2 QM9700 (400G NDR) | Single-switch 0-hop fabric |
| **Ethernet Network** | 2x 100GbE Whitebox Switches (SONIC OS) | Open API control via EDA; native RoCEv2 |
| **Node NIC Count** | 12 Connections (2x BMC, 2x Eth, 8x IB) | Full traffic plane isolation |
| **Storage — Local NVMe** | etcd on CP Masters + Scratch on GPU Nodes | Sub-1ms fsync for etcd; zero shared-storage pollution |
| **Storage — Hot Tier** | WEKA Parallel FS — 200 TB NVMe | 10M+ IOPS over RoCEv2; NVIDIA DGX certified |
| **Storage — Cold Tier** | MinIO Enterprise S3 — 600 TB HDD | Native KubeFlow + MLflow integration; per-tenant S3 buckets |
| **Storage — Block Tier** | Ceph RBD via Rook Operator — 200 TB SSD | CNCF-standard K8s block storage; open-source; 100K+ IOPS |

> For the full detailed summary table, see [02_summary.md](02_summary.md).
