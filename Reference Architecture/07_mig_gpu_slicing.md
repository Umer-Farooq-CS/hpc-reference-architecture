# Multi-Tenant GPU Slicing & MIG Allocation Strategy

> Part of the [Chosen Architecture](index.md) specification.

---

## Multi-Tenant GPU Slicing & MIG Allocation Strategy

To satisfy the **110-tenant RFP requirement** on 64 physical H100 GPUs (80GB VRAM per GPU), the cluster employs **NVIDIA Multi-Instance GPU (MIG)** with a hybrid **Warm Pool / Dynamic Reserve Strategy**.

### Functional GPU Pool Allocation (64 GPUs Total)

<object type="image/svg+xml" data="../assets/diagrams/07_mig_gpu_slicing.svg" class="mermaid-svg"></object>

1. **Pool 1: Heavy AI Training (25% — 16 GPUs / Servers 1 & 2)**
   * **MIG Configuration:** `7g.80gb` (Full Physical GPU — Un-sliced).
   * **Capacity:** 16 Tenants.
   * **Use Case:** Large language model training (70B+ parameters), multi-node distributed training, high-priority bare-metal workloads.

2. **Pool 2: Balanced Multi-Tenant Warm Pool (50% — 32 GPUs / Servers 3 to 6)**
   * **MIG Configuration per Card:** **100% Efficient Perfect-Fit Combination**:
     * `2x 1g.10gb` (2 Small Instances — 2 Slices / 20GB VRAM total)
     * `1x 2g.20gb` (1 Medium-Small Instance — 2 Slices / 20GB VRAM)
     * `1x 3g.40gb` (1 Medium-Large Instance — 3 Slices / 40GB VRAM)
   * **Hardware Utilization:**
     * **Compute Slices:** 2 + 2 + 3 = **7 / 7 Slices (100% Compute Utilized)**
     * **VRAM Memory:** 20 + 20 + 40 = **80 / 80 GB (100% VRAM Utilized)**
   * **Capacity:** 32 GPUs x 4 Tenants per GPU = **128 Tenants** (Instant 0s startup).

3. **Pool 3: Rafay Dynamic Burst Reserve (25% — 16 GPUs / Servers 7 & 8)**
   * **MIG Configuration:** Dynamic pool re-sliced on-demand by **Rafay Control Plane & NVIDIA GPU Operator (`mig-parted`)**.
   * **Capacity:** Flexible (16 to 112 additional tenants).

### RFP SLA & Tenant Capacity Matrix

| Workload Category | Pool | MIG Profile | Slices / VRAM | Physical GPUs | Tenants Supported | Startup Speed SLA |
|---|---|---|---|---|---|---|
| **Heavy Training** | Pool 1 | `7g.80gb` (full GPU) | 7 Slices / 80GB | 16 dedicated (Srv 1+2) | **16 Tenants** | Instant (0s) |
| **Medium-Large Inference** | Pool 2 | `3g.40gb` | 3 Slices / 40GB | 32 shared GPUs ¹ (Srv 3–6) | **32 Tenants** | Instant (0s) |
| **Medium Inference** | Pool 2 | `2g.20gb` | 2 Slices / 20GB | 32 shared GPUs ¹ (Srv 3–6) | **32 Tenants** | Instant (0s) |
| **Light Jupyter / Dev** | Pool 2 | `1g.10gb` | 1 Slice / 10GB | 32 shared GPUs ¹ (Srv 3–6) | **64 Tenants** | Instant (0s) |
| **Dynamic Reserve** | Pool 3 | On-Demand via mig-parted | Flexible | 16 GPUs (Srv 7+8) | **16 to 112 Tenants** | ~10–15s (Dynamic) |
| **TOTAL CLUSTER** | All | — | — | **64 GPUs** | **144+ Guaranteed Tenants** | **RFP Target (110) Exceeded** |

!!! info "Pool 2 Note"
    All three MIG slice types (`3g.40gb`, `2g.20gb`, `1g.10gb`) are carved from the **same 32 physical GPUs simultaneously**. Each of the 32 physical GPUs holds one complete set of 4 MIG slices at all times: `1×3g.40gb + 1×2g.20gb + 2×1g.10gb`. The 32 + 32 + 64 = **128 tenant slots** all share these same 32 GPUs concurrently. There is no separate bank of "16 GPUs" per slice tier — all 4 slice types coexist on every Pool 2 GPU.

---
*Back to [Chosen Architecture Index](index.md)*
