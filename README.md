# CephSync Enterprise: Ceph RGW Deployment & S3 Sync Engine

[![CI S3 Scheduled Sync](https://img.shields.io/badge/CI%2FCD-GitHub%20Actions-blue?logo=github-actions)](https://github.com/)
[![Ceph Version](https://img.shields.io/badge/Ceph-Pacific%20%7C%20Quincy%20%7C%20Reef%20%7C%20Squid-red?logo=ceph)](https://ceph.io/)
[![Python 3.9+](https://img.shields.io/badge/Python-3.9%20%7C%203.10%20%7C%203.11%20%7C%203.12-yellow?logo=python)](https://python.org/)
[![License: Apache 2.0](https://img.shields.io/badge/License-Apache%202.0-green.svg)](LICENSE)
[![Code Style: Black](https://img.shields.io/badge/code%20style-black-000000.svg)](https://github.com/psf/black)

A production-grade, open-source infrastructure and data synchronization framework designed for Ceph Object Gateway (RGW) enterprise environments. This project delivers end-to-end automation for:

1. **Ceph RGW 3-Node Orchestration:** Automated bootstrapping of Ceph Object Gateway services across a 3-node cluster utilizing `ceph orch apply rgw`, initializing `default.zonegroup.zone` topology for standalone or multi-site replication.
2. **High-Performance S3 Sync Engine:** An enterprise Python utility (`boto3`) featuring concurrent worker threads, memory-bounded streaming multipart upload, incremental comparison, full-jitter exponential backoff, and structured JSON telemetry.
3. **Automated CI/CD Cron Pipeline:** GitHub Actions workflow executing scheduled synchronizations (daily at 02:00 UTC) with full `workflow_dispatch` manual controls and artifact retention.

---

## 🏛️ Architecture Overview

```
                        ┌────────────────────────────────────────────────────────┐
                        │             Primary Ceph Storage Cluster               │
                        │                                                        │
                        │  ┌───────────────┐ ┌───────────────┐ ┌───────────────┐ │
                        │  │ ceph-node01   │ │ ceph-node02   │ │ ceph-node03   │ │
                        │  │ (Mon/Mgr/OSD) │ │ (Mon/Mgr/OSD) │ │ (Mon/Mgr/OSD) │ │
                        │  │  [RGW :8080]  │ │  [RGW :8080]  │ │  [RGW :8080]  │ │
                        │  └───────▲───────┘ └───────▲───────┘ └───────▲───────┘ │
                        │          │                 │                 │         │
                        │          └─────────────────┼─────────────────┘         │
                        │                            │                           │
                        │           HAProxy / Keepalived VIP (:80 / :443)        │
                        │           Realm: production-realm                      │
                        │           Zonegroup: default                           │
                        │           Zone: default (master)                       │
                        └────────────────────────────┬───────────────────────────┘
                                                     │
                                       boto3 (HTTPS / S3 API)
                                                     │
                                 ┌───────────────────▼──────────────────┐
                                 │      CephSync Engine (Python)        │
                                 │   - ThreadPoolExecutor Workers       │
                                 │   - Incremental ETag/Timestamp Diff  │
                                 │   - Streamed Multipart (Zero Disk)   │
                                 │   - Full-Jitter Exponential Backoff  │
                                 │   - Structured JSON Line Telemetry   │
                                 └───────────────────┬──────────────────┘
                                                     │
                                                     │ Streamed Sync
                                                     ▼
                        ┌────────────────────────────────────────────────────────┐
                        │              Backup / Disaster Recovery Target         │
                        │                                                        │
                        │   - Secondary Ceph RGW Cluster (Remote DC / Cloud)     │
                        │   - AWS S3 Standard / Glacier-Instant / S3-Compatible │
                        │   - Bucket: dr-backup-assets                           │
                        └────────────────────────────────────────────────────────┘
```

---

## 📂 Repository Structure

```
├── .github/
│   └── workflows/
│       └── sync.yml                 # Automated daily cron & manual dispatch pipeline
├── deploy/
│   ├── ceph-rgw-bootstrap.sh        # Modular Bash orchestrator for 3-node RGW & zones
│   ├── specs/
│   │   └── rgw-service.yml          # Declarative Cephadm RGW and HA Ingress spec
│   └── ansible/
│       ├── inventory.ini            # Ansible inventory for 3-node Ceph cluster
│       └── site.yml                 # Production Ansible playbook for RGW orchestration
├── sync_engine/
│   ├── Dockerfile                   # Unprivileged container image for production runners
│   ├── requirements.txt             # Python dependencies (boto3, botocore, urllib3)
│   └── sync_engine.py               # Enterprise S3 synchronization CLI utility
├── .env.example                     # Environment variable blueprint (Zero hardcoded secrets)
├── LICENSE                          # Apache 2.0 Open Source License
└── README.md                        # Documentation & Runbook
```

---

## ⚡ Quickstart: Part 1 — Deploy Ceph RGW (3-Node Cluster)

### Prerequisites
- A functioning Ceph cluster (Pacific, Quincy, Reef, or Squid) with `cephadm` and `ceph orch` enabled.
- 3 labeled cluster nodes with network connectivity on the RGW port (default: `8080` or `443`).
- Administrative privileges with access to `/etc/ceph/ceph.client.admin.keyring`.

### Option A: Automated Bash Bootstrap
Run the idempotent bootstrap script on your Ceph management / admin node:

```bash
# Clone the repository
git clone https://github.com/your-org/cephsync-enterprise.git
cd cephsync-enterprise

# Make executable and run
chmod +x deploy/ceph-rgw-bootstrap.sh

# Optional: customize nodes or ports
export CEPH_NODE_1="ceph-node01"
export CEPH_NODE_2="ceph-node02"
export CEPH_NODE_3="ceph-node03"
export RGW_PORT="8080"
export REALM_NAME="production-realm"

# Execute
./deploy/ceph-rgw-bootstrap.sh
```

**What the script automates:**
1. Verifies Ceph cluster quorum and health (`ceph health detail`).
2. Applies the `rgw` orchestrator label across the 3 designated cluster nodes.
3. Initializes the multi-site realm (`production-realm`), default zonegroup, and default zone with multi-endpoint routing.
4. Commits the RGW period (`radosgw-admin period update --commit`).
5. Deploys 3 RGW Beast frontends using `ceph orch apply rgw`.
6. Generates a dedicated S3 system synchronization user with restricted keys and writes `s3_credentials.env` with `0600` permissions.

### Option B: Declarative Cephadm Service Spec
If your cluster uses declarative GitOps specs:

```bash
ceph orch apply -i deploy/specs/rgw-service.yml
```

### Option C: Ansible Playbook Execution
```bash
ansible-playbook -i deploy/ansible/inventory.ini deploy/ansible/site.yml
```

---

## 🚀 Quickstart: Part 2 — Python S3 Sync Engine

The sync engine uses zero-disk streaming multipart uploads, comparing ETags and timestamps to synchronize only modified or missing objects.

### 1. Installation
```bash
cd sync_engine
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

### 2. Configure Environment Variables
Never commit credentials to Git. Export them into your shell or execution environment:

```bash
# Primary Ceph RGW Cluster
export SOURCE_S3_ENDPOINT_URL="http://192.168.10.11:8080"
export SOURCE_S3_ACCESS_KEY="SOURCE_ACCESS_KEY_EXAMPLE"
export SOURCE_S3_SECRET_KEY="SOURCE_SECRET_KEY_EXAMPLE"
export SOURCE_S3_REGION_NAME="default"
export SOURCE_S3_VERIFY_SSL="false"   # Set to true if using CA-signed TLS

# Target S3 Cluster or AWS S3
# Note: For AWS S3, omit or leave DEST_S3_ENDPOINT_URL empty.
export DEST_S3_ENDPOINT_URL="https://s3.us-east-1.amazonaws.com"
export DEST_S3_ACCESS_KEY="DEST_ACCESS_KEY_EXAMPLE"
export DEST_S3_SECRET_KEY="DEST_SECRET_KEY_EXAMPLE"
export DEST_S3_REGION_NAME="us-east-1"
export DEST_S3_VERIFY_SSL="true"

# Engine Parameters
export LOG_LEVEL="INFO"
export SYNC_WORKERS="16"
```

### 3. CLI Usage & Examples

```bash
# Dry run simulation (no writes or deletions)
python3 sync_engine.py \
  --source-bucket production-primary-assets \
  --dest-bucket dr-backup-assets \
  --dry-run

# Full incremental sync with 16 parallel threads
python3 sync_engine.py \
  --source-bucket production-primary-assets \
  --dest-bucket dr-backup-assets \
  --sync-mode both \
  --workers 16 \
  --multipart-threshold-mb 16 \
  --chunk-size-mb 8

# Sync specific subfolder prefix with orphan deletion (exact mirror)
python3 sync_engine.py \
  --source-bucket production-primary-assets \
  --dest-bucket dr-backup-assets \
  --prefix "backups/database-snapshots/" \
  --delete-orphans
```

### 4. Running via Docker
```bash
docker build -t cephsync:latest -f sync_engine/Dockerfile .

docker run --rm \
  --env-file .env \
  cephsync:latest \
  --source-bucket production-primary-assets \
  --dest-bucket dr-backup-assets \
  --workers 12
```

---

## 🤖 Quickstart: Part 3 — CI/CD & Scheduled Cron Pipeline

The workflow in `.github/workflows/sync.yml` is configured for automated disaster recovery synchronization.

### 1. Configure GitHub Actions Secrets
Navigate to **GitHub Repository -> Settings -> Secrets and variables -> Actions** and create the following repository secrets:

| Secret Name | Description | Example Value |
|---|---|---|
| `SOURCE_S3_ENDPOINT_URL` | URL to Primary Ceph RGW | `https://s3.prod.internal:8080` |
| `SOURCE_S3_ACCESS_KEY` | Primary S3 Access Key ID | `07J...ABCD` |
| `SOURCE_S3_SECRET_KEY` | Primary S3 Secret Key | `9F1...XYZ` |
| `DEST_S3_ENDPOINT_URL` | Destination S3 Endpoint (blank for AWS) | `https://s3.us-east-1.amazonaws.com` |
| `DEST_S3_ACCESS_KEY` | Destination S3 Access Key ID | `AKIA...` |
| `DEST_S3_SECRET_KEY` | Destination S3 Secret Key | `wJalr...` |

### 2. Scheduled Cron Trigger
The workflow executes automatically every day at `02:00 UTC` (`cron: '0 2 * * *'`).

### 3. Manual Workflow Dispatch
You can trigger synchronization on-demand from the GitHub Actions UI:
1. Go to **Actions** -> **Ceph RGW to S3 Scheduled Sync**.
2. Click **Run workflow**.
3. Select options:
   - Source bucket
   - Destination bucket
   - Sync mode (`both`, `etag`, or `timestamp`)
   - Dry run checkbox
   - Delete orphans checkbox
   - Concurrency workers

---

## 📊 Structured JSON Logging & Observability

Every operation generates standard JSON Lines format suitable for parsing by Fluentbit, Datadog, Vector, or Elasticsearch:

```json
{
  "timestamp": "2026-10-17T08:15:32.418291+00:00",
  "level": "INFO",
  "component": "sync_engine",
  "message": "Object synchronized successfully",
  "key": "archives/2026/db_backup_0912.tar.gz",
  "size_bytes": 104857600,
  "duration_ms": 1420.35,
  "reason": "object_missing_in_target",
  "multipart": true
}
```

Final execution summary log:
```json
{
  "timestamp": "2026-10-17T08:15:45.109823+00:00",
  "level": "INFO",
  "component": "sync_engine",
  "message": "Synchronization run finished",
  "total_scanned": 15420,
  "total_transferred": 348,
  "total_skipped": 15072,
  "total_failed": 0,
  "total_deleted": 0,
  "total_bytes_transferred": 42949672960,
  "duration_seconds": 182.4,
  "throughput_mb_s": 22.45,
  "status": "SUCCESS"
}
```

---

## 🛡️ Production Hardening & Disaster Recovery Best Practices

1. **HA Ingress Load Balancing:** For production clusters, do not point traffic directly to a single RGW node. Deploy HAProxy + Keepalived using `deploy/specs/rgw-service.yml` to provide a Virtual IP (VIP) with automatic health checking.
2. **Beast Web Server Tuning:** Ceph RGW defaults to the high-concurrency `beast` frontend. In `/etc/ceph/ceph.conf` or orchestrator configs, tune:
   ```ini
   rgw_frontends = "beast endpoint=0.0.0.0:8080 max_connection=4096 max_header_size=65536"
   ```
3. **Multipart Orphan Garbage Collection:** Failed or interrupted multipart uploads leave hidden parts in the `.rgw.buckets.non-ec` pool. The sync engine automatically issues `AbortMultipartUpload` on exceptions. You can audit orphaned multipart uploads periodically with:
   ```bash
   radosgw-admin multipart list --bucket=production-primary-assets
   ```
4. **Bucket Index Sharding:** For buckets storing more than 100,000 objects, configure dynamic bucket index sharding to prevent OSD peon locks:
   ```bash
   radosgw-admin bucket limit check
   radosgw-admin bucket reshard --bucket=production-primary-assets --num-shards=64
   ```

---

## 📄 License
This project is licensed under the Apache License 2.0. See [LICENSE](LICENSE) for details.
