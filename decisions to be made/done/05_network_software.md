# 06 — Network Software Layer (Deep Dive)

> Covers: SONIC, EDA (Event-Driven Automation), Linux networking, and how they work together in an HPC GPU cluster.

---

## 1. SONIC — Software for Open Networking in the Cloud

**SONiC** is an open-source **Network Operating System (NOS)** originally developed by Microsoft for their Azure hyperscale datacenter network. It was open-sourced in 2016 and is now part of the **Linux Foundation**.

**GitHub:** github.com/sonic-net/sonic-buildimage  
**Used by:** Microsoft Azure, Alibaba Cloud, Comcast, Goldman Sachs, and many hyperscalers

### Why SONIC Exists
Traditional networking equipment (Cisco, Juniper) runs on proprietary operating systems (IOS, JunOS, NX-OS). These have several problems:
- **Vendor lock-in** — you can only use that vendor's hardware
- **Slow updates** — new features take years to appear
- **High cost** — you pay for the software bundled with the hardware
- **Limited programmability** — hard to automate and integrate

**SONIC solves this** by running on **whitebox switches** (open hardware from manufacturers like Celestica, Edgecore, Accton) — you buy the hardware from any vendor and install SONIC on it.

---

## 2. SONIC Architecture

SONIC runs on Linux (typically Debian) and uses a central database (Redis) as the system bus:

```
┌──────────────────────────────────────────────────────────┐
│                    SONIC Applications                    │
│  BGP (FRRouting)  │  LLDP  │  DHCP  │  Telemetry  │    │
├──────────────────────────────────────────────────────────┤
│              SWSS (Switch State Service)                  │
│  orchagent: translates high-level config → hardware SAI  │
├──────────────────────────────────────────────────────────┤
│                   Redis Database (APPL_DB / CONFIG_DB)   │
│           Central system bus for all SONIC services      │
├──────────────────────────────────────────────────────────┤
│              SAI (Switch Abstraction Interface)           │
│          Vendor-neutral API to program switch ASIC       │
├──────────────────────────────────────────────────────────┤
│              Switch ASIC (Broadcom Tomahawk, etc.)       │
└──────────────────────────────────────────────────────────┘
```

### SAI — Switch Abstraction Interface
**SAI** is the key innovation — it's a standard API that SONIC uses to talk to the switch chip (ASIC). Different ASIC vendors (Broadcom, Marvell, Intel, Barefoot/Tofino) all implement SAI. So SONIC works on any switch with a SAI-compliant ASIC.

---

## 3. SONIC Features for HPC/GPU Clusters

| Feature | Why It Matters for GPU Clusters |
|---|---|
| **BGP Routing** | Scale-out routing for large clusters (using FRRouting) |
| **ECMP** | Equal-cost multipath — spreads traffic across all spine links |
| **RDMA/RoCE support** | QoS for RoCEv2 traffic — critical for GPU RDMA over Ethernet |
| **PFC (Priority Flow Control)** | Lossless Ethernet for RDMA — prevents packet drops |
| **ECN (Explicit Congestion Notification)** | Congestion avoidance without dropping RDMA packets |
| **Telemetry** | gNMI/gRPC streaming telemetry for real-time network monitoring |
| **ACLs** | Tenant network isolation |
| **VxLAN** | Network virtualization for vClusters |
| **EVPN** | BGP-based overlay for multi-tenant networks |

### SONIC and RoCEv2 — Critical for GPU Clusters
If your GPU cluster uses **RoCEv2** (RDMA over Ethernet instead of InfiniBand), SONIC's ability to configure **PFC** and **ECN** is critical:
- **PFC (Priority Flow Control):** Pauses specific traffic classes when a buffer fills up, ensuring RDMA packets are never dropped (lossless Ethernet)
- **ECN:** Signals congestion early so endpoints reduce their sending rate before buffers overflow

Without these, RDMA over Ethernet is unreliable and performance degrades severely.

