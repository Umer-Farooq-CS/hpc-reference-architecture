# High-Level RFP Requirements Baseline

> Part of the [Chosen Architecture](index.md) specification.

---

The overall reference architecture is sized to meet the following primary Request for Proposal (RFP) baseline requirements:

| Parameter | RFP Target Value | Description |
|---|---|---|
| **Tenants Supported** | **110 Tenants** | Multi-tenant isolation model (Shared Clusters, vClusters, Bare Metal) |
| **GPU Capacity** | **64 GPUs** | Enterprise AI/ML training & inference compute capacity |
| **Total Storage** | **1 PB Storage** | Multi-tiered storage framework (Hot NVMe + Cold S3 Object Storage) |

> *Note: Storage architecture details (1 PB breakdown) will be defined in a subsequent design phase. The design below details the confirmed Hardware and Networking architecture for the 64 GPUs.*

---
*Back to [Chosen Architecture Index](index.md)*
