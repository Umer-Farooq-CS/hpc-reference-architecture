# 07 — Rafay Platform (Deep Dive)

> Covers: What Rafay is, Controller/Agent architecture, GitOps, multi-cluster management, RBAC, vCluster, and how it compares to alternatives.

---

## 1. What Is Rafay?

**Rafay** is a Kubernetes Operations Platform (KOP) — a commercial platform that provides a unified control plane for managing multiple Kubernetes clusters across on-premises bare metal, private cloud, and public cloud.

**Website:** rafay.co  
**Founded:** 2019  
**Headquarters:** San Jose, CA  
**Category:** Multi-cluster management / Platform Engineering / KOP (Kubernetes Operations Platform)

**In your architecture:** Rafay is the "management brain" that sits above everything and manages the ENTIRE stack — from network configuration down to workload deployment and tenant RBAC.

---

## 2. Rafay Architecture — Controller & Agents

This is a classic **hub-and-spoke** (or controller-agent) model.

```
┌───────────────────────────────────────────────────────┐
│                  RAFAY CONTROLLER                     │
│            (Cloud SaaS or Self-Hosted)                │
│  ┌─────────────┐  ┌──────────┐  ┌──────────────────┐ │
│  │ Cluster Mgmt│  │ GitOps   │  │ RBAC / Tenant    │ │
│  │ (CRUD K8s)  │  │ Engine   │  │ Management       │ │
│  └─────────────┘  └──────────┘  └──────────────────┘ │
└───────────────────────────────────────────────────────┘
              │                │               │
         Outbound-only    Outbound-only   Outbound-only
         HTTPS/WebSocket  HTTPS/WebSocket HTTPS/WebSocket
              │                │               │
   ┌──────────▼──┐   ┌─────────▼───┐   ┌──────▼──────────┐
   │ Rafay Agent │   │ Rafay Agent │   │ Rafay Agent     │
   │ (Cluster A) │   │ (Cluster B) │   │ (Cluster C)     │
   │ Bare Metal  │   │ AWS EKS     │   │ Azure AKS       │
   └─────────────┘   └─────────────┘   └─────────────────┘
```

### The Agent Model — Why It's Important
The Rafay Agent runs as a Pod INSIDE each managed cluster. The agent:
- Establishes an **outbound-only** encrypted connection to the Rafay Controller
- Receives instructions and configuration from the Controller
- Applies changes to the cluster (via kubectl/Helm under the hood)
- Reports status back to the Controller

**Why outbound-only is critical for bare metal:**
- Bare metal clusters behind firewalls don't need inbound ports opened
- The controller doesn't need to "reach into" your datacenter
- This makes it firewall-friendly and secure

---

## 3. What Rafay Does — Full Feature Set

### 3.1 Cluster Lifecycle Management
- **Provision:** Create new K8s clusters (with RKE2, kubeadm, or import existing)
- **Upgrade:** Rolling K8s version upgrades across all clusters
- **Scale:** Add/remove nodes from managed clusters
- **Decommission:** Clean teardown of clusters
- **Backup/Restore:** Integrated cluster state backup (using Velero)

### 3.2 GitOps — Continuous Delivery for K8s
Rafay has a built-in GitOps engine (using **Flux** or **ArgoCD** under the hood).

**How it works:**
```
Engineer pushes to Git repo
    ↓ (webhook)
Rafay GitOps detects change
    ↓
Evaluates which clusters should receive this change
    ↓
Rafay Agents on target clusters apply the change
    ↓
Status reported back to Rafay UI
```

You define **workloads** (Helm charts, raw YAML, Kustomize) and **blueprints** (what should be installed on each cluster type). Changes to Git automatically propagate.

### 3.3 RBAC — Role-Based Access Control
Rafay's RBAC layer sits ABOVE Kubernetes's own RBAC and provides:

| Level | What You Control |
|---|---|
| **Organization** | Top-level account |
| **Project** | Group of clusters and teams |
| **Cluster** | Individual K8s cluster |
| **Namespace** | K8s namespace within a cluster |

