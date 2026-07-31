# 01 — Hardware Layer & Networking (Deep Dive)

> Part of the HPC/GPU Cloud Platform learning series.  
> Covers: Physical servers, network topology, InfiniBand, RDMA, Ethernet, NICs, traffic patterns.

---

## 1. Physical Servers — Lenovo, HP, Dell

Your architecture runs on **bare metal GPU servers** from three major OEMs. Here's what matters about each in the HPC/GPU context:

### Lenovo
- **Key HPC line:** ThinkSystem SR670 V2, SD650 V3 (high-density Neptune liquid-cooled)
- **GPU support:** Up to 8x NVIDIA H100/A100 SXM per node
- **Specialty:** Neptune direct water cooling — critical for dense GPU configs. Industry-leading thermal efficiency.
- **Network:** Supports ConnectX-7 InfiniBand NICs natively

### Dell
- **Key HPC line:** PowerEdge XE9680 (8x GPU), PowerEdge R760xa
- **GPU support:** 8x H100 SXM5 80GB on XE9680
- **Specialty:** Strong software ecosystem (OpenManage), good Kubernetes/BMC integration
- **Note:** XE9680 is Dell's flagship AI server — competitor to DGX H100

### HP / HPE
- **Key HPC line:** ProLiant DL380 Gen11, Cray EX supercomputer line
- **GPU support:** ProLiant up to 4x GPUs; Cray EX is purpose-built for large clusters
- **Specialty:** HPE acquired Cray — their high-end HPC line (used in national labs) runs on Slingshot interconnect

### What to Look For in an HPC GPU Server
| Feature | Why It Matters |
|---|---|
| **NVLink / NVSwitch** | GPU-to-GPU bandwidth within a single node (up to 900 GB/s on H100 SXM) |
| **PCIe gen** | PCIe 5.0 needed for high-throughput GPU workloads |
| **Memory bandwidth** | HBM3 on H100 = 3.35 TB/s per GPU |
| **Cooling** | Air vs liquid — liquid cooling mandatory at high density |
| **BMC (iDRAC/iLO/XCC)** | Out-of-band management for bare metal provisioning |

---

## 2. Network Topology — Spine-Leaf

Your architecture uses a **Spine-Leaf** (also called Clos) topology. This is the standard for modern data centers and GPU clusters.

### How It Works
```
  [Server]  [Server]  [Server]  [Server]   <- Compute Nodes (leaves attach upward)
     |          |         |         |
  [Leaf SW] [Leaf SW] [Leaf SW] [Leaf SW]  <- ToR (Top of Rack) Leaf Switches
      \        /   \       /    \      /
       \      /     \     /      \    /
        [Spine SW] [Spine SW] [Spine SW]   <- Spine Switches (full mesh to all leaves)
```

### Key Properties
- **Every leaf connects to every spine** — no leaf-to-leaf direct links
- **Any server can reach any other server** in exactly 2 hops (leaf → spine → leaf)
- **Horizontal scaling:** Add more spine switches to increase bandwidth; add more leaf switches to add more servers
- **ECMP (Equal Cost Multi-Path):** Traffic is load-balanced across all spine links simultaneously

### Why Not Fat-Tree or Other Topologies?
| Topology | Pros | Cons | Used Where |
|---|---|---|---|
| **Spine-Leaf (Clos)** | Predictable latency, easy to scale, ECMP | More cables than bus | Modern DC, GPU clusters |
| **Fat-Tree** | Full bisection bandwidth | Expensive at large scale | Supercomputers, HPC |
| **Dragonfly** | Very large scale (thousands of nodes) | Complex routing | National labs (Frontier, Aurora) |
| **Torus** | Great for MPI workloads | Doesn't map well to K8s | Traditional HPC (older Cray) |

**For your use case (GPU cloud platform):** Spine-Leaf is correct. Fat-tree or Dragonfly would be used if you were building a dedicated supercomputer at massive scale (10,000+ GPUs).

---

## 3. InfiniBand — The GPU Interconnect

**InfiniBand (IB)** is a high-speed network technology specifically designed for low-latency, high-bandwidth communication between compute nodes. It is THE standard for GPU cluster interconnects for training.

### Why InfiniBand and Not Just Ethernet?
| Property | InfiniBand NDR | 400GbE Ethernet |
|---|---|---|
| **Bandwidth** | 400 Gb/s per port | 400 Gb/s per port |
| **Latency** | ~0.6 microseconds | ~1-5 microseconds |
| **Protocol** | Native RDMA | RoCEv2 (RDMA over Ethernet) |
| **CPU overhead** | Near zero (kernel bypass) | Low (with RDMA offload) |
| **Cost** | Higher ($$$) | Lower ($$) |
| **Ecosystem** | NVIDIA-dominated | Open, many vendors |

### InfiniBand Generations
| Generation | Speed | Used Today? |
|---|---|---|
| **EDR** | 100 Gb/s | Legacy, still in many clusters |
| **HDR** | 200 Gb/s | Current standard in most GPU clusters |
| **NDR** | 400 Gb/s | Latest — used in H100 clusters |
| **XDR** | 800 Gb/s | Coming — next gen |

**In your architecture:** H100-based clusters typically use NDR InfiniBand (400 Gb/s). NVIDIA's DGX H100 SuperPOD reference architecture mandates NDR IB.

### InfiniBand Hardware
- **NICs:** NVIDIA ConnectX-7 (NDR), ConnectX-6 (HDR)
- **Switches:** NVIDIA Quantum-2 switches (NDR, 64-port)
- **Note:** NVIDIA acquired Mellanox (2020) — they now own the entire InfiniBand stack (NICs, cables, switches, drivers, software)

