# Network Switch Topology & Fabric Selection

> Part of the [Chosen Architecture](index.md) specification.

---

## Network Switch Topology & Fabric Selection

The cluster uses **two parallel network planes** to prevent traffic cross-contamination.

<object type="image/svg+xml" data="../assets/diagrams/05_network_switching.svg" class="mermaid-svg"></object>

### GPU Interconnect Plane (InfiniBand NDR 400G)
* **Switch Model:** **1x NVIDIA Quantum-2 QM9700 Switch** (64 ports of 400Gbps NDR).
* **Physical Location:** **Rack C (Shared Switch Plane)** — cross-rack NDR DAC cables (≤2m) or AOC cables to Racks A and B.
* **Topology:** **Single-Switch Zero-Hop Architecture.**
* **Decisions & Rationale:**
  1. **Zero Spine Switches Required:** 8 nodes x 8 IB ports = 64 IB cables total. All 64 GPUs plug directly into a single 64-port Quantum-2 switch.
  2. **Sub-Microsecond Latency:** Eliminates Spine hops for IB. All GPU-to-GPU gradient synchronization achieves native under 0.2 microsecond switch latency.
  3. **Hardware Math Offload (SHARP):** The Quantum-2 switch performs in-network AllReduce collective calculations directly inside the ASIC.

!!! warning "Known Scaling Boundary — RFP Baseline Design"
    The QM9700 (64-port NDR) is intentionally sized to exactly the 64-GPU RFP baseline. All 64 ports are used at steady state. Any growth beyond 64 GPU compute ports requires one of the following:
    
    | Growth Scenario | Required Action |
    |---|---|
    | Add GPU nodes (up to 128 GPUs) | Replace QM9700 with **NVIDIA Quantum-2 QM9790** (400-port NDR) |
    | Add IB-capable storage (e.g., WEKA IB path) | Replace QM9700 with QM9790 or add a second QM9700 with ISL links |
    | Stay permanently within 64 GPU nodes | No action needed — current design is correct and cost-optimal |
    
    The recommended upgrade path is the **QM9790** — same SHARP-capable Quantum-2 ASIC family, full NDR 400G backward compatibility with all existing DAC/AOC cabling.

### Storage & Kubernetes Management Plane (Ethernet 100GbE)
* **Switch Models:** **2x 64-Port 100GbE Whitebox Switches** running **SONiC OS**.
* **Physical Location:** **Rack C (Shared Switch Plane)** — co-located with IB switch and storage/control nodes. Cross-rack 100GbE fiber runs to Compute Racks A and B.
* **Topology:** **Layer 3 BGP MLAG Pair with 4-port Peer-Link LAG.**
* **Decisions & Rationale:**
  1. **64-Port Switch (Upgraded from 32-Port):** The original 32-port design reached 100% utilization when Rack C storage and control plane nodes were added. 64-port switches provide ~47% free port headroom post-deployment, allowing future growth without switch replacement.
  2. **MLAG Peer-Link upgraded to 4-port LAG:** Industry standard for production MLAG HA. A 4-port 100GbE LAG (400GbE aggregate) ensures the peer-link itself never becomes a bottleneck during failover.
  3. **Rack C Placement:** Collocating both SONIC switches in Rack C (where all storage and control nodes reside) eliminates an unnecessary switch hop for storage traffic. Compute nodes in Racks A and B connect via cross-rack 100GbE fiber (standard OM4 or DAC — well within 100m reach).
  4. **Open Networking (SONiC):** Eliminates vendor lock-in and integrates with Nokia EDA and Rafay API controllers.
  5. **RoCEv2 Support:** Priority Flow Control (PFC) and ECN for lossless NVMe storage traffic streaming.

### Out-of-Band Management Plane
* **Switch Model:** **1x 48-Port 1GbE Switch** (located in Rack C).
* **Role:** Dedicated network for iDRAC/BMC power control, fan monitoring, and remote console access. Metal3/Ironic PXE/DHCP also operates on this network.

### Switch Port Utilization Breakdown

#### 1. NVIDIA Quantum-2 QM9700 (InfiniBand 400G)
* **Compute (Racks A & B):** 64 cables (8 Servers × 8 ports each).
* **Storage Tiers:** 0 cables (Storage runs exclusively on Ethernet).
* **Total Used:** 64 Ports Used (out of 64). **100% Utilized — RFP Baseline Limit. See scaling note above.**

#### 2. SONiC Leaf Switch 1 (64 Ports 100GbE) — Rack C
* **Compute (Racks A+B, Path 1):** 8 cables (Nodes 1–8 × 1 port each).
* **Storage Path 1 — WEKA:** 6 cables (3 WEKA servers × 2 dual-100GbE ports each).
* **Storage Path 1 — MinIO:** 4 cables (4 MinIO servers × 1 port each).
* **Storage Path 1 — Ceph:** 6 cables (3 Ceph nodes × 2 dual-100GbE ports each).
* **Control Plane (Path 1):** 5 cables (5 Master Nodes × 1 port each — dual-homed to both switches).
* **MLAG Peer-Link LAG:** 4 ports (4-port 100GbE LAG = 400GbE aggregate — HA standard).
* **External Uplink:** 1 cable (to Corporate NAT/Edge Firewall).
* **Total Used:** 8 + 6 + 4 + 6 + 5 + 4 + 1 = **34 Ports Used (out of 64)**.
* **Remaining:** **30 Free Ports (~47% headroom — available for future growth)**.

#### 3. SONiC Leaf Switch 2 (64 Ports 100GbE) — Rack C
* Identical symmetric layout to Switch 1 (MLAG pair).
* **Total Used:** 34 Ports Used (out of 64).
* **Remaining:** **30 Free Ports (~47% headroom)**.

#### 4. Out-of-Band Management Switch (48 Ports 1GbE) — Rack C
* **Compute Nodes:** 16 cables (8 Servers × 2 BMC ports).
* **Storage Nodes:** 10 cables (10 Dedicated Storage Servers × 1 BMC port).
* **Control Plane:** 5 cables (5 Master Nodes × 1 BMC port each).
* **Total Used:** 16 + 10 + 5 = **31 Ports Used (out of 48)**.
* **Remaining:** 17 Free Ports (reserved for future expansion).

---
*Back to [Chosen Architecture Index](index.md)*
