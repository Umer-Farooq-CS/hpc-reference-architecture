# Network Software & Automation Layer

> Part of the [Chosen Architecture](index.md) specification.

---

## 1. Switch Operating System (NOS)
**Decision:** **SONiC (Software for Open Networking in the Cloud)** running on whitebox Ethernet switches.

*   **Rationale:** SONiC is open-source, vendor-neutral, and proven at hyperscale. It avoids proprietary vendor lock-in, reduces software costs, and provides essential features for RoCEv2 (RDMA over Converged Ethernet), such as Priority Flow Control (PFC) and Explicit Congestion Notification (ECN). This is crucial for GPU workload performance on the Ethernet plane.
*   **Routing:** BGP (via FRRouting / FRR) is used for scalable layer 3 routing. The two SONiC Leaf Switches are configured in an **MLAG (Multi-Link Aggregation Group)** pair with a dedicated peer-link for switch-level redundancy.
*   **RoCEv2 Fabric Details:**
    *   **PFC (Priority Flow Control):** Enabled on storage traffic priority classes to create a lossless ethernet fabric. Prevents packet drops on NVMe-over-Fabrics storage traffic.
    *   **ECN (Explicit Congestion Notification):** Configured to signal congestion to endpoints before queues overflow, allowing GPU storage traffic to back off gracefully without dropping frames.
    *   **ECMP (Equal-Cost Multi-Path):** Both SONiC switches perform 5-way ECMP for the Kube-VIP virtual IP, distributing API server traffic across all 5 Control Plane masters.

## 2. Network Automation Strategy
**Decision:** **EDA (Event-Driven Automation)**.

*   **Rationale:** An event-driven architecture enables zero-touch provisioning and network self-healing. When network events occur (e.g., a link goes down or a new node joins), the EDA platform automatically detects this and triggers the appropriate configuration workflows via GitOps, avoiding manual imperative configurations.

## 3. Kubernetes Network Plugins (CNI)
**Decision:** **Cilium + Multus**.

*   **Rationale:**
    *   **Cilium:** Acts as the primary CNI, providing ultra-fast eBPF-based networking, deep observability, and advanced network policy enforcement without the overhead of sidecars.
    *   **Multus:** A meta-CNI that is mandatory in this architecture to attach multiple network interfaces to pods. It allows GPU Pods to connect to both the primary Ethernet network (via Cilium) and the dedicated InfiniBand RDMA network (via SR-IOV) simultaneously.

## 4. Tenant Isolation & Overlay Network
**Decision:** **VxLAN with EVPN**.

*   **Rationale:** To support secure multi-tenancy (up to 110 tenants) sharing the same physical network, VxLAN provides the necessary network virtualization (overlay network). EVPN (Ethernet VPN), managed via BGP in SONiC, acts as the control plane for VxLAN, providing a highly scalable and robust tenant isolation strategy.

---
*Back to [Chosen Architecture Index](index.md)*
