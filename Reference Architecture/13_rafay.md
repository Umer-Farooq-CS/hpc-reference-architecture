# Multi-Cluster Management & Platform Orchestration

> Part of the [Chosen Architecture](index.md) specification.

---

## 1. Top-Level Management Control Plane
**Decision:** **Rafay Platform**.

*   **Rationale:** Rafay acts as the "single pane of glass" Kubernetes Operations Platform (KOP). It manages the lifecycle of the bare-metal RKE2 clusters, deploying the required software stack (GPU Operator, KubeFlow, KAI Scheduler, SONiC/EDA integration) via Golden Blueprints. It utilizes an outbound-only agent architecture, ensuring the physical servers remain secure behind the corporate NAT/Firewall without requiring inbound public IP access.

## 2. Deployment Model
**Decision:** **Rafay SaaS**.

*   **Rationale:** Utilizing the SaaS model offloads the immense operational burden of maintaining the high-availability management plane. The Rafay SaaS controller will live in the cloud, while the lightweight Rafay Agents run on the bare-metal nodes, securely pulling configurations down via outbound HTTPS.

## 3. GitOps Engine
**Decision:** **ArgoCD**.

*   **Rationale:** ArgoCD will serve as the underlying GitOps engine for Rafay. It is the industry standard for declarative, continuous delivery on Kubernetes, providing excellent visibility, drift detection, and a rich UI for tracking workload states across the cluster fleet.

## 4. vCluster Isolation Boundaries
**Decision:** **Strict network and resource isolation** for virtual clusters.

*   **Network Isolation:** Enforced via **Cilium NetworkPolicies**. Traffic between different vClusters is blocked by default at the eBPF layer.
*   **Resource Isolation:** Enforced via a **Virtual Resource Layer (VRL)**. The vCluster syncer maps tenant requests to physical Kubernetes `ResourceQuotas` and KAI Scheduler Queues, guaranteeing tenants cannot exceed their allocated GPU limits or impact the performance of other tenants on the shared physical hardware.

---
*Back to [Chosen Architecture Index](index.md)*
