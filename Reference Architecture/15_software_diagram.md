# Software Architecture Diagram
# HPC / GPU Cloud Platform — 64 GPU Cluster
> For full specifications see [index.md](index.md)

---

## Layer Status Summary

| # | Layer | Status | Reference Doc |
|---|---|---|---|
| 0 | Hardware Infrastructure | Finalized | [14_hardware_diagram.md](14_hardware_diagram.md) |
| 1 | Network Software & Automation | Decided | [06_network_software.md](06_network_software.md) |
| 2 | Bare Metal Provisioning | Decided | [09_bare_metal_provisioning.md](09_bare_metal_provisioning.md) |
| 3 | Kubernetes Control Plane | Decided | [10_control_plane.md](10_control_plane.md) |
| 4 | Kubernetes Worker Plane | Decided | [11_kubernetes.md](11_kubernetes.md) |
| 5 | Platform Services | Decided | [12_kubeflow_kai.md](12_kubeflow_kai.md), [13_rafay.md](13_rafay.md) |
| 6 | Tenant & Service Layer | Decided | [17_tenant_models.md](17_tenant_models.md), [18_service_layer.md](18_service_layer.md) |

---

<object type="image/svg+xml" data="../assets/diagrams/15_software_diagram.svg" class="mermaid-svg"></object>

---

## Reading Guide

| Colour | Meaning |
|---|---|
| Grey | Hardware — physical black box |
| Cyan | Network software (SONiC, EDA, VxLAN) |
| Purple | Bare metal provisioning (Metal3/CAPI) |
| Blue | Kubernetes control plane |
| Amber | GPU / AI workload & Tenant components |
| Green | Operations & management (Rafay, ArgoCD, Observability) |

**Thick vertical arrows** = each layer provides the foundation for the layer above it.
**Thin horizontal arrows** = specific component-to-component control interactions.

---
*Back to [Chosen Architecture Index](index.md)*
