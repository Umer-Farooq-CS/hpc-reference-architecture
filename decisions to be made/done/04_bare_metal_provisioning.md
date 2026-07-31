# 05 — Bare Metal Provisioning (Deep Dive)

> Covers: Metal3, Slinky, BCM (Bright Cluster Manager), VMetal, and alternatives.  
> These tools answer: "How do you turn a rack of physical servers into a K8s cluster automatically?"

---

## 1. The Problem — Bare Metal Provisioning

When you have a rack full of new servers, they arrive with:
- No OS installed (or vendor default)
- No networking configured (except BIOS/BMC)
- No Kubernetes
- No drivers

**Bare metal provisioning** is the process of automatically:
1. Discovering and inventorying the servers
2. Booting them over the network (PXE boot)
3. Installing the OS (Ubuntu, RHEL, Rocky Linux)
4. Configuring networking (InfiniBand, Ethernet, bonding)
5. Installing Kubernetes
6. Installing NVIDIA GPU Operator
7. Joining the node to the K8s cluster

Without automation, doing this for 100+ servers takes weeks. With proper tools, it takes hours.

---

## 2. Metal3 — Kubernetes-Native Bare Metal Provisioning

**Metal3 (Metal Kubed)** is a CNCF project that provides Kubernetes-native bare metal host management. It is the most widely adopted open-source bare metal provisioning solution for K8s clusters.

**GitHub:** github.com/metal3-io/metal3-docs  
**Key backend:** Built on top of **OpenStack Ironic** (the battle-tested bare metal provisioning service)

### How Metal3 Works
Metal3 uses CRDs to represent physical servers as Kubernetes objects. You manage servers the same way you manage Pods — with YAML manifests.

```
BareMetalHost CRD
┌─────────────────────────────────────────┐
│  apiVersion: metal3.io/v1alpha1          │
│  kind: BareMetalHost                    │
│  metadata:                              │
│    name: server-01                      │
│  spec:                                  │
│    bmc:                                 │
│      address: idrac://192.168.1.10      │  ← iDRAC/iLO BMC address
│      credentialsName: server-01-bmc     │  ← BMC credentials secret
│    bootMACAddress: "aa:bb:cc:dd:ee:ff"  │  ← MAC for PXE boot
│    image:                               │
│      url: http://images/ubuntu-22.04.qcow2
│      checksum: sha256:abc123            │
└─────────────────────────────────────────┘
```

### Metal3 Components
| Component | Role |
|---|---|
| **Baremetal Operator (BMO)** | K8s controller that watches BareMetalHost CRDs |
| **OpenStack Ironic** | Does the actual PXE boot, disk imaging, power management |
| **IPMI / Redfish** | Protocol used to control server power, boot order (via BMC/iDRAC/iLO) |
| **ironic-inspector** | Discovers hardware details (CPUs, RAM, disks, NICs) automatically |
| **cluster-api-provider-metal3** | Integrates Metal3 with Cluster API for K8s cluster lifecycle |

### Provisioning Flow
```
1. Server joins network with PXE boot enabled
2. ironic-inspector discovers it → creates BareMetalHost in "discovered" state
3. Operator assigns image + config → BareMetalHost moves to "provisioning"
4. Ironic boots server via IPMI, writes OS image to disk
5. Server boots into new OS → joins K8s cluster via cluster-api
6. GPU Operator detects new GPU node → installs drivers automatically
7. BareMetalHost → "provisioned" state
```

### Cluster API (CAPI) Integration
**Cluster API** is a CNCF project for declarative cluster lifecycle management. With Metal3 + CAPI:
- You define what your cluster should look like (control plane: 3 nodes, workers: 50 nodes)
- CAPI + Metal3 automatically provision and configure the physical servers
- Node scaling: add a machine → Metal3 automatically provisions a new bare metal host

---

## 3. Slinky — SLURM on Kubernetes

**Slinky** is a project that bridges traditional HPC job scheduling (SLURM) with Kubernetes. It allows SLURM workloads to run natively on a Kubernetes cluster.

**Why this matters:** Many HPC users and legacy workloads are written for **SLURM** (MPI jobs, bash scripts with `sbatch`). Slinky allows these to run on K8s WITHOUT rewriting the workloads.

### What is SLURM?
**SLURM (Simple Linux Utility for Resource Management)** is the most widely used workload manager in traditional HPC (used by 60%+ of supercomputers). It predates Kubernetes and handles:
- Job queuing and scheduling
- Node allocation (whole-node allocation)
- MPI process management
- Priority-based scheduling