**Tenant model in Rafay:**
- Each tenant gets their own **Project** in Rafay
- Within the Project, they see only their clusters/namespaces
- Rafay creates K8s RBAC (Roles, ClusterRoles, RoleBindings) on the clusters automatically
- SSO integration (SAML, OIDC, Active Directory) for enterprise auth

### 3.4 Blueprints — Golden Cluster Templates
A **Blueprint** in Rafay defines what a "standard cluster" looks like:
- Which add-ons are installed (GPU Operator, Cilium, Prometheus, cert-manager)
- Which K8s version
- Which runtime (containerd)
- Which network plugin

When you provision a new cluster from a Blueprint, it automatically gets all these components installed in the right order.

**This is critical for your architecture:** Your boss's standard GPU cluster blueprint would include:
- NVIDIA GPU Operator
- KAI Scheduler
- KubeFlow
- Cilium + Multus
- Prometheus + Grafana
- Velero (backup)

Every new tenant cluster gets this exact configuration automatically.

### 3.5 Zero-Trust Workload Identity
Rafay integrates with cert-manager and SPIFFE/SPIRE for workload identity — each Pod gets a cryptographic identity. This is used for secure service-to-service communication.

---

## 4. Rafay and vClusters

**vCluster** (by Loft Labs) is a technology that creates virtual Kubernetes clusters inside a physical cluster. Each vCluster is a full K8s API server that runs as a Pod.

**Rafay manages vClusters** — when a tenant requests a vCluster (Tenant Request Type 2), Rafay:
1. Creates a new Namespace in the physical cluster
2. Deploys a vCluster (K8s API server + etcd + syncer) in that namespace
3. Configures RBAC so the tenant only sees their vCluster
4. The tenant has full `kubectl` access to their vCluster
5. They can create CRDs, deploy KubeFlow, set up their own GPU quotas

### What the vCluster Tenant Gets
```
Tenant's vCluster (visible to tenant)
├── Full K8s API (they are cluster-admin of their vCluster)
├── KubeFlow (pre-installed)
├── EDA (network automation within their namespace)
├── Custom CRDs (CRD NOPs as mentioned in notes)
├── VRL (Virtual Resource Layer — resource quota enforcement)
└── Their own Pods/Services/Deployments

Physical Cluster (hidden from tenant, managed by Rafay)
├── vCluster Pod (the tenant's K8s API server)
├── GPU resources allocated to this vCluster's namespace
├── Network policies enforcing isolation
└── Rafay Agent (managing everything)
```

### vCluster Isolation Levels
| Isolation | vCluster Default | Your Platform Config |
|---|---|---|
| **Namespace** | ✅ Isolated | ✅ |
| **K8s API** | ✅ Fully separate | ✅ |
| **Network** | ⚠️ Shared (physical) | Configure NetworkPolicy |
| **GPU Resources** | ⚠️ Shared (physical) | ResourceQuota + KAI Queue |
| **Storage** | ⚠️ Shared (physical) | StorageClass + PVC quotas |

---

## 5. JNPaaS / SSP — Rafay's Self-Service Portal

**SSP (Self-Service Portal)** or **JNPaaS (Jupyter Notebook PaaS)** in your architecture refers to the tenant-facing portal built on/with Rafay.

Tenants can:
- Browse available GPU resources
- Request a Jupyter Notebook with specific GPU allocation
- Request a vCluster
- Request a training job
- View their resource usage and billing/quota

Under the hood, the SSP talks to Rafay's API to:
- Create KubeFlow Notebook CRDs
- Provision vClusters
- Set up RBAC
- Configure GPU quotas via KAI Scheduler Queues

---

## 6. Rafay Competitors / Alternatives

