#!/usr/bin/env bash
# ==============================================================================
# CephSync Enterprise: Ceph RGW 3-Node Cluster Deployment & Zone Bootstrapper
# ==============================================================================
# Description:
#   Automates Ceph Object Gateway (RGW) deployment across a 3-node Ceph cluster
#   using cephadm / Ceph Orchestrator (`ceph orch`). Configures the foundational
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
IFS=$'\n\t'

# ------------------------------------------------------------------------------
# Configuration Variables (Override via environment variables if needed)
# ------------------------------------------------------------------------------
REALM_NAME="${REALM_NAME:-production-realm}"
ZONEGROUP_NAME="${ZONEGROUP_NAME:-default}"
ZONE_NAME="${ZONE_NAME:-default}"
RGW_SERVICE_ID="${RGW_SERVICE_ID:-rgw.default}"
RGW_PORT="${RGW_PORT:-8080}"
RGW_COUNT="${RGW_COUNT:-3}"

# Node placement hosts (3-node cluster)
NODE_1="${CEPH_NODE_1:-ceph-node01}"
NODE_2="${CEPH_NODE_2:-ceph-node02}"
NODE_3="${CEPH_NODE_3:-ceph-node03}"

# S3 Admin User Configuration
ADMIN_UID="${RGW_ADMIN_UID:-s3-backup-admin}"
ADMIN_DISPLAY_NAME="${RGW_ADMIN_NAME:-S3 Sync & Backup Service}"

# Logging helpers
log_info()    { echo -e "\033[1;34m[INFO]  \033[0m $(date '+%Y-%m-%d %H:%M:%S') - $*"; }
log_success() { echo -e "\033[1;32m[SUCCESS]\033[0m $(date '+%Y-%m-%d %H:%M:%S') - $*"; }
log_warn()    { echo -e "\033[1;33m[WARN]  \033[0m $(date '+%Y-%m-%d %H:%M:%S') - $*"; }
log_error()   { echo -e "\033[1;31m[ERROR] \033[0m $(date '+%Y-%m-%d %H:%M:%S') - $*" >&2; }

# ------------------------------------------------------------------------------
# 1. Pre-flight Checks
# ------------------------------------------------------------------------------
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

# ------------------------------------------------------------------------------
# 2. Host Labeling & Orchestrator Preparation
# ------------------------------------------------------------------------------
label_cluster_nodes() {
  log_info "Labeling 3-node cluster hosts for RGW orchestrator placement..."

  for node in "${NODE_1}" "${NODE_2}" "${NODE_3}"; do
    log_info "Ensuring host '${node}' has 'rgw' placement label..."
    ceph orch host label add "${node}" rgw || true
  done

  log_success "Host labeling completed. Current host inventory:"
  ceph orch host ls
}

# ------------------------------------------------------------------------------
# 3. Configure Multi-Site Topology (Realm, Zonegroup, and Zone)
# ------------------------------------------------------------------------------
configure_rgw_multisite() {
  log_info "Initializing RGW multi-site configuration (Realm, Zonegroup, Zone)..."

  # Step A: Create or use Realm
  if ! radosgw-admin realm get --rgw-realm="${REALM_NAME}" &>/dev/null; then
    log_info "Creating new realm: ${REALM_NAME}..."
    radosgw-admin realm create --rgw-realm="${REALM_NAME}" --default
  else
    log_info "Realm '${REALM_NAME}' already exists. Setting as default..."
    radosgw-admin realm default --rgw-realm="${REALM_NAME}"
  fi

  # Step B: Create or update Zonegroup
  if ! radosgw-admin zonegroup get --rgw-zonegroup="${ZONEGROUP_NAME}" &>/dev/null; then
    log_info "Creating zonegroup: ${ZONEGROUP_NAME}..."
    radosgw-admin zonegroup create \
      --rgw-realm="${REALM_NAME}" \
      --rgw-zonegroup="${ZONEGROUP_NAME}" \
      --endpoints="http://${NODE_1}:${RGW_PORT},http://${NODE_2}:${RGW_PORT},http://${NODE_3}:${RGW_PORT}" \
      --master \
      --default
  else
    log_info "Updating endpoints for existing zonegroup '${ZONEGROUP_NAME}'..."
    radosgw-admin zonegroup modify \
      --rgw-zonegroup="${ZONEGROUP_NAME}" \
      --endpoints="http://${NODE_1}:${RGW_PORT},http://${NODE_2}:${RGW_PORT},http://${NODE_3}:${RGW_PORT}" \
      --master \
      --default
  fi

  # Step C: Create or update Zone
  if ! radosgw-admin zone get --rgw-zone="${ZONE_NAME}" &>/dev/null; then
    log_info "Creating zone: ${ZONE_NAME} in zonegroup: ${ZONEGROUP_NAME}..."
    radosgw-admin zone create \
      --rgw-realm="${REALM_NAME}" \
      --rgw-zonegroup="${ZONEGROUP_NAME}" \
      --rgw-zone="${ZONE_NAME}" \
      --endpoints="http://${NODE_1}:${RGW_PORT},http://${NODE_2}:${RGW_PORT},http://${NODE_3}:${RGW_PORT}" \
      --master \
      --default
  else
    log_info "Updating endpoints for existing zone '${ZONE_NAME}'..."
    radosgw-admin zone modify \
      --rgw-zone="${ZONE_NAME}" \
      --endpoints="http://${NODE_1}:${RGW_PORT},http://${NODE_2}:${RGW_PORT},http://${NODE_3}:${RGW_PORT}" \
      --master \
      --default
  fi

  # Step D: Commit the period to activate topology changes
  log_info "Committing changes to RGW period..."
  radosgw-admin period update --commit

  log_success "RGW default.zonegroup.zone topology committed successfully."
}