### The Gap Between SLURM and K8s
| SLURM | Kubernetes |
|---|---|
| Whole-node allocation | Container-level resource allocation |
| MPI-native | Container-first |
| sbatch scripts | YAML manifests |
| squeue/sacct monitoring | kubectl/Prometheus |
| Designed for HPC batch | Designed for microservices |

### What Slinky Does
Slinky provides a **SLURM operator for Kubernetes** that:
1. Runs SLURM controller (slurmctld) as a Pod in K8s
2. Runs SLURM daemons (slurmd) on worker nodes as DaemonSets
3. Translates SLURM job requests into K8s Pods
4. Users submit `sbatch` jobs as normal → Slinky routes them to K8s

```
User: sbatch train.sh --nodes=8 --gres=gpu:8
    ↓
SLURM controller (Slinky K8s operator)
    ↓
Creates K8s Job/Pod spec with nvidia.com/gpu: 8 × 8 nodes
    ↓
KAI Scheduler (gang scheduling) → 8 GPU nodes
    ↓
Training job runs
```

### Why Slinky in Your Architecture
- You might have clients who are HPC shops that only know SLURM
- Slinky lets them keep their existing workflows while you migrate to K8s underneath
- Provides a migration path from traditional HPC to cloud-native HPC

### Alternative to Slinky
| Tool | Notes |
|---|---|
| **SLURM native** | Run SLURM without K8s (not cloud-native, harder to manage) |
| **Apache Spark on K8s** | For data processing workloads |
| **Volcano** | Another K8s batch scheduling system (competitor to KAI) |

---

## 4. BCM — Bright Cluster Manager

**BCM (Bright Cluster Manager)** is a commercial HPC cluster management software suite by **Bright Computing** (acquired by NVIDIA in 2022).

**Key point:** Since NVIDIA acquired Bright Computing, BCM is now part of the NVIDIA HPC ecosystem — a natural fit with GPU clusters.

### What BCM Does
BCM is a full-stack cluster management system that handles:
- **Provisioning:** Install OS on bare metal nodes (similar to Metal3 but more HPC-focused)
- **Configuration Management:** Chef/Puppet-like configuration for HPC nodes
- **Monitoring:** Hardware monitoring (temperature, power, errors)
- **Job Scheduler Integration:** Works with SLURM, PBS, LSF
- **Health Management:** Auto-detects and handles node failures
- **Software Management:** Deploy CUDA, MPI, HPC libraries across all nodes

### BCM vs Metal3
| Feature | BCM | Metal3 |
|---|---|---|
| **Type** | Commercial | Open source |
| **Cost** | $$$ per node/year | Free |
| **K8s integration** | Via NVIDIA (since acquisition) | Native K8s |
| **SLURM integration** | Native | Via Slinky |
| **UI** | Rich commercial GUI | K8s native (kubectl) |
| **HPC maturity** | Decades of HPC use | Newer, K8s-native |
| **Support** | NVIDIA commercial SLA | Community |

### When to Use BCM
- Traditional HPC environment with SLURM
- Client requires commercial SLA for cluster management
- Large-scale bare metal with complex hardware heterogeneity
- When NVIDIA AI Enterprise contract is already in place (BCM included)

---

## 5. VMetal

Based on your boss's notes, **VMetal** is referenced alongside Metal3, Slinky, and BCM for bare metal provisioning and LLM visibility.

**Most likely interpretation:** VMetal may refer to one of:
1. **VMware Metal** — VMware's bare metal service (part of VMware Cloud Foundation)
2. **An internal/proprietary tool** used by your organization or a specific vendor
3. **Virtual Metal** — a concept tool that abstracts bare metal as virtual resources

**If it refers to VMware Cloud Foundation (VCF) with bare metal support:**
- Provides bare metal Kubernetes through Tanzu Kubernetes Grid (TKG)
- Manages physical servers using VMware's orchestration layer
- More enterprise-oriented, higher cost

**Recommendation:** Clarify with your boss exactly which product "VMetal" refers to.

---

## 6. Alternative Bare Metal Provisioning Tools

