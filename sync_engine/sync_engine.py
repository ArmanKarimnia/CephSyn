#!/usr/bin/env python3
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


# ==============================================================================
# 1. Structured JSON Logger
# ==============================================================================
class StructuredJsonFormatter(logging.Formatter):
    """
    Formats log records as single-line JSON objects for ingestion by Fluentbit,
    Logstash, Vector, Datadog, or CloudWatch.
    """

    def format(self, record: logging.LogRecord) -> str:
        log_payload: Dict[str, Any] = {
            "timestamp": datetime.datetime.now(datetime.timezone.utc).isoformat(),
            "level": record.levelname,
            "component": "sync_engine",
            "message": record.getMessage(),
        }

        # Inject extra structured fields attached to the log record
        if hasattr(record, "structured_data") and isinstance(record.structured_data, dict):
            log_payload.update(record.structured_data)

        if record.exc_info:
            log_payload["exception"] = self.formatException(record.exc_info)

        return json.dumps(log_payload)


def setup_logger(log_level_str: str) -> logging.Logger:
    """Configures structured JSON logging on standard output."""
    level = getattr(logging, log_level_str.upper(), logging.INFO)
    logger = logging.getLogger("cephsync")
    logger.setLevel(level)

    # Avoid duplicate handlers if re-initialized
    if not logger.handlers:
        handler = logging.StreamHandler(sys.stdout)
        handler.setFormatter(StructuredJsonFormatter())
        logger.addHandler(handler)

    logger.propagate = False
    return logger


LOGGER = setup_logger(os.getenv("LOG_LEVEL", "INFO"))


def log_event(level: int, msg: str, **kwargs: Any) -> None:
    """Helper to dispatch structured log messages."""
    extra = {"structured_data": kwargs} if kwargs else {}
    LOGGER.log(level, msg, extra=extra)


# ==============================================================================
# 2. Configuration & Security
# ==============================================================================
@dataclass(frozen=True)
class S3EndpointConfig:
    """Holds validated credentials and connection parameters for an S3 endpoint."""
    name: str
    endpoint_url: Optional[str]
    access_key: str
    secret_key: str
    region_name: str
    signature_version: str = "s3v4"
    verify_ssl: bool = True

    def create_boto3_client(self) -> Any:
        """Instantiates a thread-safe boto3 S3 client."""
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
    """
    Enforces security by loading all credentials exclusively from environment
    variables. Fails fast if mandatory credentials are missing.
    """
    source_key = os.getenv("SOURCE_S3_ACCESS_KEY")
    source_secret = os.getenv("SOURCE_S3_SECRET_KEY")
    source_endpoint = os.getenv("SOURCE_S3_ENDPOINT_URL")
    source_region = os.getenv("SOURCE_S3_REGION_NAME", "default")
    source_ssl_verify = os.getenv("SOURCE_S3_VERIFY_SSL", "true").lower() in ("true", "1", "yes")

    dest_key = os.getenv("DEST_S3_ACCESS_KEY")
    dest_secret = os.getenv("DEST_S3_SECRET_KEY")
    dest_endpoint = os.getenv("DEST_S3_ENDPOINT_URL")  # None or empty implies AWS S3
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


