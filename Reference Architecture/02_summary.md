# Architecture Summary

> Part of the [Chosen Architecture](index.md) specification.

---

## Architecture Summary Table

| Layer | Architecture Choice | Key Benefit / Rationale |
|---|---|---|
| **Compute Sizing** | 8x 8-GPU Servers (64 H100 GPUs) | Standardized 6U chassis; maximum NVLink density |
| **Rack Layout** | 3 Racks (Rack A + B: Compute, Rack C: Storage + Control) | 2x Compute Racks at ~40.8 kW each; 1x Storage + Control Rack isolated in Rack C |
| **GPU Virtualization**| MIG 75/25 Hybrid Warm & Dynamic Pool | Supports 144+ tenants with 100% zero-waste hardware packing |
| **GPU Network** | 1x NVIDIA Quantum-2 QM9700 (400G NDR) | Single-switch 0-hop fabric; 0 spine switch costs |
| **Ethernet Network**| 2x 64-Port 100GbE Whitebox Switches (SONiC OS) | Open API control via EDA; native RoCEv2; 30 free ports headroom per switch |
| **Node NIC Count** | 12 Connections (2x BMC, 2x Eth, 8x IB) | Strict isolation between training, storage, and mgmt |

---

## Architecture Topology Visual Diagram

The full visual topology diagram has been extracted to a standalone file. Please refer to the [Hardware Architecture Diagram](14_hardware_diagram.md) for the complete hardware, networking, and storage layout.

---
*Back to [Chosen Architecture Index](index.md)*