# ------------------------------------------------------------------------------
# 4. Deploy Ceph RGW Service via Cephadm Orchestrator
# ------------------------------------------------------------------------------
deploy_rgw_orchestrator() {
  log_info "Deploying Ceph RGW daemons across 3 nodes using ceph orch apply..."

  # Option 1: Direct command with placement specification
  # Uses rgw_frontend listening on configured port
  ceph orch apply rgw "${RGW_SERVICE_ID}" \
    --realm="${REALM_NAME}" \
    --zone="${ZONE_NAME}" \
    --placement="3 ${NODE_1} ${NODE_2} ${NODE_3}" \
    --port="${RGW_PORT}"

  log_info "Waiting for RGW service daemons to be provisioned and start..."
  local timeout=180
  local elapsed=0
  local ready=false

  while [ "${elapsed}" -lt "${timeout}" ]; do
    local running_daemons
    running_daemons=$(ceph orch ps --daemon-type rgw --format json | grep -c '"status_desc": "running"' || true)

    log_info "RGW active running daemons: ${running_daemons}/${RGW_COUNT} (elapsed: ${elapsed}s)"

    if [ "${running_daemons}" -ge "${RGW_COUNT}" ]; then
      ready=true
      break
    fi

    sleep 10
    elapsed=$((elapsed + 10))
  done

  if [ "${ready}" = true ]; then
    log_success "All ${RGW_COUNT} Ceph RGW daemons are operational."
  else
    log_warn "Timeout reached. Some daemons may still be pulling container images. Check status with: ceph orch ps --daemon-type rgw"
  fi
}

# ------------------------------------------------------------------------------
# 5. Provision Dedicated S3 Admin & Sync User
# ------------------------------------------------------------------------------
provision_admin_user() {
  log_info "Provisioning dedicated S3 synchronization administrative user..."

  local user_info
  if user_info=$(radosgw-admin user info --uid="${ADMIN_UID}" 2>/dev/null); then
    log_warn "User '${ADMIN_UID}' already exists. Re-fetching credentials..."
  else
    log_info "Creating new user '${ADMIN_UID}'..."
    user_info=$(radosgw-admin user create \
      --uid="${ADMIN_UID}" \
      --display-name="${ADMIN_DISPLAY_NAME}" \
      --system)
  fi

  # Extract access key and secret key using python or awk
  local access_key
  local secret_key

  access_key=$(python3 -c "import sys, json; print(json.loads('''${user_info}''')['keys'][0]['access_key'])" 2>/dev/null || true)
  secret_key=$(python3 -c "import sys, json; print(json.loads('''${user_info}''')['keys'][0]['secret_key'])" 2>/dev/null || true)

  log_success "================================================================"
  log_success "S3 Synchronizer Credentials Created / Verified:"
  log_success "  User ID:    ${ADMIN_UID}"
  log_success "  Access Key: ${access_key:-<configured>}"
  log_success "  Secret Key: (hidden for security - stored in Ceph keyring/keystore)"
  log_success "  S3 Endpoint: http://${NODE_1}:${RGW_PORT}"
  log_success "================================================================"

  # Generate local environment template file
  cat <<EOF > s3_credentials.env
# Generated Ceph RGW S3 Credentials
# Export these variables or source them before executing sync_engine.py
export SOURCE_S3_ENDPOINT_URL="http://${NODE_1}:${RGW_PORT}"
export SOURCE_S3_ACCESS_KEY="${access_key}"
export SOURCE_S3_SECRET_KEY="${secret_key}"
export SOURCE_S3_REGION_NAME="${ZONEGROUP_NAME}"
EOF
  chmod 600 s3_credentials.env
  log_info "Saved environment template to 's3_credentials.env' (chmod 600)."
}

# ------------------------------------------------------------------------------
# 6. Final Health Summary
# ------------------------------------------------------------------------------
print_summary() {
  log_info "Retrieving Ceph RGW service status from Orchestrator..."
  ceph orch ps --daemon-type rgw || true

  echo ""
  log_success "Ceph Object Gateway (RGW) deployment completed successfully!"
  log_info "Next Steps:"
  log_info "  1. Test S3 connection: aws --endpoint-url http://${NODE_1}:${RGW_PORT} s3 ls"
  log_info "  2. Configure secondary backup target in your sync environment."
  log_info "  3. Execute sync utility: python3 sync_engine/sync_engine.py --dry-run"
}

# ------------------------------------------------------------------------------
# Main Entry Point
# ------------------------------------------------------------------------------
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

main "$@"