---

## 4. SONIC vs Traditional Switch OS

| Feature | SONIC | Cisco NX-OS | Juniper JunOS | Cumulus Linux |
|---|---|---|---|---|
| **Open source** | ✅ Yes | ❌ No | ❌ No | ❌ Partially |
| **Hardware choice** | Any whitebox | Cisco only | Juniper only | Any whitebox |
| **Automation** | ✅ Excellent (Python, REST, gNMI) | Moderate | Good | Good |
| **HPC/RDMA support** | ✅ Good | ✅ Good | ✅ Good | ✅ Good |
| **Maturity** | High (Azure-proven) | Very High | Very High | High |
| **Cost** | Free (+ support) | $$$$$ | $$$$$ | $$ |
| **Community** | Large (Linux Foundation) | Cisco TAC | Juniper JTAC | Limited |

**Recommendation:** For a cost-effective, open, programmable switch layer → **SONIC on whitebox switches**.

---

## 5. EDA — Event-Driven Automation

**EDA** in network contexts can refer to two things:

### 5.1 Nokia EDA (Event-Driven Automation)
**Nokia EDA** is Nokia's network automation platform that uses an **event-driven architecture** to automate network operations.

- Built on Kubernetes
- Uses a GitOps model for network configuration
- Supports Nokia SR Linux and SR OS routers/switches
- When a network event occurs (link down, new device joins, BGP peer change) → automation workflows trigger automatically

**Why "Event-Driven":**
Traditional network automation is **imperative** (you tell it step by step what to do).  
Event-driven is **reactive** (the network monitors itself and automatically responds to events).

```
Event: New bare metal server joined the network
    ↓ EDA detects new MAC/LLDP neighbor
    ↓ EDA workflow triggers automatically
    ↓ VLAN configured on switch port
    ↓ Server added to correct network segment
    ↓ DHCP lease assigned
    ↓ Notification sent
```

### 5.2 General EDA Concept in Your Architecture
More broadly, **EDA in your architecture** likely refers to using event-driven automation for:
- **Zero-touch provisioning (ZTP):** New switch powers on → SONIC auto-configured via event
- **Network self-healing:** Link failure → BGP reconverges automatically via event triggers
- **SONIC + Ansible/Python:** Automated network changes triggered by K8s events

### Nokia SR Linux (Relevant to EDA)
Nokia's **SR Linux** is a modern NOS (like SONIC) with native EDA support. It's a competitor to SONIC:
- gNMI-native
- Python/CLI programmable
- Used with Nokia EDA for full event-driven network automation

---

## 6. Linux Networking in Your Stack

Linux handles networking at the host level (on each GPU server) and on the switches (since SONIC runs on Linux).

### Key Linux Networking Technologies

#### Bonding / LACP (Link Aggregation)
Multiple physical NICs combined into one logical interface for redundancy and higher bandwidth:
```
bond0 (active-active LACP, 2x 25GbE = 50GbE effective)
  ├── eth0 (25GbE, Switch-A port 1)
  └── eth1 (25GbE, Switch-B port 1)    ← dual-homed for redundancy
```

#### SR-IOV (Single Root I/O Virtualization)
A physical NIC presents multiple **Virtual Functions (VFs)** that can be passed directly to Pods or VMs. Critical for:
- InfiniBand VFs for RDMA in GPU Pods
- High-performance networking without software overhead

```
ConnectX-7 (Physical Function)
  ├── VF0 → Pod A (training job)
  ├── VF1 → Pod B (inference)
  └── VF2 → Pod C (another job)
```

The **SR-IOV Network Operator** (another NVIDIA operator for K8s) manages SR-IOV VF allocation on nodes.

#### VxLAN (Virtual Extensible LAN)
Used for **vCluster networking** — overlay network that encapsulates tenant traffic inside UDP packets, providing network isolation between tenants sharing the same physical network.

