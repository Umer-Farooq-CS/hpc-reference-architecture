# Server NIC & Interface Blueprint (12-Connection Layout)

> Part of the [Chosen Architecture](index.md) specification.

---

## Server NIC & Interface Blueprint (12-Connection Layout)

Every compute node features a structured interface layout to separate management, storage/orchestration, and GPU training traffic:

<object type="image/svg+xml" data="../assets/diagrams/04_nic_interfaces.svg" class="mermaid-svg"></object>

| Interface | Physical Hardware | Protocol & Speed | Destination Switch |
|---|---|---|---|
| **Ports 1 & 2** | Onboard LOM / BMC | 1GbE RJ45 | 1GbE Management Switch |
| **Ports 3 & 4** | ConnectX-6 Ethernet PCIe | 100GbE Ethernet | 100GbE SONIC Leaf Switches |
| **Ports 5 to 12**| 8x ConnectX-7 IB (1 per GPU) | 400Gbps NDR InfiniBand | 400G Quantum-2 IB Switch |

---
*Back to [Chosen Architecture Index](index.md)*