| Platform | Notes | Comparison |
|---|---|---|
| **Rancher (SUSE)** | Most popular open-source K8s management | Strong competitor, free but less enterprise polish |
| **Spectro Cloud (Palette)** | Multi-cluster, GitOps, blueprint-driven | Very similar feature set to Rafay |
| **Google Anthos** | Google's multi-cluster platform | Cloud-centric, expensive, GCP-native |
| **Red Hat OpenShift** | Enterprise K8s, very feature-rich | Expensive, opinionated, own ecosystem |
| **Kasten K10** | Storage/backup focused (Veeam) | More specialized, not a full cluster manager |
| **ArgoCD + Flux** | Pure GitOps tools, not full management | DIY approach, more work to set up |

### Why Rafay (over the above)
1. **Bare metal first** — designed to work with physical servers, not just cloud
2. **GPU-aware blueprints** — pre-built support for NVIDIA GPU clusters
3. **Agent model** — works behind firewalls, no inbound ports needed
4. **vCluster integration** — native support for virtual cluster provisioning
5. **SSP / JNPaaS** — tenant self-service is a core Rafay feature

---

## 7. Rafay in Your Standard Architecture

```
RAFAY CONTROLLER (SaaS or self-hosted)
│
├── Organization: YourCompany
│   ├── Project: Client-A
│   │   ├── Blueprint: gpu-cluster-v1 (H100, GPU Operator, KubeFlow, KAI)
│   │   ├── Cluster: client-a-prod (bare metal, 64 GPUs)
│   │   └── Tenant: alice (vCluster), bob (shared), charlie (bare metal node)
│   │
│   ├── Project: Client-B
│   │   ├── Blueprint: gpu-cluster-v1
│   │   └── Cluster: client-b-prod (bare metal, 32 GPUs)
│   │
│   └── Project: Infra
│       ├── Cluster: management (control plane for Rafay agents)
│       └── Cluster: monitoring (Prometheus, Grafana, Loki)
│
└── GitOps Repos
    ├── platform-config (cluster blueprints, add-ons)
    ├── tenant-configs (per-tenant namespace configs)
    └── workload-templates (KubeFlow, KAI Queue definitions)
```

---

## 8. Key Rafay Terms Quick Reference

| Term | Meaning |
|---|---|
| **Controller** | Central Rafay management plane |
| **Agent** | Pod running in each managed cluster |
| **Blueprint** | Cluster configuration template |
| **Project** | Tenant grouping unit |
| **Workload** | Any Helm chart or YAML managed by Rafay GitOps |
| **Add-on** | Cluster-level component (GPU Operator, Cilium etc.) |
| **Fleet** | All clusters managed by one Rafay org |
| **SSP** | Self-Service Portal for tenant access |
| **OPA** | Open Policy Agent — policy engine integrated with Rafay |

---

## Decisions to be Made for Reference Architecture
### 1. Multi-Cluster Management & Orchestration
You need a "single pane of glass" to manage the lifecycle of your bare-metal clusters, handle tenant access, and enforce global policies.
*   **Decision:** Confirm the adoption of the **Rafay Platform** as your top-level control plane. This locks in the hub-and-spoke agent architecture for cluster management.

### 2. Deployment Model (SaaS vs Self-Hosted)
Rafay can be consumed in two ways.
*   **Decision:** Will you use the **Rafay SaaS** controller (easier, fully managed by Rafay, but metadata leaves your datacenter) or a **Self-Hosted** deployment (complex to manage, but fully air-gapped/on-premise)?

### 3. vCluster Isolation Boundaries
When tenants request a vCluster (virtual K8s cluster), they share physical hardware. You must define the strictness of that isolation.
*   **Decision:** Determine if vClusters will have strict network policies isolating them from other vClusters (via Cilium) and confirm the use of a Virtual Resource Layer (VRL) to hard-cap their GPU usage so they cannot consume the entire physical cluster.

### 4. GitOps Engine
Rafay handles GitOps for deploying configuration, but you must choose the underlying engine.
*   **Decision:** Confirm if the platform will standardize on **Flux** or **ArgoCD** for syncing your cluster blueprints and workload definitions from Git to the clusters.

---
*Next: See `08_storage.md` for hot/cold/block storage architecture.*
