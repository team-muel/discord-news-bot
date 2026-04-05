#!/usr/bin/env bash
# Obsidian Headless Sync — ephemeral vault bootstrap for Render
# Pulls vault from Obsidian Cloud on cold start, then runs continuous sync.
#
# Required env:
#   OBSIDIAN_EMAIL, OBSIDIAN_PASSWORD  — Obsidian account credentials
#   OBSIDIAN_VAULT_NAME                — remote vault name (default: "docs")
#
# Optional env:
#   OBSIDIAN_VAULT_PATH         — local vault path (default: /tmp/vault)
#   OBSIDIAN_SYNC_MODE          — pull-only | bidirectional | mirror-remote (default: bidirectional)
#   OBSIDIAN_SYNC_CONFLICT      — merge | conflict (default: merge)
#   OBSIDIAN_E2EE_PASSWORD      — E2EE password (omit if not using E2EE)
#   OBSIDIAN_HEADLESS_SKIP      — set to "true" to skip headless sync entirely

set -euo pipefail

VAULT_PATH="${OBSIDIAN_VAULT_PATH:-/tmp/vault}"
VAULT_NAME="${OBSIDIAN_VAULT_NAME:-docs}"
SYNC_MODE="${OBSIDIAN_SYNC_MODE:-bidirectional}"
CONFLICT_STRATEGY="${OBSIDIAN_SYNC_CONFLICT:-merge}"
E2EE_PASSWORD="${OBSIDIAN_E2EE_PASSWORD:-}"

log() { echo "[HEADLESS-SYNC] $(date -u +%Y-%m-%dT%H:%M:%SZ) $*"; }

# Skip if explicitly disabled
if [ "${OBSIDIAN_HEADLESS_SKIP:-false}" = "true" ]; then
  log "OBSIDIAN_HEADLESS_SKIP=true, skipping headless sync"
  exec node --import tsx server.ts
fi

# Check ob CLI availability
if ! command -v ob &>/dev/null; then
  log "WARN: 'ob' CLI not found. Install with: npm install -g obsidian-headless"
  log "Falling back to server-only mode (vault sync disabled)"
  exec node --import tsx server.ts
fi

# Check required credentials
if [ -z "${OBSIDIAN_EMAIL:-}" ] || [ -z "${OBSIDIAN_PASSWORD:-}" ]; then
  log "WARN: OBSIDIAN_EMAIL or OBSIDIAN_PASSWORD not set. Skipping headless sync."
  exec node --import tsx server.ts
fi

# ── Step 1: Login ─────────────────────────────────────────────────────────
log "Logging in to Obsidian..."
if ! echo "${OBSIDIAN_PASSWORD}" | ob login --email "${OBSIDIAN_EMAIL}" 2>&1; then
  log "WARN: ob login failed. Checking if already logged in..."
  if ! ob sync-list-remote &>/dev/null; then
    log "ERROR: Not authenticated. Falling back to server-only mode."
    exec node --import tsx server.ts
  fi
  log "Already authenticated, continuing."
fi

# ── Step 2: Setup vault ──────────────────────────────────────────────────
mkdir -p "${VAULT_PATH}"

log "Setting up vault sync: ${VAULT_NAME} -> ${VAULT_PATH}"
SETUP_ARGS="--vault ${VAULT_NAME} --path ${VAULT_PATH}"
if [ -n "${E2EE_PASSWORD}" ]; then
  SETUP_ARGS="${SETUP_ARGS} --password ${E2EE_PASSWORD}"
fi

# sync-setup may fail if already configured — that's OK
if ! ob sync-setup ${SETUP_ARGS} 2>&1; then
  log "sync-setup returned non-zero (may already be configured). Checking status..."
  if ! ob sync-status --path "${VAULT_PATH}" &>/dev/null; then
    log "ERROR: Vault not configured and setup failed. Falling back."
    exec node --import tsx server.ts
  fi
fi

# ── Step 3: Configure sync mode ─────────────────────────────────────────
log "Configuring sync: mode=${SYNC_MODE}, conflict=${CONFLICT_STRATEGY}"
ob sync-config --path "${VAULT_PATH}" \
  --mode "${SYNC_MODE}" \
  --conflict-strategy "${CONFLICT_STRATEGY}" \
  --excluded-folders ".obsidian,.trash,templates" \
  2>&1 || log "WARN: sync-config failed (non-fatal, using defaults)"

# ── Step 4: Initial pull (blocking) ─────────────────────────────────────
log "Pulling vault (one-shot sync)..."
SYNC_START=$(date +%s)

if ob sync --path "${VAULT_PATH}" 2>&1; then
  SYNC_END=$(date +%s)
  FILE_COUNT=$(find "${VAULT_PATH}" -name '*.md' 2>/dev/null | wc -l)
  log "Initial sync complete in $((SYNC_END - SYNC_START))s (${FILE_COUNT} markdown files)"
else
  log "WARN: Initial sync failed. Vault may be empty; continuing anyway."
fi

# ── Step 5: Start continuous sync (background) ──────────────────────────
log "Starting continuous sync daemon..."
ob sync --path "${VAULT_PATH}" --continuous &
OB_SYNC_PID=$!
log "Continuous sync started (PID=${OB_SYNC_PID})"

# Trap to ensure ob sync is stopped on shutdown
cleanup() {
  log "Stopping continuous sync (PID=${OB_SYNC_PID})..."
  kill "${OB_SYNC_PID}" 2>/dev/null || true
  wait "${OB_SYNC_PID}" 2>/dev/null || true
  log "Cleanup complete."
}
trap cleanup EXIT SIGINT SIGTERM

# ── Step 6: Mark vault as ready and start the server ────────────────────
export OBSIDIAN_VAULT_READY="true"
export OBSIDIAN_VAULT_PATH="${VAULT_PATH}"
export OBSIDIAN_HEADLESS_ENABLED="true"
export OBSIDIAN_SYNC_VAULT_PATH="${VAULT_PATH}"
export OBSIDIAN_LOCAL_FS_ENABLED="true"

log "Starting server with vault at ${VAULT_PATH}..."
exec node --import tsx server.ts
