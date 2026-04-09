#!/usr/bin/env bash
# deploy-gcp-workers.sh ??Bootstrap and deploy all MCP role workers on a GCP VM
#
# Prerequisites:
#   - GCP VM running Debian/Ubuntu with Node 22+ and npm
#   - Repo cloned at /opt/muel/muel-platform
#   - User 'muel' exists (or run as root to create)
#
# Usage:
#   sudo bash scripts/deploy-gcp-workers.sh [--install-tools] [--skip-systemd]
#
# What this script does:
#   1. Verifies prerequisites (node, npm, tsx)
#   2. Optionally installs external tools (OpenJarvis, NemoClaw, OpenShell, Ollama)
#   3. Copies env example files ??active env files (if not already present)
#   4. Installs systemd service units for all workers
#   5. Enables and starts all worker services
#   6. Runs health checks on all worker endpoints
set -euo pipefail

REPO_DIR="${REPO_DIR:-/opt/muel/muel-platform}"
GCP_VM_IP="${GCP_VM_IP:-$(curl -sf http://metadata.google.internal/computeMetadata/v1/instance/network-interfaces/0/access-configs/0/external-ip -H 'Metadata-Flavor: Google' 2>/dev/null || echo '0.0.0.0')}"
INSTALL_TOOLS=false
SKIP_SYSTEMD=false

for arg in "$@"; do
  case "$arg" in
    --install-tools) INSTALL_TOOLS=true ;;
    --skip-systemd)  SKIP_SYSTEMD=true ;;
  esac
done

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
ok()   { printf "${GREEN}[OK]${NC}   %s\n" "$1"; }
warn() { printf "${YELLOW}[WARN]${NC} %s\n" "$1"; }
fail() { printf "${RED}[FAIL]${NC} %s\n" "$1"; }
info() { printf "       %s\n" "$1"; }

echo ""
echo "============================================"
echo "  GCP Worker Deployment ??Muel Platform"
echo "============================================"
echo "  Repo: $REPO_DIR"
echo "  VM IP: $GCP_VM_IP"
echo ""

# ?�?�?� 1. Prerequisites ?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�

echo "--- 1. Prerequisites ---"

if ! command -v node &>/dev/null; then
  fail "Node.js not found. Install with: curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt-get install -y nodejs"
  exit 1
fi
ok "Node.js: $(node --version)"

if ! command -v npm &>/dev/null; then
  fail "npm not found"
  exit 1
fi
ok "npm: $(npm --version)"

# Ensure tsx is available for role workers
if ! npx tsx --version &>/dev/null 2>&1; then
  warn "tsx not found, installing..."
  cd "$REPO_DIR" && npm install tsx --save-dev
fi
ok "tsx available"

# Ensure repo dependencies are installed
if [ ! -d "$REPO_DIR/node_modules" ]; then
  warn "node_modules missing, running npm ci..."
  cd "$REPO_DIR" && npm ci --no-audit --no-fund
fi
ok "Dependencies installed"

# ?�?�?� 2. Install External Tools (optional) ?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�

if [ "$INSTALL_TOOLS" = true ]; then
  echo ""
  echo "--- 2. Installing External Tools ---"

  # Ollama
  if ! command -v ollama &>/dev/null; then
    warn "Installing Ollama..."
    curl -fsSL https://ollama.ai/install.sh | sh
    systemctl enable ollama 2>/dev/null || true
    systemctl start ollama 2>/dev/null || true
    ok "Ollama installed"
  else
    ok "Ollama already installed: $(ollama --version 2>/dev/null | head -1)"
  fi

  # OpenShell (NVIDIA)
  if ! command -v openshell &>/dev/null; then
    warn "Installing OpenShell..."
    curl -LsSf https://raw.githubusercontent.com/NVIDIA/OpenShell/main/install.sh | sh
    ok "OpenShell installed"
  else
    ok "OpenShell already installed: $(openshell --version 2>/dev/null | head -1)"
  fi

  # NemoClaw (NVIDIA)
  if ! command -v nemoclaw &>/dev/null; then
    warn "Installing NemoClaw..."
    curl -fsSL https://www.nvidia.com/nemoclaw.sh | bash
    ok "NemoClaw installed"
  else
    ok "NemoClaw already installed: $(nemoclaw --version 2>/dev/null | head -1)"
  fi

  # OpenClaw
  if ! command -v openclaw &>/dev/null; then
    warn "Installing OpenClaw..."
    curl -fsSL https://openclaw.ai/install.sh | sh
    ok "OpenClaw installed"
  else
    ok "OpenClaw already installed: $(openclaw --version 2>/dev/null | head -1)"
  fi

  # OpenJarvis (Stanford) ??requires Python + uv
  if ! command -v jarvis &>/dev/null; then
    warn "Installing OpenJarvis..."
    if ! command -v uv &>/dev/null; then
      curl -LsSf https://astral.sh/uv/install.sh | sh
      export PATH="$HOME/.local/bin:$PATH"
    fi
    JARVIS_DIR="${JARVIS_DIR:-/opt/muel/OpenJarvis}"
    if [ ! -d "$JARVIS_DIR" ]; then
      git clone https://github.com/open-jarvis/OpenJarvis.git "$JARVIS_DIR"
    fi
    cd "$JARVIS_DIR" && uv sync --extra server
    # Create global symlink
    ln -sf "$JARVIS_DIR/.venv/bin/jarvis" /usr/local/bin/jarvis 2>/dev/null || true
    cd "$REPO_DIR"
    ok "OpenJarvis installed at $JARVIS_DIR"
  else
    ok "OpenJarvis already installed: $(jarvis --version 2>/dev/null | head -1)"
  fi
else
  echo ""
  echo "--- 2. Skipping tool install (use --install-tools to enable) ---"
fi

# ?�?�?� 3. Environment Files ?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�

echo ""
echo "--- 3. Environment Files ---"

ENV_DIR="$REPO_DIR/config/env"
copy_env_if_missing() {
  local src="$1" dst="$2"
  if [ -f "$dst" ]; then
    ok "$(basename "$dst") already exists"
  elif [ -f "$src" ]; then
    cp "$src" "$dst"
    warn "$(basename "$dst") created from example ??edit secrets before starting!"
  else
    fail "$(basename "$src") not found"
  fi
}

copy_env_if_missing "$ENV_DIR/opencode-worker.gcp.env.example" "$ENV_DIR/opencode-worker.gcp.env"
copy_env_if_missing "$ENV_DIR/openjarvis-worker.gcp.env.example" "$ENV_DIR/openjarvis-worker.gcp.env"
copy_env_if_missing "$ENV_DIR/nemoclaw-worker.gcp.env.example" "$ENV_DIR/nemoclaw-worker.gcp.env"
copy_env_if_missing "$ENV_DIR/opendev-worker.gcp.env.example" "$ENV_DIR/opendev-worker.gcp.env"

# ?�?�?� 4. Systemd Services ?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�

if [ "$SKIP_SYSTEMD" = false ]; then
  echo ""
  echo "--- 4. Systemd Services ---"

  SYSTEMD_DIR="$REPO_DIR/config/systemd"
  SERVICES=(
    "opencode-local-worker"
    "openjarvis-worker"
    "nemoclaw-worker"
    "opendev-worker"
  )

  # Create muel user if needed
  if ! id -u muel &>/dev/null; then
    useradd --system --home-dir /opt/muel --shell /usr/sbin/nologin muel 2>/dev/null || true
    ok "Created system user: muel"
  fi

  # Ensure muel owns the repo
  chown -R muel:muel "$REPO_DIR" 2>/dev/null || true

  for svc in "${SERVICES[@]}"; do
    local_file="$SYSTEMD_DIR/$svc.service.example"
    target="/etc/systemd/system/$svc.service"

    if [ -f "$local_file" ]; then
      # Update EnvironmentFile path to use .gcp.env if available
      if [ -f "$ENV_DIR/${svc##*-}.gcp.env" ]; then
        sed "s|EnvironmentFile=.*|EnvironmentFile=$ENV_DIR/${svc}.gcp.env|" "$local_file" > "$target"
      else
        cp "$local_file" "$target"
      fi
      ok "Installed $svc.service"
    else
      warn "$local_file not found"
    fi
  done

  # Fix env file paths in systemd units
  sed -i "s|EnvironmentFile=.*opencode.*|EnvironmentFile=$ENV_DIR/opencode-worker.gcp.env|" /etc/systemd/system/opencode-local-worker.service 2>/dev/null || true
  sed -i "s|EnvironmentFile=.*openjarvis.*|EnvironmentFile=$ENV_DIR/openjarvis-worker.gcp.env|" /etc/systemd/system/openjarvis-worker.service 2>/dev/null || true
  sed -i "s|EnvironmentFile=.*nemoclaw.*|EnvironmentFile=$ENV_DIR/nemoclaw-worker.gcp.env|" /etc/systemd/system/nemoclaw-worker.service 2>/dev/null || true
  sed -i "s|EnvironmentFile=.*opendev.*|EnvironmentFile=$ENV_DIR/opendev-worker.gcp.env|" /etc/systemd/system/opendev-worker.service 2>/dev/null || true

  systemctl daemon-reload

  for svc in "${SERVICES[@]}"; do
    systemctl enable "$svc" 2>/dev/null || true
    systemctl restart "$svc" 2>/dev/null || true
    ok "Enabled and started: $svc"
  done

  # Also start OpenJarvis serve if available
  if command -v jarvis &>/dev/null; then
    echo ""
    echo "--- Starting OpenJarvis serve ---"
    if ! systemctl is-active --quiet openjarvis-serve 2>/dev/null; then
      cat > /etc/systemd/system/openjarvis-serve.service <<EOF