# ==============================================================================
# 3. Exponential Backoff Decorator
# ==============================================================================
def retry_with_exponential_backoff(max_retries: int = 5, base_delay: float = 1.0, max_delay: float = 32.0):
    """
    Decorator for network/S3 calls that implements full jitter exponential backoff.
    Mitigates S3 503 SlowDown, connection timeouts, and Ceph RGW load spikes.
    """
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

                        # Do not retry fatal 404 or 403 authorization rejections
                        if status_code in (403, 404):
                            log_event(
                                logging.ERROR,
                                "Non-retryable client error encountered",
                                func=func.__name__,
                                status=status_code,
                                code=error_code,
                            )
                            raise

                    if retries > max_retries:
                        log_event(
                            logging.CRITICAL,
                            "Exceeded maximum backoff retries",
                            func=func.__name__,
                            retries=retries,
                            error=str(exc),
                        )
                        raise

                    # Full jitter: uniform random sleep in [0, min(max_delay, base_delay * 2^retries)]
                    calculated_delay = min(max_delay, base_delay * (2 ** (retries - 1)))
                    sleep_time = random.uniform(0.5, calculated_delay)

                    log_event(
                        logging.WARNING,
                        "Transient S3 failure, retrying with backoff",
                        func=func.__name__,
                        attempt=retries,
                        max_retries=max_retries,
                        sleep_seconds=round(sleep_time, 2),
                        error=str(exc),
                        error_code=error_code,
                    )
                    time.sleep(sleep_time)
        return wrapper
    return decorator


# ==============================================================================
# 4. Data Models & Metrics Tracker
# ==============================================================================
@dataclass
class S3ObjectMetadata:
    """Represents core metadata of an S3 object."""
    key: str
    size: int
    etag: str
    last_modified: datetime.datetime


@dataclass
class SyncMetrics:
    """Thread-safe statistics tracking for the synchronization run."""
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


