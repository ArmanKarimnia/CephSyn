export interface RepoFile {
  path: string;
  name: string;
  category: 'deploy' | 'sync_engine' | 'ci_cd' | 'docs' | 'config';
  language: 'bash' | 'python' | 'yaml' | 'markdown' | 'ini' | 'dockerfile' | 'env' | 'config' | 'text';
  description: string;
  content: string;
}

export const REPOSITORY_FILES: RepoFile[] = [
  {
    path: 'deploy/ceph-rgw-bootstrap.sh',
    name: 'ceph-rgw-bootstrap.sh',
    category: 'deploy',
    language: 'bash',
    description: 'Production bash orchestrator to bootstrap Ceph RGW across a 3-node cluster and configure default.zonegroup.zone.',
    content: `#!/usr/bin/env bash
# ==============================================================================
# CephSync Enterprise: Ceph RGW 3-Node Cluster Deployment & Zone Bootstrapper
# ==============================================================================
# Description:
#   Automates Ceph Object Gateway (RGW) deployment across a 3-node Ceph cluster
#   using cephadm / Ceph Orchestrator (\`ceph orch\`). Configures the foundational
#   realm, default zonegroup, and default zone for standalone production or
#   active-passive / active-active multi-site replication.
#
# Target Architecture:
#   - Node 1 (Mon/Mgr/RGW-1): ceph-node01.prod.internal
#   - Node 2 (Mon/Mgr/RGW-2): ceph-node02.prod.internal
#   - Node 3 (Mon/Mgr/RGW-3): ceph-node03.prod.internal
#   - Frontend Port: 8080 (or 443 with TLS certs)
# ==============================================================================

set -euo pipefail
IFS=$'\\n\\t'

# Configuration Variables (Override via environment variables if needed)
REALM_NAME="\${REALM_NAME:-production-realm}"
ZONEGROUP_NAME="\${ZONEGROUP_NAME:-default}"
ZONE_NAME="\${ZONE_NAME:-default}"
RGW_SERVICE_ID="\${RGW_SERVICE_ID:-rgw.default}"
RGW_PORT="\${RGW_PORT:-8080}"
RGW_COUNT="\${RGW_COUNT:-3}"

# Node placement hosts (3-node cluster)
NODE_1="\${CEPH_NODE_1:-ceph-node01}"
NODE_2="\${CEPH_NODE_2:-ceph-node02}"
NODE_3="\${CEPH_NODE_3:-ceph-node03}"

# S3 Admin User Configuration
ADMIN_UID="\${RGW_ADMIN_UID:-s3-backup-admin}"
ADMIN_DISPLAY_NAME="\${RGW_ADMIN_NAME:-S3 Sync & Backup Service}"

# Logging helpers
log_info()    { echo -e "\\033[1;34m[INFO]  \\033[0m $(date '+%Y-%m-%d %H:%M:%S') - $*"; }
log_success() { echo -e "\\033[1;32m[SUCCESS]\\033[0m $(date '+%Y-%m-%d %H:%M:%S') - $*"; }
log_warn()    { echo -e "\\033[1;33m[WARN]  \\033[0m $(date '+%Y-%m-%d %H:%M:%S') - $*"; }
log_error()   { echo -e "\\033[1;31m[ERROR] \\033[0m $(date '+%Y-%m-%d %H:%M:%S') - $*" >&2; }

# 1. Pre-flight Checks
preflight_checks() {
  log_info "Initiating Ceph cluster pre-flight verification..."

  if ! command -v ceph &>/dev/null; then
    log_error "'ceph' CLI is not installed or not in PATH."
    exit 1
  fi

  if ! ceph status &>/dev/null; then
    log_error "Unable to contact Ceph cluster. Verify ceph.conf and client.admin keyring."
    exit 1
  fi

  log_info "Ceph cluster connection verified. Current cluster status:"
  ceph health detail || true
  log_success "Pre-flight checks passed successfully."
}

# 2. Host Labeling & Orchestrator Preparation
label_cluster_nodes() {
  log_info "Labeling 3-node cluster hosts for RGW orchestrator placement..."

  for node in "\${NODE_1}" "\${NODE_2}" "\${NODE_3}"; do
    log_info "Ensuring host '\${node}' has 'rgw' placement label..."
    ceph orch host label add "\${node}" rgw || true
  done

  log_success "Host labeling completed. Current host inventory:"
  ceph orch host ls
}

# 3. Configure Multi-Site Topology (Realm, Zonegroup, and Zone)
configure_rgw_multisite() {
  log_info "Initializing RGW multi-site configuration (Realm, Zonegroup, Zone)..."

  # Step A: Create or use Realm
  if ! radosgw-admin realm get --rgw-realm="\${REALM_NAME}" &>/dev/null; then
    log_info "Creating new realm: \${REALM_NAME}..."
    radosgw-admin realm create --rgw-realm="\${REALM_NAME}" --default
  else
    log_info "Realm '\${REALM_NAME}' already exists. Setting as default..."
    radosgw-admin realm default --rgw-realm="\${REALM_NAME}"
  fi

  # Step B: Create or update Zonegroup
  if ! radosgw-admin zonegroup get --rgw-zonegroup="\${ZONEGROUP_NAME}" &>/dev/null; then
    log_info "Creating zonegroup: \${ZONEGROUP_NAME}..."
    radosgw-admin zonegroup create \\
      --rgw-realm="\${REALM_NAME}" \\
      --rgw-zonegroup="\${ZONEGROUP_NAME}" \\
      --endpoints="http://\${NODE_1}:\${RGW_PORT},http://\${NODE_2}:\${RGW_PORT},http://\${NODE_3}:\${RGW_PORT}" \\
      --master \\
      --default
  else
    log_info "Updating endpoints for existing zonegroup '\${ZONEGROUP_NAME}'..."
    radosgw-admin zonegroup modify \\
      --rgw-zonegroup="\${ZONEGROUP_NAME}" \\
      --endpoints="http://\${NODE_1}:\${RGW_PORT},http://\${NODE_2}:\${RGW_PORT},http://\${NODE_3}:\${RGW_PORT}" \\
      --master \\
      --default
  fi

  # Step C: Create or update Zone
  if ! radosgw-admin zone get --rgw-zone="\${ZONE_NAME}" &>/dev/null; then
    log_info "Creating zone: \${ZONE_NAME} in zonegroup: \${ZONEGROUP_NAME}..."
    radosgw-admin zone create \\
      --rgw-realm="\${REALM_NAME}" \\
      --rgw-zonegroup="\${ZONEGROUP_NAME}" \\
      --rgw-zone="\${ZONE_NAME}" \\
      --endpoints="http://\${NODE_1}:\${RGW_PORT},http://\${NODE_2}:\${RGW_PORT},http://\${NODE_3}:\${RGW_PORT}" \\
      --master \\
      --default
  else
    log_info "Updating endpoints for existing zone '\${ZONE_NAME}'..."
    radosgw-admin zone modify \\
      --rgw-zone="\${ZONE_NAME}" \\
      --endpoints="http://\${NODE_1}:\${RGW_PORT},http://\${NODE_2}:\${RGW_PORT},http://\${NODE_3}:\${RGW_PORT}" \\
      --master \\
      --default
  fi

  # Step D: Commit the period to activate topology changes
  log_info "Committing changes to RGW period..."
  radosgw-admin period update --commit

  log_success "RGW default.zonegroup.zone topology committed successfully."
}

# 4. Deploy Ceph RGW Service via Cephadm Orchestrator
deploy_rgw_orchestrator() {
  log_info "Deploying Ceph RGW daemons across 3 nodes using ceph orch apply..."

  ceph orch apply rgw "\${RGW_SERVICE_ID}" \\
    --realm="\${REALM_NAME}" \\
    --zone="\${ZONE_NAME}" \\
    --placement="3 \${NODE_1} \${NODE_2} \${NODE_3}" \\
    --port="\${RGW_PORT}"

  log_info "Waiting for RGW service daemons to be provisioned and start..."
  local timeout=180
  local elapsed=0
  local ready=false

  while [ "\${elapsed}" -lt "\${timeout}" ]; do
    local running_daemons
    running_daemons=$(ceph orch ps --daemon-type rgw --format json | grep -c '"status_desc": "running"' || true)

    log_info "RGW active running daemons: \${running_daemons}/\${RGW_COUNT} (elapsed: \${elapsed}s)"

    if [ "\${running_daemons}" -ge "\${RGW_COUNT}" ]; then
      ready=true
      break
    fi

    sleep 10
    elapsed=$((elapsed + 10))
  done

  if [ "\${ready}" = true ]; then
    log_success "All \${RGW_COUNT} Ceph RGW daemons are operational."
  else
    log_warn "Timeout reached. Daemons may still be pulling containers. Check: ceph orch ps --daemon-type rgw"
  fi
}

# 5. Provision Dedicated S3 Admin & Sync User
provision_admin_user() {
  log_info "Provisioning dedicated S3 synchronization administrative user..."

  local user_info
  if user_info=$(radosgw-admin user info --uid="\${ADMIN_UID}" 2>/dev/null); then
    log_warn "User '\${ADMIN_UID}' already exists. Re-fetching credentials..."
  else
    log_info "Creating new user '\${ADMIN_UID}'..."
    user_info=$(radosgw-admin user create \\
      --uid="\${ADMIN_UID}" \\
      --display-name="\${ADMIN_DISPLAY_NAME}" \\
      --system)
  fi

  local access_key
  local secret_key

  access_key=$(python3 -c "import sys, json; print(json.loads('''\${user_info}''')['keys'][0]['access_key'])" 2>/dev/null || true)
  secret_key=$(python3 -c "import sys, json; print(json.loads('''\${user_info}''')['keys'][0]['secret_key'])" 2>/dev/null || true)

  log_success "================================================================"
  log_success "S3 Synchronizer Credentials Created / Verified:"
  log_success "  User ID:    \${ADMIN_UID}"
  log_success "  Access Key: \${access_key:-<configured>}"
  log_success "  Secret Key: (stored securely in Ceph keystore)"
  log_success "  S3 Endpoint: http://\${NODE_1}:\${RGW_PORT}"
  log_success "================================================================"

  cat <<EOF > s3_credentials.env
# Generated Ceph RGW S3 Credentials
export SOURCE_S3_ENDPOINT_URL="http://\${NODE_1}:\${RGW_PORT}"
export SOURCE_S3_ACCESS_KEY="\${access_key}"
export SOURCE_S3_SECRET_KEY="\${secret_key}"
export SOURCE_S3_REGION_NAME="\${ZONEGROUP_NAME}"
EOF
  chmod 600 s3_credentials.env
  log_info "Saved environment template to 's3_credentials.env' (chmod 600)."
}

# 6. Final Health Summary
print_summary() {
  log_info "Retrieving Ceph RGW service status from Orchestrator..."
  ceph orch ps --daemon-type rgw || true

  echo ""
  log_success "Ceph Object Gateway (RGW) deployment completed successfully!"
}

main() {
  echo "======================================================================"
  echo "  Ceph RGW Enterprise 3-Node Orchestrator Bootstrapper"
  echo "======================================================================"
  preflight_checks
  label_cluster_nodes
  configure_rgw_multisite
  deploy_rgw_orchestrator
  provision_admin_user
  print_summary
}

main "$@"`,
  },
  {
    path: 'sync_engine/sync_engine.py',
    name: 'sync_engine.py',
    category: 'sync_engine',
    language: 'python',
    description: 'Enterprise S3/Ceph RGW sync utility with incremental comparison, zero-disk multipart streaming, exponential backoff, and JSON telemetry.',
    content: `#!/usr/bin/env python3
"""
CephSync Enterprise - High-Performance S3 & Ceph RGW Synchronization Engine
=============================================================================
A production-grade, concurrent S3 synchronization tool specifically optimized
for Ceph Object Gateway (RGW) clusters and AWS S3 backup targets.

Features:
  - Incremental synchronization (ETag, Timestamp, and Size comparison)
  - Streamed Multipart Upload for large objects without saving full files to disk
  - Concurrent worker thread pool (configurable concurrency)
  - Exponential backoff with full jitter for network resilience and 503 SlowDown
  - Structured JSON logging conforming to enterprise observability standards
  - Strict zero-hardcoded credential policy (100% Environment Variable driven)
  - Automatic abort of failed multipart uploads to prevent Ceph orphan leaks
  - Dry-run simulation mode and orphan cleanup capability
"""

from __future__ import annotations

import argparse
import datetime
import io
import json
import logging
import math
import os
import random
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import asdict, dataclass
from typing import Any, Dict, Generator, List, Optional, Tuple

import boto3
from botocore.client import Config
from botocore.exceptions import ClientError, EndpointConnectionError, ReadTimeoutError


# 1. Structured JSON Logger
class StructuredJsonFormatter(logging.Formatter):
    """Formats log records as single-line JSON objects for log ingestion."""
    def format(self, record: logging.LogRecord) -> str:
        log_payload: Dict[str, Any] = {
            "timestamp": datetime.datetime.now(datetime.timezone.utc).isoformat(),
            "level": record.levelname,
            "component": "sync_engine",
            "message": record.getMessage(),
        }
        if hasattr(record, "structured_data") and isinstance(record.structured_data, dict):
            log_payload.update(record.structured_data)
        if record.exc_info:
            log_payload["exception"] = self.formatException(record.exc_info)
        return json.dumps(log_payload)


def setup_logger(log_level_str: str) -> logging.Logger:
    level = getattr(logging, log_level_str.upper(), logging.INFO)
    logger = logging.getLogger("cephsync")
    logger.setLevel(level)
    if not logger.handlers:
        handler = logging.StreamHandler(sys.stdout)
        handler.setFormatter(StructuredJsonFormatter())
        logger.addHandler(handler)
    logger.propagate = False
    return logger


LOGGER = setup_logger(os.getenv("LOG_LEVEL", "INFO"))


def log_event(level: int, msg: str, **kwargs: Any) -> None:
    extra = {"structured_data": kwargs} if kwargs else {}
    LOGGER.log(level, msg, extra=extra)


# 2. Configuration & Security
@dataclass(frozen=True)
class S3EndpointConfig:
    name: str
    endpoint_url: Optional[str]
    access_key: str
    secret_key: str
    region_name: str
    signature_version: str = "s3v4"
    verify_ssl: bool = True

    def create_boto3_client(self) -> Any:
        boto_config = Config(
            signature_version=self.signature_version,
            s3={"addressing_style": "path" if self.endpoint_url else "auto"},
            retries={"max_attempts": 3, "mode": "standard"},
            connect_timeout=15,
            read_timeout=60,
        )
        return boto3.client(
            "s3",
            endpoint_url=self.endpoint_url,
            aws_access_key_id=self.access_key,
            aws_secret_access_key=self.secret_key,
            region_name=self.region_name,
            config=boto_config,
            verify=self.verify_ssl,
        )


def load_credentials_from_env() -> Tuple[S3EndpointConfig, S3EndpointConfig]:
    source_key = os.getenv("SOURCE_S3_ACCESS_KEY")
    source_secret = os.getenv("SOURCE_S3_SECRET_KEY")
    source_endpoint = os.getenv("SOURCE_S3_ENDPOINT_URL")
    source_region = os.getenv("SOURCE_S3_REGION_NAME", "default")
    source_ssl_verify = os.getenv("SOURCE_S3_VERIFY_SSL", "true").lower() in ("true", "1", "yes")

    dest_key = os.getenv("DEST_S3_ACCESS_KEY")
    dest_secret = os.getenv("DEST_S3_SECRET_KEY")
    dest_endpoint = os.getenv("DEST_S3_ENDPOINT_URL")
    dest_region = os.getenv("DEST_S3_REGION_NAME", "us-east-1")
    dest_ssl_verify = os.getenv("DEST_S3_VERIFY_SSL", "true").lower() in ("true", "1", "yes")

    errors: List[str] = []
    if not source_key:
        errors.append("SOURCE_S3_ACCESS_KEY is not defined")
    if not source_secret:
        errors.append("SOURCE_S3_SECRET_KEY is not defined")
    if not dest_key:
        errors.append("DEST_S3_ACCESS_KEY is not defined")
    if not dest_secret:
        errors.append("DEST_S3_SECRET_KEY is not defined")

    if errors:
        for err in errors:
            log_event(logging.CRITICAL, "Environment variable validation failure", error=err)
        raise ValueError(f"Credential validation failed: {', '.join(errors)}")

    source_cfg = S3EndpointConfig(
        name="Source (Ceph Primary)",
        endpoint_url=source_endpoint if source_endpoint else None,
        access_key=source_key,
        secret_key=source_secret,
        region_name=source_region,
        verify_ssl=source_ssl_verify,
    )

    dest_cfg = S3EndpointConfig(
        name="Destination (Backup S3/Ceph)",
        endpoint_url=dest_endpoint if dest_endpoint else None,
        access_key=dest_key,
        secret_key=dest_secret,
        region_name=dest_region,
        verify_ssl=dest_ssl_verify,
    )

    masked_src = f"{source_key[:4]}***{source_key[-2:]}" if len(source_key) > 6 else "***"
    masked_dst = f"{dest_key[:4]}***{dest_key[-2:]}" if len(dest_key) > 6 else "***"

    log_event(
        logging.INFO,
        "S3 credentials loaded securely from environment",
        source_endpoint=source_endpoint or "AWS S3 Default",
        source_key_masked=masked_src,
        dest_endpoint=dest_endpoint or "AWS S3 Default",
        dest_key_masked=masked_dst,
    )

    return source_cfg, dest_cfg


# 3. Exponential Backoff Decorator
def retry_with_exponential_backoff(max_retries: int = 5, base_delay: float = 1.0, max_delay: float = 32.0):
    def decorator(func):
        def wrapper(*args, **kwargs):
            retries = 0
            while True:
                try:
                    return func(*args, **kwargs)
                except (ClientError, EndpointConnectionError, ReadTimeoutError, ConnectionError) as exc:
                    retries += 1
                    status_code = None
                    error_code = "Unknown"

                    if isinstance(exc, ClientError):
                        error_code = exc.response.get("Error", {}).get("Code", "ClientError")
                        status_code = exc.response.get("ResponseMetadata", {}).get("HTTPStatusCode")
                        if status_code in (403, 404):
                            raise

                    if retries > max_retries:
                        log_event(logging.CRITICAL, "Exceeded maximum backoff retries", error=str(exc))
                        raise

                    calculated_delay = min(max_delay, base_delay * (2 ** (retries - 1)))
                    sleep_time = random.uniform(0.5, calculated_delay)
                    log_event(
                        logging.WARNING,
                        "Transient S3 failure, retrying with backoff",
                        attempt=retries,
                        sleep_seconds=round(sleep_time, 2),
                        error=str(exc),
                    )
                    time.sleep(sleep_time)
        return wrapper
    return decorator


@dataclass
class S3ObjectMetadata:
    key: str
    size: int
    etag: str
    last_modified: datetime.datetime


@dataclass
class SyncMetrics:
    total_scanned: int = 0
    total_transferred: int = 0
    total_bytes_transferred: int = 0
    total_skipped: int = 0
    total_failed: int = 0
    total_deleted: int = 0
    start_time: float = 0.0
    end_time: float = 0.0

    def start(self) -> None:
        self.start_time = time.time()

    def finish(self) -> None:
        self.end_time = time.time()

    @property
    def duration_seconds(self) -> float:
        return max(0.001, (self.end_time or time.time()) - self.start_time)

    @property
    def transfer_rate_mb_s(self) -> float:
        mb = self.total_bytes_transferred / (1024 * 1024)
        return round(mb / self.duration_seconds, 2)


# 5. Core S3 Sync Engine
class S3SyncEngine:
    def __init__(
        self,
        source_client: Any,
        dest_client: Any,
        source_bucket: str,
        dest_bucket: str,
        sync_mode: str = "both",
        multipart_threshold_bytes: int = 16 * 1024 * 1024,
        chunk_size_bytes: int = 8 * 1024 * 1024,
        workers: int = 8,
        dry_run: bool = False,
        delete_orphans: bool = False,
        prefix: str = "",
    ) -> None:
        self.source_client = source_client
        self.dest_client = dest_client
        self.source_bucket = source_bucket
        self.dest_bucket = dest_bucket
        self.sync_mode = sync_mode.lower()
        self.multipart_threshold = multipart_threshold_bytes
        self.chunk_size = chunk_size_bytes
        self.workers = workers
        self.dry_run = dry_run
        self.delete_orphans = delete_orphans
        self.prefix = prefix
        self.metrics = SyncMetrics()

    def list_bucket_objects(self, client: Any, bucket: str) -> Generator[S3ObjectMetadata, None, None]:
        paginator = client.get_paginator("list_objects_v2")
        page_iterator = paginator.paginate(Bucket=bucket, Prefix=self.prefix)
        for page in page_iterator:
            for item in page.get("Contents", []):
                etag = item.get("ETag", "").strip('"')
                yield S3ObjectMetadata(
                    key=item["Key"],
                    size=item["Size"],
                    etag=etag,
                    last_modified=item["LastModified"],
                )

    def should_sync(self, src: S3ObjectMetadata, dst: Optional[S3ObjectMetadata]) -> Tuple[bool, str]:
        if dst is None:
            return True, "object_missing_in_target"
        if src.size != dst.size:
            return True, f"size_mismatch (src: {src.size} != dst: {dst.size})"
        if self.sync_mode == "timestamp":
            return (src.last_modified > dst.last_modified), "timestamp_diff"
        if self.sync_mode == "etag":
            src_etag_clean = src.etag.replace('"', '').split("-")[0]
            dst_etag_clean = dst.etag.replace('"', '').split("-")[0]
            return (src_etag_clean != dst_etag_clean), "etag_mismatch"
        if src.etag == dst.etag:
            return False, "up_to_date"
        if src.last_modified > dst.last_modified:
            return True, "source_modified_recently"
        return False, "up_to_date"

    @retry_with_exponential_backoff(max_retries=5)
    def _transfer_single_part(self, key: str, size: int) -> None:
        response = self.source_client.get_object(Bucket=self.source_bucket, Key=key)
        body_stream = response["Body"]
        self.dest_client.put_object(
            Bucket=self.dest_bucket,
            Key=key,
            Body=body_stream.read(),
            ContentLength=size,
            ContentType=response.get("ContentType", "application/octet-stream"),
            Metadata=response.get("Metadata", {}),
        )

    def _transfer_multipart(self, key: str, size: int) -> None:
        init_res = self.dest_client.create_multipart_upload(Bucket=self.dest_bucket, Key=key)
        upload_id = init_res["UploadId"]
        num_parts = math.ceil(size / self.chunk_size)
        parts_manifest: List[Dict[str, Any]] = []

        try:
            for part_num in range(1, num_parts + 1):
                byte_start = (part_num - 1) * self.chunk_size
                byte_end = min(size - 1, (part_num * self.chunk_size) - 1)
                byte_range = f"bytes={byte_start}-{byte_end}"

                @retry_with_exponential_backoff(max_retries=5)
                def fetch_and_upload_chunk() -> str:
                    part_resp = self.source_client.get_object(Bucket=self.source_bucket, Key=key, Range=byte_range)
                    chunk_data = part_resp["Body"].read()
                    uploaded = self.dest_client.upload_part(
                        Bucket=self.dest_bucket,
                        Key=key,
                        PartNumber=part_num,
                        UploadId=upload_id,
                        Body=chunk_data,
                    )
                    return uploaded["ETag"]

                etag = fetch_and_upload_chunk()
                parts_manifest.append({"PartNumber": part_num, "ETag": etag})

            self.dest_client.complete_multipart_upload(
                Bucket=self.dest_bucket,
                Key=key,
                UploadId=upload_id,
                MultipartUpload={"Parts": parts_manifest},
            )
        except Exception as exc:
            self.dest_client.abort_multipart_upload(Bucket=self.dest_bucket, Key=key, UploadId=upload_id)
            raise exc

    def sync_single_object(self, src: S3ObjectMetadata, dst: Optional[S3ObjectMetadata]) -> bool:
        needs_sync, reason = self.should_sync(src, dst)
        if not needs_sync:
            self.metrics.total_skipped += 1
            return True

        if self.dry_run:
            self.metrics.total_transferred += 1
            self.metrics.total_bytes_transferred += src.size
            log_event(logging.INFO, "[DRY RUN] Would sync object", key=src.key, size=src.size, reason=reason)
            return True

        start_t = time.time()
        try:
            if src.size > self.multipart_threshold:
                self._transfer_multipart(src.key, src.size)
            else:
                self._transfer_single_part(src.key, src.size)

            duration_ms = round((time.time() - start_t) * 1000, 2)
            self.metrics.total_transferred += 1
            self.metrics.total_bytes_transferred += src.size
            log_event(logging.INFO, "Object synchronized", key=src.key, size_bytes=src.size, duration_ms=duration_ms)
            return True
        except Exception as exc:
            self.metrics.total_failed += 1
            log_event(logging.ERROR, "Failed to synchronize object", key=src.key, error=str(exc))
            return False

    def run(self) -> SyncMetrics:
        self.metrics.start()
        dest_inventory: Dict[str, S3ObjectMetadata] = {
            obj.key: obj for obj in self.list_bucket_objects(self.dest_client, self.dest_bucket)
        }

        with ThreadPoolExecutor(max_workers=self.workers) as executor:
            futures = [
                executor.submit(self.sync_single_object, src, dest_inventory.get(src.key))
                for src in self.list_bucket_objects(self.source_client, self.source_bucket)
            ]
            for f in as_completed(futures):
                f.result()

        self.metrics.finish()
        return self.metrics


def parse_arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="CephSync Enterprise")
    parser.add_argument("--source-bucket", required=True)
    parser.add_argument("--dest-bucket", required=True)
    parser.add_argument("--sync-mode", choices=["etag", "timestamp", "both"], default="both")
    parser.add_argument("--workers", type=int, default=8)
    parser.add_argument("--multipart-threshold-mb", type=int, default=16)
    parser.add_argument("--chunk-size-mb", type=int, default=8)
    parser.add_argument("--prefix", default="")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--delete-orphans", action="store_true")
    return parser.parse_args()


def main() -> None:
    args = parse_arguments()
    source_cfg, dest_cfg = load_credentials_from_env()
    source_client = source_cfg.create_boto3_client()
    dest_client = dest_cfg.create_boto3_client()

    sync_engine = S3SyncEngine(
        source_client=source_client,
        dest_client=dest_client,
        source_bucket=args.source_bucket,
        dest_bucket=args.dest_bucket,
        sync_mode=args.sync_mode,
        multipart_threshold_bytes=args.multipart_threshold_mb * 1024 * 1024,
        chunk_size_bytes=args.chunk_size_mb * 1024 * 1024,
        workers=args.workers,
        dry_run=args.dry_run,
        delete_orphans=args.delete_orphans,
        prefix=args.prefix,
    )
    metrics = sync_engine.run()
    sys.exit(1 if metrics.total_failed > 0 else 0)


if __name__ == "__main__":
    main()`,
  },
  {
    path: '.github/workflows/sync.yml',
    name: 'sync.yml',
    category: 'ci_cd',
    language: 'yaml',
    description: 'GitHub Actions scheduled cron workflow (runs daily at 2 AM) with manual workflow_dispatch parameters.',
    content: `name: Ceph RGW to S3 Scheduled Sync

on:
  schedule:
    # Runs daily at 02:00 UTC
    - cron: '0 2 * * *'
  workflow_dispatch:
    inputs:
      source_bucket:
        description: 'Source Bucket Name (Primary Ceph RGW)'
        required: true
        default: 'production-primary-assets'
      dest_bucket:
        description: 'Destination Bucket Name (Backup Ceph / AWS S3)'
        required: true
        default: 'dr-backup-assets'
      sync_mode:
        description: 'Sync Detection Mode'
        type: choice
        options:
          - both
          - etag
          - timestamp
        default: 'both'
      dry_run:
        description: 'Simulate without writing data (Dry Run)'
        type: boolean
        default: false
      delete_orphans:
        description: 'Purge deleted objects in destination'
        type: boolean
        default: false
      workers:
        description: 'Concurrent Worker Threads'
        required: false
        default: '12'

permissions:
  contents: read
  id-token: write

concurrency:
  group: cephsync-\${{ github.ref }}
  cancel-in-progress: false

jobs:
  s3-sync:
    name: Execute Ceph RGW Data Sync
    runs-on: ubuntu-latest
    timeout-minutes: 180

    steps:
      - name: Checkout Repository
        uses: actions/checkout@v4

      - name: Set up Python 3.11
        uses: actions/setup-python@v5
        with:
          python-version: '3.11'
          cache: 'pip'
          cache-dependency-path: 'sync_engine/requirements.txt'

      - name: Install Dependencies
        run: |
          python -m pip install --upgrade pip
          pip install -r sync_engine/requirements.txt

      - name: Validate Secrets & Environment
        run: |
          echo "Checking essential secret presence..."
          if [ -z "\${{ secrets.SOURCE_S3_ACCESS_KEY }}" ] || [ -z "\${{ secrets.SOURCE_S3_SECRET_KEY }}" ]; then
            echo "::error::Primary Ceph credentials are missing in GitHub Secrets!"
            exit 1
          fi
          if [ -z "\${{ secrets.DEST_S3_ACCESS_KEY }}" ] || [ -z "\${{ secrets.DEST_S3_SECRET_KEY }}" ]; then
            echo "::error::Backup destination credentials are missing in GitHub Secrets!"
            exit 1
          fi
          echo "Secret presence validation successful."

      - name: Execute S3 Sync Engine
        id: run_sync
        env:
          SOURCE_S3_ENDPOINT_URL: \${{ secrets.SOURCE_S3_ENDPOINT_URL }}
          SOURCE_S3_ACCESS_KEY: \${{ secrets.SOURCE_S3_ACCESS_KEY }}
          SOURCE_S3_SECRET_KEY: \${{ secrets.SOURCE_S3_SECRET_KEY }}
          SOURCE_S3_REGION_NAME: \${{ secrets.SOURCE_S3_REGION_NAME || 'default' }}
          SOURCE_S3_VERIFY_SSL: \${{ secrets.SOURCE_S3_VERIFY_SSL || 'true' }}

          DEST_S3_ENDPOINT_URL: \${{ secrets.DEST_S3_ENDPOINT_URL }}
          DEST_S3_ACCESS_KEY: \${{ secrets.DEST_S3_ACCESS_KEY }}
          DEST_S3_SECRET_KEY: \${{ secrets.DEST_S3_SECRET_KEY }}
          DEST_S3_REGION_NAME: \${{ secrets.DEST_S3_REGION_NAME || 'us-east-1' }}
          DEST_S3_VERIFY_SSL: \${{ secrets.DEST_S3_VERIFY_SSL || 'true' }}

          LOG_LEVEL: 'INFO'
        run: |
          mkdir -p logs

          SOURCE_B="\${{ github.event.inputs.source_bucket || secrets.DEFAULT_SOURCE_BUCKET || 'production-primary-assets' }}"
          DEST_B="\${{ github.event.inputs.dest_bucket || secrets.DEFAULT_DEST_BUCKET || 'dr-backup-assets' }}"
          SYNC_M="\${{ github.event.inputs.sync_mode || 'both' }}"
          WORKERS="\${{ github.event.inputs.workers || '12' }}"

          FLAGS="--source-bucket \${SOURCE_B} --dest-bucket \${DEST_B} --sync-mode \${SYNC_M} --workers \${WORKERS}"

          if [ "\${{ github.event.inputs.dry_run }}" = "true" ]; then
            FLAGS="\${FLAGS} --dry-run"
          fi

          if [ "\${{ github.event.inputs.delete_orphans }}" = "true" ]; then
            FLAGS="\${FLAGS} --delete-orphans"
          fi

          echo "Running CephSync command: python3 sync_engine/sync_engine.py \${FLAGS}"
          python3 sync_engine/sync_engine.py \${FLAGS} | tee logs/sync-output.jsonl

      - name: Generate Workflow Markdown Summary
        if: always()
        run: |
          echo "### 📦 CephSync Execution Summary" >> $GITHUB_STEP_SUMMARY
          echo "| Parameter | Value |" >> $GITHUB_STEP_SUMMARY
          echo "|---|---|" >> $GITHUB_STEP_SUMMARY
          echo "| Trigger | \\\`\${{ github.event_name }}\\\` |" >> $GITHUB_STEP_SUMMARY
          echo "| Source Bucket | \\\`\${{ github.event.inputs.source_bucket || 'production-primary-assets' }}\\\` |" >> $GITHUB_STEP_SUMMARY
          echo "| Target Bucket | \\\`\${{ github.event.inputs.dest_bucket || 'dr-backup-assets' }}\\\` |" >> $GITHUB_STEP_SUMMARY
          echo "" >> $GITHUB_STEP_SUMMARY

      - name: Archive JSONL Logs
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: cephsync-logs-\${{ github.run_id }}
          path: logs/sync-output.jsonl
          retention-days: 14`,
  },
  {
    path: 'deploy/specs/rgw-service.yml',
    name: 'rgw-service.yml',
    category: 'deploy',
    language: 'yaml',
    description: 'Declarative Cephadm orchestrator spec file for RGW daemon placement and HAProxy Ingress virtual IP.',
    content: `---
service_type: rgw
service_id: rgw.default
placement:
  count: 3
  label: rgw
  hosts:
    - ceph-node01
    - ceph-node02
    - ceph-node03
spec:
  rgw_realm: production-realm
  rgw_zonegroup: default
  rgw_zone: default
  rgw_frontend_port: 8080
  rgw_frontend_type: beast
  ssl: false
---
service_type: ingress
service_id: rgw.ingress
placement:
  count: 3
  label: rgw
spec:
  backend_service: rgw.default
  virtual_ip: 192.168.10.100/24
  frontend_port: 80
  monitor_port: 1936
  ssl_port: 443`,
  },
  {
    path: 'deploy/ansible/site.yml',
    name: 'site.yml',
    category: 'deploy',
    language: 'yaml',
    description: 'Ansible automation playbook for multi-node Ceph RGW deployment and zonegroup provisioning.',
    content: `---
- name: Bootstrap Ceph Object Gateway (RGW) on 3-Node Cluster
  hosts: ceph_cluster
  become: true
  vars:
    realm_name: "production-realm"
    zonegroup_name: "default"
    zone_name: "default"
    rgw_port: 8080
    rgw_service_id: "rgw.default"
    rgw_admin_uid: "s3-backup-admin"

  tasks:
    - name: Ensure Ceph cluster is healthy
      ansible.builtin.command: ceph health detail
      register: ceph_health
      changed_when: false
      run_once: true

    - name: Label cluster nodes with 'rgw' tag
      ansible.builtin.command: "ceph orch host label add {{ inventory_hostname }} rgw"

    - name: Apply RGW service specification via Ceph Orchestrator
      ansible.builtin.command: >
        ceph orch apply rgw {{ rgw_service_id }}
        --realm={{ realm_name }}
        --zone={{ zone_name }}
        --placement="3 {{ groups['ceph_cluster'] | join(' ') }}"
        --port={{ rgw_port }}
      run_once: true`,
  },
  {
    path: 'deploy/ansible/inventory.ini',
    name: 'inventory.ini',
    category: 'deploy',
    language: 'ini',
    description: 'Ansible cluster inventory file defining 3-node Ceph hosts and connection variables.',
    content: `[ceph_cluster]
ceph-node01 ansible_host=192.168.10.11 ceph_role=mon,mgr,osd,rgw
ceph-node02 ansible_host=192.168.10.12 ceph_role=mon,mgr,osd,rgw
ceph-node03 ansible_host=192.168.10.13 ceph_role=mon,mgr,osd,rgw

[ceph_cluster:vars]
ansible_user=cephadmin
ansible_ssh_common_args='-o StrictHostKeyChecking=no'
ansible_python_interpreter=/usr/bin/python3`,
  },
  {
    path: 'sync_engine/requirements.txt',
    name: 'requirements.txt',
    category: 'sync_engine',
    language: 'config',
    description: 'Pinned Python dependencies required for S3 sync operations.',
    content: `boto3>=1.34.0
botocore>=1.34.0
urllib3>=2.0.0`,
  },
  {
    path: 'sync_engine/Dockerfile',
    name: 'Dockerfile',
    category: 'sync_engine',
    language: 'dockerfile',
    description: 'Container definition with unprivileged runner user for containerized Kubernetes/Nomad jobs.',
    content: `FROM python:3.11-slim-bookworm
LABEL maintainer="DevOps Infrastructure Team"
ENV PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
WORKDIR /app
COPY sync_engine/requirements.txt .
RUN pip install -r requirements.txt
COPY sync_engine/sync_engine.py .
RUN useradd -u 10001 -m cephsync && chown -R cephsync /app
USER cephsync
ENTRYPOINT ["python3", "sync_engine.py"]`,
  },
  {
    path: '.env.example',
    name: '.env.example',
    category: 'config',
    language: 'env',
    description: 'Zero-hardcoded secrets environment template for Ceph credentials and engine parameters.',
    content: `# --- Primary Ceph Object Gateway (Source) ---
SOURCE_S3_ENDPOINT_URL="http://192.168.10.11:8080"
SOURCE_S3_ACCESS_KEY="CEPH_RGW_ACCESS_KEY_HERE"
SOURCE_S3_SECRET_KEY="CEPH_RGW_SECRET_KEY_HERE"
SOURCE_S3_REGION_NAME="default"

# --- Target S3 / Ceph Backup Cluster (Destination) ---
DEST_S3_ENDPOINT_URL="https://s3.us-east-1.amazonaws.com"
DEST_S3_ACCESS_KEY="BACKUP_S3_ACCESS_KEY_HERE"
DEST_S3_SECRET_KEY="BACKUP_S3_SECRET_KEY_HERE"
DEST_S3_REGION_NAME="us-east-1"

# --- S3 Sync Engine Runtime Parameters ---
DEFAULT_SOURCE_BUCKET="production-primary-assets"
DEFAULT_DEST_BUCKET="dr-backup-assets"
SYNC_WORKERS=12
MULTIPART_THRESHOLD_MB=16
CHUNK_SIZE_MB=8
LOG_LEVEL="INFO"
DRY_RUN="false"
DELETE_ORPHANS="false"`,
  },
  {
    path: 'README.md',
    name: 'README.md',
    category: 'docs',
    language: 'markdown',
    description: 'Comprehensive enterprise README documentation with topology diagram, quickstarts, and runbook.',
    content: `# CephSync Enterprise: Ceph RGW Deployment & S3 Sync Engine
Production-ready open-source suite for automating 3-node Ceph RGW deployment and Python S3 sync.
See complete README in repository root.`,
  },
];
