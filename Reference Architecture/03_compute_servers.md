# Compute Nodes, Servers & Physical Rack Layout

> Part of the [Chosen Architecture](index.md) specification.

---

## Compute Node & Server Architecture

To deliver 64 GPUs with maximum efficiency and internal bandwidth, the platform standardizes on 8-GPU bare-metal compute chassis.

### Sizing Calculation
64 Total GPUs / 8 GPUs per Server = **8 Bare-Metal Compute Nodes (Servers)**

### Server Hardware Specifications
* **Form Factor:** 6U Rack-Mount Chassis (e.g., Dell PowerEdge XE9680).
* **GPU Subsystem:** 8x NVIDIA H100 SXM5 GPUs (80GB HBM3 memory per GPU).
* **Intra-Node Interconnect:** NVIDIA NVLink / NVSwitch (900 GB/s bidirectional GPU-to-GPU bandwidth within the chassis).
* **Host Compute:** Dual Intel Xeon Platinum 8480+ (56 cores/socket) or AMD EPYC 9654.
* **System Memory:** 1.5 TB DDR5 ECC RAM per node.
* **Local Storage:** 4x 3.84TB NVMe U.2 SSDs (OS, local scratch, and local caching).

---

## Physical Rack & Power Distribution

To respect electrical Power Distribution Unit (PDU) capacity and heat dissipation limits, compute nodes are distributed across **2 Physical Datacenter Racks**.

<object type="image/svg+xml" data="../assets/diagrams/03_compute_servers.svg" class="mermaid-svg"></object>



### Rationale:
* **Thermal & Power Caps:** Each 8-GPU H100 server draws ~10.2 kW. Placing 4 servers in a rack yields ~40.8 kW, fitting within standard datacenter liquid/air cooling and 50 kW PDU thresholds.
* **Rack Height:** 4 servers (24U) = 24U used in a standard 42U cabinet.

---
*Back to [Chosen Architecture Index](index.md)*