---

## 4. RDMA — Remote Direct Memory Access

**RDMA** is the underlying technology that makes InfiniBand and high-performance networking so fast.

### What It Does
Normally, when Server A sends data to Server B:
```
App A → Kernel A → NIC A → Network → NIC B → Kernel B → App B
```
This involves multiple CPU interrupts, memory copies, and context switches.

With **RDMA**:
```
App A → NIC A (direct DMA) → Network → NIC B (direct DMA) → App B memory
```
The CPU is **not involved** in the data transfer. The NIC reads/writes directly from application memory.

### Result
- **Zero-copy** — no data copied through CPU
- **Kernel bypass** — no OS involvement in data path
- **Microsecond latency** (vs milliseconds for TCP)
- **This is why distributed GPU training is feasible** — GPUs on different servers can exchange gradients fast enough to keep training efficient

### RDMA Variants
| Variant | Transport | Notes |
|---|---|---|
| **InfiniBand RDMA** | IB native | Best performance, most reliable, expensive |
| **RoCE (RDMA over Converged Ethernet) v1** | Ethernet L2 | Limited to single subnet, rare now |
| **RoCEv2** | Ethernet L3/UDP | Most common Ethernet RDMA, works across routers |
| **iWARP** | TCP | Software RDMA, worst performance, no deployment in HPC |

**Your architecture uses:** InfiniBand RDMA (aligns with NVIDIA RA) for training traffic.

---

## 5. Ethernet in the Architecture

Ethernet is used alongside InfiniBand for:
- **Management traffic** (iDRAC/iLO/BMC access)
- **Storage traffic** (NFS, S3, Ceph)
- **East-West:** Pod-to-Pod K8s networking (Calico, Cilium over Ethernet)
- **North-South:** External users accessing the platform (load balancers, ingress)

### Typical Speeds in a GPU Cluster
| Use | Speed |
|---|---|
| BMC / Out-of-band management | 1 GbE |
| General K8s pod networking | 25 GbE or 100 GbE |
| Storage (Ceph, NFS) | 100 GbE |
| GPU training traffic | 200-400 GbE InfiniBand |

---

## 6. The 6 NIC Structure

Your boss mentioned **6 NICs per node**. This is a common configuration for dual-network GPU servers:

### Typical 6 NIC Layout
| NIC # | Type | Purpose |
|---|---|---|
| NIC 1-2 | 1GbE (onboard) | BMC / IPMI management (out-of-band) |
| NIC 3-4 | 25GbE or 100GbE Ethernet | K8s pod networking, storage, management |
| NIC 5-6 | 200GbE ConnectX-7 InfiniBand | GPU training RDMA traffic |

NICs 5-6 are often bonded (active-active) for redundancy and double the bandwidth.

### SR-IOV (Single Root I/O Virtualization)
A key technology for GPU servers — allows a single physical NIC to present as multiple virtual NICs to VMs or containers. Used with vGPU and vCluster setups.

---

## 7. North-South vs East-West Traffic (NS/EW)

| Direction | What It Is | Examples |
|---|---|---|
| **North-South (NS)** | Traffic between external world and datacenter | User → JupyterHub, API calls from outside |
| **East-West (EW)** | Traffic between servers inside the DC | Pod-to-Pod, GPU-to-GPU gradient sync, storage |

**In GPU clusters, East-West traffic dominates.** During large model training, the gradient synchronization between GPU nodes is enormous (terabytes per second). This is why InfiniBand is critical — it handles the EW GPU traffic.

North-South (NS) traffic (user → service) goes over Ethernet/TCP through a load balancer.

---

## 8. Best Practice — Standard Networking Architecture

```
[External Users]
       |
  [Load Balancer / Ingress]  (100GbE Ethernet, Calico/Cilium)
       |
  [Leaf Switches - 25/100GbE Ethernet plane]
       |         |
  [K8s nodes]  [Storage nodes]
       |
  [Spine Switches - NDR InfiniBand 400Gb/s]
       |
  [GPU nodes - 6 NICs: 2x mgmt, 2x Ethernet, 2x IB ConnectX-7]
```

### Recommended Standard
| Layer | Best Choice | Why |
|---|---|---|
| **GPU Interconnect** | NVIDIA NDR InfiniBand (ConnectX-7) | Lowest latency, NVIDIA-native RDMA |
| **Ethernet plane** | 100GbE with ROCE support | Storage + K8s networking |
| **Topology** | Spine-Leaf (Clos) | Predictable, scalable, ECMP |
| **Switches (IB)** | NVIDIA Quantum-2 | Native NDR, SHARP collective offload |
| **Switches (Eth)** | SONIC-capable whitebox (Arista, Celestica) | Open, programmable, cost-effective |
| **Switch OS** | SONIC | See Network Software doc |

---

## Summary Table

| Component | Your Architecture | Industry Best Practice | Match? |
|---|---|---|---|
| Servers | Lenovo/HP/Dell | Any major OEM with GPU support | ✅ |
| GPU Interconnect | InfiniBand | InfiniBand (NDR) for training | ✅ |
| RDMA | Yes | Mandatory for GPU clusters | ✅ |
| Topology | Spine (Spine-Leaf) | Spine-Leaf (Clos) | ✅ |
| NIC Count | 6 NICs | 4-8 NICs typical | ✅ |
| NS/EW separation | Yes | Best practice | ✅ |

---
*Next: See `02_nvidia_gpu.md` for GPU virtualization, CUDA, and the NVIDIA GPU Operator.*
