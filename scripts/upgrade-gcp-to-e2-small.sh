#!/usr/bin/env bash
# upgrade-gcp-to-e2-small.sh — Legacy helper to resize GCP VM and deploy full OpenJarvis
#
# Purpose:
#   Historical purpose: upgrade from e2-micro to a larger machine type to enable
#   full jarvis serve on GCP, removing WSL dependency for the 24/7 learning loop.
#   Current default target should be e2-medium (4GB).
#
# What this does:
#   1. Stops the VM instance
#   2. Resizes to the configured target machine type
#   3. Restarts the VM
#   4. SSHes in and installs OpenJarvis full (not lite mode)
#   5. Creates systemd unit for jarvis serve
#   6. Validates health of all workers + jarvis serve
#
# Prerequisites:
#   - gcloud CLI authenticated and configured
#   - Instance name and zone known
#
# Usage:
#   bash scripts/upgrade-gcp-to-e2-small.sh [--dry-run]
#
# Cost impact:
#   e2-micro: legacy low-cost baseline
#   e2-medium: current operating baseline
#   Check current GCP pricing directly before resize.

set -euo pipefail

INSTANCE="${GCP_INSTANCE:-instance-20260319-223412}"
PROJECT="${GCP_PROJECT:-gen-lang-client-0405212361}"
ZONE="${GCP_ZONE:-us-central1-c}"
NEW_MACHINE_TYPE="${NEW_MACHINE_TYPE:-e2-medium}"
DRY_RUN=false

for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=true ;;
  esac
done

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
ok()   { printf "${GREEN}[OK]${NC}   %s\n" "$1"; }
warn() { printf "${YELLOW}[WARN]${NC} %s\n" "$1"; }
fail() { printf "${RED}[FAIL]${NC} %s\n" "$1"; exit 1; }

echo ""
echo "============================================"
echo "  GCP VM Upgrade: legacy baseline -> $NEW_MACHINE_TYPE"
echo "============================================"
echo "  Instance: $INSTANCE"
echo "  Project:  $PROJECT"
echo "  Zone:     $ZONE"
echo "  Dry run:  $DRY_RUN"
echo ""

# Verify gcloud CLI
if ! command -v gcloud &>/dev/null; then
  fail "gcloud CLI not found. Install: https://cloud.google.com/sdk/docs/install"
fi
ok "gcloud CLI available"

# Get current machine type
CURRENT_TYPE=$(gcloud compute instances describe "$INSTANCE" \
  --project="$PROJECT" --zone="$ZONE" \
  --format='get(machineType)' 2>/dev/null | awk -F/ '{print $NF}')
echo "  Current machine type: $CURRENT_TYPE"

if [ "$CURRENT_TYPE" = "$NEW_MACHINE_TYPE" ]; then
  ok "Already running $NEW_MACHINE_TYPE — skipping resize"
else
  if [ "$DRY_RUN" = true ]; then
    warn "[DRY RUN] Would stop instance, resize to $NEW_MACHINE_TYPE, and restart"
  else
    # Step 1: Stop the VM
    echo ""
    echo "--- Step 1: Stopping VM ---"
    gcloud compute instances stop "$INSTANCE" \
      --project="$PROJECT" --zone="$ZONE" --quiet
    ok "Instance stopped"

    # Step 2: Resize
    echo ""
    echo "--- Step 2: Resizing to $NEW_MACHINE_TYPE ---"
    gcloud compute instances set-machine-type "$INSTANCE" \
      --project="$PROJECT" --zone="$ZONE" \
      --machine-type="$NEW_MACHINE_TYPE" --quiet
    ok "Machine type changed to $NEW_MACHINE_TYPE"

    # Step 3: Start the VM
    echo ""
    echo "--- Step 3: Starting VM ---"
    gcloud compute instances start "$INSTANCE" \
      --project="$PROJECT" --zone="$ZONE" --quiet
    ok "Instance started"

    # Wait for SSH availability
    echo "  Waiting for SSH..."
    for i in $(seq 1 30); do
      if gcloud compute ssh "$INSTANCE" --project="$PROJECT" --zone="$ZONE" \
        --command="echo ok" --quiet 2>/dev/null; then
        ok "SSH available"
        break
      fi
      if [ "$i" -eq 30 ]; then
        fail "SSH not available after 30 attempts"
      fi
    done
  fi
fi

if [ "$DRY_RUN" = true ]; then
  echo ""
  warn "[DRY RUN] Would install full OpenJarvis and configure jarvis serve systemd unit"
  echo ""
  echo "============================================"
  echo "  DRY RUN complete. No changes applied."
  echo "============================================"
  exit 0
fi

# Step 4: Install full OpenJarvis on the VM
echo ""
echo "--- Step 4: Installing OpenJarvis (full) ---"

gcloud compute ssh "$INSTANCE" --project="$PROJECT" --zone="$ZONE" --quiet --command="
set -euo pipefail

# Install Python + uv if not present
if ! command -v python3 &>/dev/null; then
  sudo apt-get update -qq && sudo apt-get install -y -qq python3 python3-pip python3-venv
fi

if ! command -v uv &>/dev/null; then
  curl -LsSf https://astral.sh/uv/install.sh | sh
  export PATH=\\\"\\\$HOME/.local/bin:\\\$PATH\\\"