[Unit]
Description=OpenJarvis Serve (Stanford)
After=network.target ollama.service

[Service]
Type=simple
User=muel
ExecStart=$(command -v jarvis) serve
Restart=always
RestartSec=5
Environment=OLLAMA_BASE_URL=http://127.0.0.1:11434

[Install]
WantedBy=multi-user.target
EOF
      systemctl daemon-reload
      systemctl enable openjarvis-serve
      systemctl start openjarvis-serve
      ok "openjarvis-serve started on port 8000"
    else
      ok "openjarvis-serve already running"
    fi
  fi
else
  echo ""
  echo "--- 4. Skipping systemd (use without --skip-systemd to enable) ---"
fi

# ?�?�?� 5. Health Checks ?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�

echo ""
echo "--- 5. Health Checks ---"

sleep 3  # Wait for services to initialize

WORKERS=(
  "opencode-worker:8787"
  "opendev-worker:8791"
  "nemoclaw-worker:8792"
  "openjarvis-worker:8793"
)

PASS=0
TOTAL=${#WORKERS[@]}

for entry in "${WORKERS[@]}"; do
  name="${entry%%:*}"
  port="${entry##*:}"
  if curl -sf --max-time 5 "http://127.0.0.1:$port/health" &>/dev/null; then
    ok "$name: healthy on port $port"
    PASS=$((PASS + 1))
  else
    fail "$name: not responding on port $port"
  fi
done

# Check OpenJarvis serve
if curl -sf --max-time 5 "http://127.0.0.1:8000/health" &>/dev/null; then
  ok "OpenJarvis serve: healthy on port 8000"
else
  warn "OpenJarvis serve: not responding on port 8000"
fi

# Check Ollama
if curl -sf --max-time 5 "http://127.0.0.1:11434/api/tags" &>/dev/null; then
  ok "Ollama: healthy on port 11434"
else
  warn "Ollama: not responding on port 11434"
fi

echo ""
echo "============================================"
echo "  Workers: $PASS/$TOTAL healthy"
echo ""
echo "  Worker URLs for Render env vars:"
echo "    MCP_IMPLEMENT_WORKER_URL=https://$GCP_VM_IP.sslip.io:8787"
echo "    MCP_ARCHITECT_WORKER_URL=https://$GCP_VM_IP.sslip.io:8791"
echo "    MCP_REVIEW_WORKER_URL=https://$GCP_VM_IP.sslip.io:8792"
echo "    MCP_OPERATE_WORKER_URL=https://$GCP_VM_IP.sslip.io:8793"
echo "    OPENJARVIS_SERVE_URL=http://127.0.0.1:8000"
echo "============================================"

if [ "$PASS" -eq "$TOTAL" ]; then
  ok "All workers deployed successfully!"
  exit 0
else
  warn "Some workers failed ??check logs with: journalctl -u <service-name> -f"
  exit 1
fi