| Tool | Type | Notes |
|---|---|---|
| **Tinkerbell** | Open source (CNCF sandbox) | Equinix Metal's provisioning tool, very lightweight |
| **Canonical MAAS** | Open source | Ubuntu-focused, integrates with Juju, popular for OpenStack |
| **Foreman** | Open source | Puppet-backed, very mature, heavy |
| **Cobbler** | Open source | Old-school PXE provisioning |
| **Redfish API** | Protocol | Modern BMC management protocol (replacing IPMI) |

---

## 7. LLM Visibility — What Does This Mean?

Your boss's notes mention "LLM Visibility" alongside the provisioning tools. This likely means:
- **Hardware visibility for LLM workloads** — being able to see which nodes host which LLM workloads
- **GPU utilization visibility** — monitoring how LLMs are consuming GPU resources
- **LLM-aware inventory** — tracking which model is running on which hardware slice (B1-G1-A naming)

Tools used for this:
| Tool | Purpose |
|---|---|
| **DCGM Exporter** | GPU metrics (via NVIDIA GPU Operator) |
| **Prometheus + Grafana** | Visualization of GPU metrics |
| **BCM** | Hardware-level monitoring |
| **NVIDIA AI Enterprise** | LLM fleet management with NIM |

---

## 8. Recommended Standard — Bare Metal Provisioning

```
Open-Source Path (Recommended for new deployments):
├── Metal3 + Cluster API              ← Declarative bare metal K8s provisioning
├── OpenStack Ironic                  ← PXE boot, disk imaging backend
├── Tinkerbell (optional)             ← Lightweight alternative to Ironic
├── Slinky                            ← SLURM compatibility for legacy HPC workloads
└── Prometheus + DCGM                ← Hardware + GPU visibility

Enterprise Path (if NVIDIA AI Enterprise is licensed):
├── BCM (Bright Cluster Manager)      ← Full-stack HPC cluster management
├── SLURM + Slinky bridge             ← Job scheduling compatibility
└── NVIDIA Base Command Manager       ← NVIDIA's enterprise HPC management tool
```

**Provisioning Flow (Standard):**
```
New Server Arrives in Rack
    ↓
BMC/iDRAC auto-discovered by Metal3 ironic-inspector
    ↓
BareMetalHost CRD created automatically
    ↓
Cluster API MachineDeployment triggers provisioning
    ↓
OS deployed (Ubuntu 22.04 LTS + cloud-init config)
    ↓
Kubernetes node joins cluster (kubeadm/RKE2)
    ↓
NVIDIA GPU Operator DaemonSet installs drivers
    ↓
Node labeled: nvidia.com/gpu.product=H100-SXM5-80GB
    ↓
Ready for workloads in < 30 minutes
```

---

## Decisions to be Made for Reference Architecture
### 1. The Core Provisioning Engine (Open-Source vs. Enterprise)
You need to decide how those 64 bare metal servers will get their OS and Kubernetes installed when they are racked.
*   **Option A (Open-Source/Cloud-Native):** Use **Metal3 + Cluster API (with OpenStack Ironic)**. This is the modern, Kubernetes-native way where you manage physical servers using YAML files just like you manage Pods.
*   **Option B (Enterprise/Commercial):** Use **BCM (Bright Cluster Manager)**. Since NVIDIA bought Bright, this is tightly integrated with GPU clusters, but it comes with a high licensing cost ($$$).

### 2. SLURM / Legacy HPC Compatibility
You need to decide if your 110 tenants will include traditional HPC data scientists who expect to submit jobs using `sbatch` (SLURM).
*   **Decision:** If you go with the K8s/Metal3 route (Option A above) but still need SLURM compatibility, you must formally adopt **Slinky** into the architecture to translate SLURM commands into Kubernetes pods.

### 3. The "VMetal" Clarification
Your notes reference "VMetal", but it's an ambiguous term in the industry.
*   **Action Needed:** You need to clarify what this meant in your initial notes. Does it mean VMware Cloud Foundation (VCF) bare metal? Or is it an internal/proprietary company tool? If it's VMware, that entirely changes the provisioning architecture and adds hypervisor licensing costs.

### 4. The Visibility Stack
You need to define how you will monitor the hardware, specifically tracking which LLMs are consuming which GPU slices (MIGs).
*   **Decision:** Will you use the standard open-source stack (**Prometheus + Grafana + DCGM Exporter** via the NVIDIA GPU Operator), or rely on enterprise tools like **NVIDIA Base Command Manager**?

---
*Next: See `06_network_software.md` for SONIC, EDA, and Linux networking.*