fi
export PATH=\\\"\\\$HOME/.local/bin:\\\$PATH\\\"

JARVIS_DIR=/opt/muel/OpenJarvis
if [ ! -d \\\"\\\$JARVIS_DIR\\\" ]; then
  sudo mkdir -p /opt/muel
  sudo chown \\\$(whoami):\\\$(whoami) /opt/muel
  git clone https://github.com/open-jarvis/OpenJarvis.git \\\"\\\$JARVIS_DIR\\\"
fi

cd \\\"\\\$JARVIS_DIR\\\"
uv sync --extra server 2>&1 || pip3 install --break-system-packages -e . 2>&1
sudo ln -sf \\\"\\\$JARVIS_DIR/.venv/bin/jarvis\\\" /usr/local/bin/jarvis 2>/dev/null || true

# Configure jarvis with LiteLLM engine
mkdir -p \\\$HOME/.openjarvis
cat > \\\$HOME/.openjarvis/config.toml << TOMLEOF
[engine]
type = \\\"litellm\\\"
base_url = \\\"https://muel-litellm-proxy.onrender.com\\\"
model = \\\"muel-balanced\\\"

[memory]
backend = \\\"local\\\"
path = \\\"/opt/muel/jarvis-memory\\\"
TOMLEOF

echo 'OpenJarvis install complete'
jarvis --version 2>/dev/null || echo 'version check skipped'
"
ok "OpenJarvis installed on GCP VM"

# Step 5: Setup jarvis serve systemd unit
echo ""
echo "--- Step 5: Setting up jarvis serve systemd ---"

gcloud compute ssh "$INSTANCE" --project="$PROJECT" --zone="$ZONE" --quiet --command="
set -euo pipefail

JARVIS_BIN=\\\$(command -v jarvis || echo /usr/local/bin/jarvis)
sudo tee /etc/systemd/system/openjarvis-serve.service > /dev/null << SVCEOF
[Unit]
Description=OpenJarvis Serve (Stanford) - Full Mode
After=network.target

[Service]
Type=simple
User=muel
EnvironmentFile=-/opt/muel/muel-platform/config/env/openjarvis-worker.gcp.env
ExecStart=/bin/bash -lc 'export PATH="\\\$HOME/.local/bin:\\\$PATH"; if [ -z "\\\${OPENJARVIS_API_KEY:-}" ] && [ -n "\\\${OPENJARVIS_SERVE_API_KEY:-}" ]; then export OPENJARVIS_API_KEY="\\\$OPENJARVIS_SERVE_API_KEY"; fi; exec "\\\$1" serve --engine litellm --host 0.0.0.0 --port 8000' _ \\\$JARVIS_BIN
Restart=always
RestartSec=5
WorkingDirectory=/opt/muel/OpenJarvis

[Install]
WantedBy=multi-user.target
SVCEOF

sudo systemctl daemon-reload
sudo systemctl enable openjarvis-serve
sudo systemctl restart openjarvis-serve
echo 'jarvis serve systemd unit active'
"
ok "jarvis serve systemd unit deployed"

# Step 6: Restart all workers and health check
echo ""
echo "--- Step 6: Restarting workers and health check ---"

gcloud compute ssh "$INSTANCE" --project="$PROJECT" --zone="$ZONE" --quiet --command="
set -euo pipefail
for svc in opencode-local-worker opendev-worker nemoclaw-worker openjarvis-worker openjarvis-serve; do
  sudo systemctl restart \\\$svc 2>/dev/null || true
done
echo 'All services restarted'
"

# Health checks (remote)
echo ""
echo "--- Health Checks ---"

VM_IP=$(gcloud compute instances describe "$INSTANCE" \
  --project="$PROJECT" --zone="$ZONE" \
  --format='get(networkInterfaces[0].accessConfigs[0].natIP)' 2>/dev/null)
PUBLIC_BASE="https://$VM_IP.sslip.io"

ENDPOINTS=(
  "opencode-worker|$PUBLIC_BASE/health"
  "opendev-worker|$PUBLIC_BASE/architect/health"
  "nemoclaw-worker|$PUBLIC_BASE/review/health"
  "openjarvis-worker|$PUBLIC_BASE/operate/health"
  "openjarvis-serve|$PUBLIC_BASE/openjarvis/health"
)

PASS=0
for entry in "${ENDPOINTS[@]}"; do
  name="${entry%%|*}"
  url="${entry#*|}"
  if curl -sf --max-time 10 "$url" &>/dev/null; then
    ok "$name: healthy via $url"
    PASS=$((PASS + 1))
  else
    warn "$name: not responding via $url"
  fi
done

if [ "$PASS" -lt "${#ENDPOINTS[@]}" ]; then
  fail "One or more upgraded services are unhealthy after resize"
fi

echo ""
echo "============================================"
echo "  Upgrade complete: $CURRENT_TYPE -> $NEW_MACHINE_TYPE"
echo "  Workers healthy: $PASS/${#ENDPOINTS[@]}"
echo "  VM IP: $VM_IP"
echo ""
echo "  Cost delta: ~\$6.12/month"
echo "  Benefit: 24/7 jarvis serve (bench/optimize/trace)"
echo "============================================"