#### eBPF (Extended Berkeley Packet Filter)
Used by **Cilium CNI** — allows custom network programs to run in the Linux kernel without writing kernel modules. Enables:
- Extremely fast network policy enforcement
- Deep observability (who is talking to who)
- Service mesh without sidecars

---

## 7. Putting It All Together — Network Stack

```
PHYSICAL LAYER
├── Servers: ConnectX-7 (InfiniBand), 2x 25GbE (Ethernet)
└── Switches: Whitebox (Celestica, Edgecore, Accton)

SWITCH OS LAYER
└── SONIC (running on whitebox switches)
    ├── BGP routing (FRRouting)
    ├── PFC + ECN (for RoCEv2 / lossless Ethernet)
    ├── VxLAN (tenant isolation)
    └── gNMI telemetry

NETWORK AUTOMATION LAYER
└── EDA / SONIC + Ansible/Python
    ├── Zero-touch provisioning (new server → auto-configured)
    ├── Event-driven responses (link failure → reroute)
    └── Tenant VLAN/VxLAN provisioning

HOST NETWORKING (per server)
└── Linux kernel networking
    ├── SR-IOV VFs (InfiniBand → RDMA in Pods)
    ├── Bond0 (LAG for Ethernet resilience)
    ├── Multus CNI (multiple NICs per Pod)
    └── Cilium CNI (eBPF-based K8s networking)
```

---

## 8. Recommended Standard — Network Software

| Layer | Recommended Tool | Why |
|---|---|---|
| **Switch OS** | SONIC | Open, proven at hyperscale, free |
| **Routing** | FRRouting (BGP) within SONIC | Industry standard, open source |
| **Network Automation** | Ansible + SONIC gNMI OR Nokia EDA | Event-driven, GitOps compatible |
| **K8s CNI** | Cilium (primary) + Multus | eBPF performance + multi-NIC support |
| **GPU RDMA** | SR-IOV device plugin + IB VFs | Direct InfiniBand access from Pods |
| **Tenant isolation** | VxLAN + EVPN (SONIC) | Scalable multi-tenant overlay |
| **Lossless Ethernet** | PFC + ECN in SONIC | Required for RoCEv2 RDMA |
| **Telemetry** | gNMI → Prometheus → Grafana | Real-time network visibility |

---

## Decisions to be Made for Reference Architecture
### 1. The Switch Operating System (NOS)
You need to formally decide what OS will run on your Ethernet switches.
*   **Decision:** Confirm if you are committing to **SONiC** (the open-source, vendor-neutral OS used by hyperscalers) running on whitebox hardware, or if you prefer a proprietary vendor lock-in (like Cisco NX-OS or Juniper JunOS). *Note: SONiC is highly recommended for this build.*

### 2. Network Automation Strategy (EDA)
You need to decide how network events (like a new server booting up, or a link failing) trigger automation.
*   **Decision:** Will you purchase a commercial platform like **Nokia EDA** (Event-Driven Automation), or will you build an open-source event-driven pipeline using **SONiC + Ansible/Python** triggered by Kubernetes/GitOps events?

### 3. Kubernetes Network Plugins (CNI)
Because you have a complex 6-NIC/12-connection setup (InfiniBand + Ethernet), a standard Kubernetes network isn't enough. You need to decide on your CNIs.
*   **Decision:** Confirm the use of **Cilium** as your primary CNI (for ultra-fast eBPF networking and security) combined with **Multus** (which is mandatory to allow your GPU Pods to connect to both the Ethernet network and the InfiniBand RDMA network simultaneously).

### 4. Tenant Isolation Strategy
With 110 tenants sharing the same physical network, you need to decide how they are isolated from each other.
*   **Decision:** Confirm if you will use **VxLAN + EVPN** (managed via SONiC) as the overlay network to keep tenant traffic completely separated.

---
*Next: See `07_rafay.md` for the Rafay platform — controllers, agents, GitOps, and multi-tenancy.*
