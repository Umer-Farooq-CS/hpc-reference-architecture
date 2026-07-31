# Control Flow Diagram
# End-to-End Request Flow — From SSP Click to Running Workload

> This diagram traces the **exact sequence of events** when a tenant interacts with the platform.
> It covers two primary flows: **Notebook Launch** (interactive) and **Training Job** (batch).
> For component detail see [15_software_diagram.md](15_software_diagram.md).

---

## Flow A — Tenant Launches a Jupyter Notebook (JNaaS)

<object type="image/svg+xml" data="../assets/diagrams/16_control_flow_diagram_1.svg" class="mermaid-svg mermaid-svg-tall"></object>

---

## Flow B — Tenant Submits a Distributed Training Job

<object type="image/svg+xml" data="../assets/diagrams/16_control_flow_diagram_2.svg" class="mermaid-svg mermaid-svg-tall"></object>

---

## Flow C — Rafay Blueprint Deployment (Initial Cluster Bootstrap)

!!! info "Pre-condition"
    Before any PXE boot is possible, SONiC switches and the Management switch must be configured via EDA. This is a one-time physical infrastructure setup step performed before cluster bootstrap begins.

<object type="image/svg+xml" data="../assets/diagrams/16_control_flow_diagram_3.svg" class="mermaid-svg mermaid-svg-tall"></object>

---

## Flow D — Tenant Onboarding & vCluster Provisioning

<object type="image/svg+xml" data="../assets/diagrams/16_control_flow_diagram_4.svg" class="mermaid-svg mermaid-svg-tall"></object>

---

## Flow E — Dynamic GPU MIG Slicing

<object type="image/svg+xml" data="../assets/diagrams/16_control_flow_diagram_5.svg" class="mermaid-svg mermaid-svg-tall"></object>

---

## Flow F — Model Serving & Auto-Scaling

<object type="image/svg+xml" data="../assets/diagrams/16_control_flow_diagram_6.svg" class="mermaid-svg mermaid-svg-tall"></object>

---

## Flow G — High-Performance Storage Mounting

<object type="image/svg+xml" data="../assets/diagrams/16_control_flow_diagram_7.svg" class="mermaid-svg mermaid-svg-tall"></object>

---

## Flow H — Hardware Failure & Auto-Recovery

<object type="image/svg+xml" data="../assets/diagrams/16_control_flow_diagram_8.svg" class="mermaid-svg mermaid-svg-tall"></object>

---

## Component Ownership Summary

| Component | Who Controls It | How |
|---|---|---|
| Physical servers | Metal3 Stack | PXE Boot, iDRAC, hardware inventory |
| SONiC switch config | EDA (Nokia) | GitOps push from EDA controller |
| Kubernetes cluster lifecycle | Rafay SaaS | Blueprint + ArgoCD GitOps sync |
| GPU driver & MIG slicing | NVIDIA GPU Operator | DaemonSet on every GPU node |
| Pod scheduling & GPU quotas | KAI Scheduler | Replaces default kube-scheduler |
| ML workload submission | KubeFlow (Pipelines / Notebooks) | CRD controllers watching API server |
| Tenant isolation (network) | Cilium NetworkPolicies | eBPF rules per namespace/vCluster |
| Storage volumes | CSI Drivers | WEKA / MinIO / Rook-Ceph |
| TLS & certificates | cert-manager | Auto-renews via Let's Encrypt / internal CA |
| Platform metrics | DCGM + Prometheus + Grafana | Scrapes every layer |

---
*Back to [Software Architecture Diagram](15_software_diagram.md)*
*Back to [Chosen Architecture Index](index.md)*