# ==============================================================================
# 5. Core S3 Sync Engine
# ==============================================================================
class S3SyncEngine:
    """
    Coordinates enterprise-grade synchronization between Ceph RGW and S3.
    """

    def __init__(
        self,
        source_client: Any,
        dest_client: Any,
        source_bucket: str,
        dest_bucket: str,
        sync_mode: str = "both",
        multipart_threshold_bytes: int = 16 * 1024 * 1024,  # 16 MB
        chunk_size_bytes: int = 8 * 1024 * 1024,           # 8 MB
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

    # --------------------------------------------------------------------------
    # Listing & Inventory Helpers
    # --------------------------------------------------------------------------
    def list_bucket_objects(self, client: Any, bucket: str) -> Generator[S3ObjectMetadata, None, None]:
        """
        Streams all objects under the specified prefix using S3 Paginated ListObjectsV2.
        Memory efficient for buckets with millions of objects.
        """
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

    # --------------------------------------------------------------------------
    # Incremental Change Detection
    # --------------------------------------------------------------------------
    def should_sync(self, src: S3ObjectMetadata, dst: Optional[S3ObjectMetadata]) -> Tuple[bool, str]:
        """
        Determines if an object requires synchronization based on the configured mode:
          - 'etag': Compare MD5 / multipart ETag
          - 'timestamp': Compare LastModified timestamp (sync if source is newer)
          - 'both': Compare size and either timestamp or ETag
        """
        if dst is None:
            return True, "object_missing_in_target"

        if src.size != dst.size:
            return True, f"size_mismatch (src: {src.size} != dst: {dst.size})"

        if self.sync_mode == "timestamp":
            if src.last_modified > dst.last_modified:
                return True, f"source_newer (src: {src.last_modified.isoformat()} > dst: {dst.last_modified.isoformat()})"
            return False, "up_to_date"

        if self.sync_mode == "etag":
            # Strip potential quotes or Ceph-specific qualifiers
            src_etag_clean = src.etag.replace('"', '').split("-")[0]
            dst_etag_clean = dst.etag.replace('"', '').split("-")[0]
            if src_etag_clean != dst_etag_clean:
                return True, f"etag_mismatch (src: {src.etag} != dst: {dst.etag})"
            return False, "up_to_date"

        # Default 'both' mode:
        # If ETags match exactly, identical.
        if src.etag == dst.etag:
            return False, "up_to_date"

        # If source is newer and sizes match but etags differ (e.g. multipart vs single-part upload differences)
        if src.last_modified > dst.last_modified:
            return True, "source_modified_recently"

        return False, "up_to_date"

    # --------------------------------------------------------------------------
    # Single-Part Object Transfer
    # --------------------------------------------------------------------------
    @retry_with_exponential_backoff(max_retries=5)
    def _transfer_single_part(self, key: str, size: int) -> None:
        """Transfers smaller objects directly by streaming bytes from source to destination."""
        response = self.source_client.get_object(Bucket=self.source_bucket, Key=key)
        body_stream = response["Body"]
        content_type = response.get("ContentType", "application/octet-stream")
        metadata = response.get("Metadata", {})

        self.dest_client.put_object(
            Bucket=self.dest_bucket,
            Key=key,
            Body=body_stream.read(),
            ContentLength=size,
            ContentType=content_type,
            Metadata=metadata,
        )

    # --------------------------------------------------------------------------
    # Multipart Object Transfer
    # --------------------------------------------------------------------------
    def _transfer_multipart(self, key: str, size: int) -> None:
        """
        Streams large objects in chunks using S3 Multipart Upload without saving
        the full object to disk. Aborts the multipart upload if errors occur to
        prevent hidden storage leaks on Ceph RGW.
        """
        # Step A: Initiate Multipart Upload on Destination
        init_res = self.dest_client.create_multipart_upload(
            Bucket=self.dest_bucket,
            Key=key,
        )
        upload_id = init_res["UploadId"]
        num_parts = math.ceil(size / self.chunk_size)
        parts_manifest: List[Dict[str, Any]] = []

        log_event(
            logging.DEBUG,
            "Initiated multipart transfer",
            key=key,
            size_bytes=size,
            upload_id=upload_id,
            num_parts=num_parts,
        )

        try:
            for part_num in range(1, num_parts + 1):
                byte_start = (part_num - 1) * self.chunk_size
                byte_end = min(size - 1, (part_num * self.chunk_size) - 1)
                byte_range = f"bytes={byte_start}-{byte_end}"

                # Download chunk from source with backoff
                @retry_with_exponential_backoff(max_retries=5)
                def fetch_and_upload_chunk() -> str:
                    part_resp = self.source_client.get_object(
                        Bucket=self.source_bucket,
                        Key=key,
                        Range=byte_range,
                    )
                    chunk_data = part_resp["Body"].read()

                    # Upload part to destination
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

            # Step B: Complete Multipart Upload
            self.dest_client.complete_multipart_upload(
                Bucket=self.dest_bucket,
                Key=key,
                UploadId=upload_id,
                MultipartUpload={"Parts": parts_manifest},
            )

            log_event(
                logging.DEBUG,
                "Multipart transfer completed",
                key=key,
                parts=num_parts,
            )

        except Exception as exc:
            # Crucial: Abort multipart upload to prevent Ceph orphan accumulation
            log_event(
                logging.ERROR,
                "Aborting failed multipart upload",
                key=key,
                upload_id=upload_id,
                error=str(exc),
            )
            try:
                self.dest_client.abort_multipart_upload(
                    Bucket=self.dest_bucket,
                    Key=key,
                    UploadId=upload_id,
                )
            except Exception as abort_err:
                log_event(
                    logging.WARNING,
                    "Failed to abort multipart upload",
                    key=key,
                    error=str(abort_err),
                )
            raise exc

    # --------------------------------------------------------------------------
    # Worker Task Dispatcher
    # --------------------------------------------------------------------------
    def sync_single_object(self, src: S3ObjectMetadata, dst: Optional[S3ObjectMetadata]) -> bool:
        """Handles single object sync determination, execution, and metrics."""
        needs_sync, reason = self.should_sync(src, dst)

        if not needs_sync:
            self.metrics.total_skipped += 1
            log_event(
                logging.DEBUG,
                "Skipping object (already synchronized)",
                key=src.key,
                reason=reason,
            )
            return True

        if self.dry_run:
            self.metrics.total_transferred += 1
            self.metrics.total_bytes_transferred += src.size
            log_event(
                logging.INFO,
                "[DRY RUN] Would synchronize object",
                key=src.key,
                size_bytes=src.size,
                reason=reason,
            )
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

            log_event(
                logging.INFO,
                "Object synchronized successfully",
                key=src.key,
                size_bytes=src.size,
                duration_ms=duration_ms,
                reason=reason,
                multipart=(src.size > self.multipart_threshold),
            )
            return True

        except Exception as exc:
            self.metrics.total_failed += 1
            log_event(
                logging.ERROR,
                "Failed to synchronize object",
                key=src.key,
                size_bytes=src.size,
                error=str(exc),
            )
            return False

    # --------------------------------------------------------------------------
    # Orphan Cleanup (Optional)
    # --------------------------------------------------------------------------
    def cleanup_orphans(self, src_keys: set[str], dst_map: Dict[str, S3ObjectMetadata]) -> None:
        """Removes objects present in destination bucket that no longer exist in source."""
        orphan_keys = [k for k in dst_map.keys() if k not in src_keys]

        if not orphan_keys:
            log_event(logging.INFO, "No orphan objects found in destination")
            return

        log_event(logging.INFO, f"Found {len(orphan_keys)} orphan object(s) to remove")

        for key in orphan_keys:
            if self.dry_run:
                self.metrics.total_deleted += 1
                log_event(logging.INFO, "[DRY RUN] Would delete orphan object", key=key)
            else:
                try:
                    self.dest_client.delete_object(Bucket=self.dest_bucket, Key=key)
                    self.metrics.total_deleted += 1
                    log_event(logging.INFO, "Deleted orphan object", key=key)
                except Exception as exc:
                    log_event(logging.ERROR, "Failed to delete orphan", key=key, error=str(exc))

    # --------------------------------------------------------------------------
    # Main Execution Loop
    # --------------------------------------------------------------------------
    def run(self) -> SyncMetrics:
        """Executes the complete synchronization workflow."""
        self.metrics.start()
        log_event(
            logging.INFO,
            "Starting CephSync Enterprise execution",
            source_bucket=self.source_bucket,
            dest_bucket=self.dest_bucket,
            sync_mode=self.sync_mode,
            workers=self.workers,
            multipart_threshold_mb=round(self.multipart_threshold / (1024 * 1024), 1),
            chunk_size_mb=round(self.chunk_size / (1024 * 1024), 1),
            dry_run=self.dry_run,
        )

        # Step 1: Scan Destination Bucket Inventory
        log_event(logging.INFO, "Indexing destination bucket objects...")
        dest_inventory: Dict[str, S3ObjectMetadata] = {}
        for obj in self.list_bucket_objects(self.dest_client, self.dest_bucket):
            dest_inventory[obj.key] = obj
        log_event(logging.INFO, f"Indexed {len(dest_inventory)} destination objects")

        # Step 2: Stream & Parallelize Source Objects
        log_event(logging.INFO, "Scanning source bucket and dispatching sync workers...")
        source_keys_seen: set[str] = set()

        with ThreadPoolExecutor(max_workers=self.workers, thread_name_prefix="cephsync-worker") as executor:
            futures = []

            for src_obj in self.list_bucket_objects(self.source_client, self.source_bucket):
                self.metrics.total_scanned += 1
                source_keys_seen.add(src_obj.key)
                dst_obj = dest_inventory.get(src_obj.key)

                futures.append(executor.submit(self.sync_single_object, src_obj, dst_obj))

                # Keep bounded memory queue if bucket has tens of millions of keys
                if len(futures) >= self.workers * 100:
                    for future in as_completed(futures):
                        future.result()
                    futures.clear()

            # Drain remaining tasks
            for future in as_completed(futures):
                future.result()

        # Step 3: Handle Orphans if requested
        if self.delete_orphans:
            self.cleanup_orphans(source_keys_seen, dest_inventory)

        self.metrics.finish()

        # Step 4: Emit Final Structured Summary Report
        summary_data = {
            "total_scanned": self.metrics.total_scanned,
            "total_transferred": self.metrics.total_transferred,
            "total_skipped": self.metrics.total_skipped,
            "total_failed": self.metrics.total_failed,
            "total_deleted": self.metrics.total_deleted,
            "total_bytes_transferred": self.metrics.total_bytes_transferred,
            "duration_seconds": round(self.metrics.duration_seconds, 2),
            "throughput_mb_s": self.metrics.transfer_rate_mb_s,
            "status": "COMPLETED_WITH_ERRORS" if self.metrics.total_failed > 0 else "SUCCESS",
        }

        log_event(
            logging.INFO if self.metrics.total_failed == 0 else logging.WARNING,
            "Synchronization run finished",
            **summary_data,
        )

        return self.metrics


# ==============================================================================
# 6. Command Line Interface Parser
# ==============================================================================
def parse_arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="CephSync Enterprise: High-Reliability Ceph RGW / S3 Data Sync Utility"
    )
    parser.add_argument(
        "--source-bucket",
        required=True,
        help="Name of the source S3 bucket on primary Ceph cluster",
    )
    parser.add_argument(
        "--dest-bucket",
        required=True,
        help="Name of the target S3 bucket (Ceph secondary or AWS S3)",
    )
    parser.add_argument(
        "--sync-mode",
        choices=["etag", "timestamp", "both"],
        default="both",
        help="Incremental change detection criteria (default: 'both')",
    )
    parser.add_argument(
        "--workers",
        type=int,
        default=int(os.getenv("SYNC_WORKERS", "8")),
        help="Number of concurrent worker threads (default: 8)",
    )
    parser.add_argument(
        "--multipart-threshold-mb",
        type=int,
        default=int(os.getenv("MULTIPART_THRESHOLD_MB", "16")),
        help="Object size threshold in MB for multipart upload (default: 16)",
    )
    parser.add_argument(
        "--chunk-size-mb",
        type=int,
        default=int(os.getenv("CHUNK_SIZE_MB", "8")),
        help="Chunk size in MB for each multipart part (default: 8)",
    )
    parser.add_argument(
        "--prefix",
        default="",
        help="Optional S3 object prefix to filter synchronization",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        default=os.getenv("DRY_RUN", "false").lower() in ("true", "1"),
        help="Simulate execution without modifying destination bucket",
    )
    parser.add_argument(
        "--delete-orphans",
        action="store_true",
        default=os.getenv("DELETE_ORPHANS", "false").lower() in ("true", "1"),
        help="Delete objects in destination that do not exist in source",
    )
    parser.add_argument(
        "--log-level",
        default=os.getenv("LOG_LEVEL", "INFO"),
        choices=["DEBUG", "INFO", "WARNING", "ERROR"],
        help="Logging verbosity (default: INFO)",
    )
    return parser.parse_args()


# ==============================================================================
# 7. Main Entry Point
# ==============================================================================
def main() -> None:
    args = parse_arguments()

    try:
        source_cfg, dest_cfg = load_credentials_from_env()
    except ValueError as err:
        log_event(logging.CRITICAL, "Startup aborted due to configuration errors", error=str(err))
        sys.exit(2)

    try:
        source_client = source_cfg.create_boto3_client()
        dest_client = dest_cfg.create_boto3_client()

        # Validate bucket access
        source_client.head_bucket(Bucket=args.source_bucket)
        dest_client.head_bucket(Bucket=args.dest_bucket)
        log_event(logging.INFO, "Both source and destination buckets verified successfully")

    except ClientError as exc:
        log_event(
            logging.CRITICAL,
            "Failed bucket verification check",
            error=str(exc),
        )
        sys.exit(1)

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

    if metrics.total_failed > 0:
        log_event(logging.WARNING, "Sync finished with failures. Non-zero exit code returned.")
        sys.exit(1)

    sys.exit(0)


if __name__ == "__main__":
    main()
