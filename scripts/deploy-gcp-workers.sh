#!/usr/bin/env bash
# deploy-gcp-workers.sh ??Bootstrap and deploy all MCP role workers on a GCP VM
#
# Prerequisites:
#   - GCP VM running Debian/Ubuntu with Node 22+ and npm
#   - Repo cloned at /opt/muel/discord-news-bot
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

REPO_DIR="${REPO_DIR:-/opt/muel/discord-news-bot}"
GCP_VM_IP="${GCP_VM_IP:-$(curl -sf http://metadata.google.internal/computeMetadata/v1/instance/network-interfaces/0/access-configs/0/external-ip -H 'Metadata-Flavor: Google' 2>/dev/null || echo '0.0.0.0')}"
CADDY_HOST="${CADDY_HOST:-${GCP_VM_IP}.sslip.io}"
OBSIDIAN_SYSTEMD_USER="${OBSIDIAN_SYSTEMD_USER:-muel}"
OBSIDIAN_APP_BIN="${OBSIDIAN_APP_BIN:-/opt/obsidian-app/obsidian}"
INSTALL_TOOLS=false
SKIP_SYSTEMD=false

for arg in "$@"; do
  case "$arg" in
    --install-tools) INSTALL_TOOLS=true ;;
    --skip-systemd)  SKIP_SYSTEMD=true ;;
    --caddy-host=*) CADDY_HOST="${arg#*=}" ;;
  esac
done

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
ok()   { printf "${GREEN}[OK]${NC}   %s\n" "$1"; }
warn() { printf "${YELLOW}[WARN]${NC} %s\n" "$1"; }
fail() { printf "${RED}[FAIL]${NC} %s\n" "$1"; }
info() { printf "       %s\n" "$1"; }
FAILURES=0
record_failure() { fail "$1"; FAILURES=$((FAILURES + 1)); }

echo ""
echo "============================================"
echo "  GCP Worker Deployment ??Muel Platform"
echo "============================================"
echo "  Repo: $REPO_DIR"
echo "  VM IP: $GCP_VM_IP"
echo "  Caddy Host: $CADDY_HOST"
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
copy_env_if_missing "$ENV_DIR/unified-mcp.gcp.env.example" "$ENV_DIR/unified-mcp.gcp.env"

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

  if ! id -u "$OBSIDIAN_SYSTEMD_USER" &>/dev/null; then
    record_failure "Obsidian systemd user '$OBSIDIAN_SYSTEMD_USER' does not exist"
  fi

  OBSIDIAN_SYSTEMD_HOME="$(getent passwd "$OBSIDIAN_SYSTEMD_USER" 2>/dev/null | cut -d: -f6)"
  OBSIDIAN_SYSTEMD_HOME="${OBSIDIAN_SYSTEMD_HOME:-/opt/muel}"

  install_obsidian_unit() {
    local source="$1"
    local target="$2"
    sed \
      -e "s|^User=.*|User=$OBSIDIAN_SYSTEMD_USER|" \
      -e "s|/opt/muel/muel-platform|$REPO_DIR|g" \
      -e "s|/opt/muel/discord-news-bot|$REPO_DIR|g" \
      -e "s|Environment=HOME=/opt/muel|Environment=HOME=$OBSIDIAN_SYSTEMD_HOME|" \
      -e "s|/opt/obsidian-app/obsidian|$OBSIDIAN_APP_BIN|g" \
      "$source" > "$target"
  }

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

  # Also install and start OpenJarvis serve if available
  if command -v jarvis &>/dev/null; then
    echo ""
    echo "--- Installing OpenJarvis serve ---"
    JARVIS_BIN="$(command -v jarvis)"
    cat > /etc/systemd/system/openjarvis-serve.service <<EOF
[Unit]
Description=OpenJarvis Serve (Stanford)
After=network.target

[Service]
Type=simple
User=muel
WorkingDirectory=$REPO_DIR
EnvironmentFile=-$ENV_DIR/openjarvis-worker.gcp.env
ExecStart=/bin/bash -lc 'export PATH="$HOME/.local/bin:$PATH"; if [ -z "${OPENJARVIS_API_KEY:-}" ] && [ -n "${OPENJARVIS_SERVE_API_KEY:-}" ]; then export OPENJARVIS_API_KEY="$OPENJARVIS_SERVE_API_KEY"; fi; exec "$1" serve --engine litellm --host 0.0.0.0 --port 8000' _ "$JARVIS_BIN"
Restart=always
RestartSec=5
Environment=OLLAMA_BASE_URL=http://127.0.0.1:11434

[Install]
WantedBy=multi-user.target
EOF
    systemctl daemon-reload
    systemctl enable openjarvis-serve
    systemctl restart openjarvis-serve
    if systemctl is-active --quiet openjarvis-serve 2>/dev/null; then
      ok "openjarvis-serve started on port 8000"
    else
      record_failure "openjarvis-serve failed to start"
    fi
  fi

  if [ -x "$OBSIDIAN_APP_BIN" ] && command -v xvfb-run &>/dev/null; then
    echo ""
    echo "--- Installing shared unified MCP / Obsidian services ---"
    for unit in obsidian-headless.service unified-mcp-http.service obsidian-lore-sync.service; do
      source="$SYSTEMD_DIR/$unit"
      target="/etc/systemd/system/$unit"
      if [ -f "$source" ]; then
        install_obsidian_unit "$source" "$target"
        ok "Installed $unit"
      else
        record_failure "$source not found"
      fi
    done
    if [ -f "$SYSTEMD_DIR/obsidian-lore-sync.timer" ]; then
      cp "$SYSTEMD_DIR/obsidian-lore-sync.timer" /etc/systemd/system/obsidian-lore-sync.timer
      ok "Installed obsidian-lore-sync.timer"
    else
      record_failure "$SYSTEMD_DIR/obsidian-lore-sync.timer not found"
    fi

    systemctl daemon-reload
    systemctl enable obsidian-headless unified-mcp-http 2>/dev/null || true
    systemctl restart obsidian-headless 2>/dev/null || true
    systemctl restart unified-mcp-http 2>/dev/null || true
    systemctl enable obsidian-lore-sync.timer 2>/dev/null || true
    systemctl start obsidian-lore-sync.timer 2>/dev/null || true

    if systemctl is-active --quiet obsidian-headless 2>/dev/null; then
      ok "obsidian-headless started"
    else
      record_failure "obsidian-headless failed to start"
    fi

    if systemctl is-active --quiet unified-mcp-http 2>/dev/null; then
      ok "unified-mcp-http started"
    else
      record_failure "unified-mcp-http failed to start"
    fi

    if systemctl is-active --quiet obsidian-lore-sync.timer 2>/dev/null; then
      ok "obsidian-lore-sync.timer active"
    else
      warn "obsidian-lore-sync.timer is not active"
    fi
  else
    warn "Obsidian remote-mcp prerequisites missing (need xvfb-run and $OBSIDIAN_APP_BIN); skipping obsidian systemd install"
  fi

  CADDY_TEMPLATE="$REPO_DIR/config/runtime/gcp-worker.Caddyfile.template"
  if command -v caddy &>/dev/null; then
    if [ -f "$CADDY_TEMPLATE" ]; then
      mkdir -p /etc/caddy
      sed "s|__WORKER_HOST__|$CADDY_HOST|g" "$CADDY_TEMPLATE" > /etc/caddy/Caddyfile
      systemctl enable caddy 2>/dev/null || true
      if systemctl is-active --quiet caddy 2>/dev/null; then
        systemctl reload caddy
      else
        systemctl start caddy
      fi
      ok "Installed Caddy public ingress for $CADDY_HOST"
    else
      warn "$CADDY_TEMPLATE not found; skipping Caddy public ingress install"
    fi
  else
    warn "caddy not found; skipping public ingress install"
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
    record_failure "$name: not responding on port $port"
  fi
done

# Check OpenJarvis serve
if systemctl is-enabled --quiet openjarvis-serve 2>/dev/null; then
  if curl -sf --max-time 5 "http://127.0.0.1:8000/health" &>/dev/null; then
    ok "OpenJarvis serve: healthy on port 8000"
  else
    record_failure "OpenJarvis serve: not responding on port 8000"
  fi
else
  warn "OpenJarvis serve: systemd unit is not installed"
fi

if systemctl is-enabled --quiet unified-mcp-http 2>/dev/null; then
  if curl -sf --max-time 5 "http://127.0.0.1:8850/health" &>/dev/null; then
    ok "Unified MCP HTTP: healthy on port 8850"
  else
    record_failure "Unified MCP HTTP: not responding on port 8850"
  fi
else
  warn "Unified MCP HTTP: systemd unit is not installed"
fi

# Check Ollama
if curl -sf --max-time 5 "http://127.0.0.1:11434/api/tags" &>/dev/null; then
  ok "Ollama: healthy on port 11434"
else
  warn "Ollama: not responding on port 11434"
fi

PUBLIC_ENDPOINTS=(
  "implement:https://$CADDY_HOST/health"
  "architect:https://$CADDY_HOST/architect/health"
  "review:https://$CADDY_HOST/review/health"
  "operate:https://$CADDY_HOST/operate/health"
  "openjarvis:https://$CADDY_HOST/openjarvis/health"
  "obsidian:https://$CADDY_HOST/obsidian/health"
)

echo ""
echo "--- 6. Public Ingress Checks ---"

for entry in "${PUBLIC_ENDPOINTS[@]}"; do
  name="${entry%%:*}"
  url="${entry#*:}"
  if curl -sf --max-time 10 "$url" &>/dev/null; then
    ok "$name: healthy via $url"
  else
    warn "$name: not responding via $url"
  fi
done

echo ""
echo "============================================"
echo "  Workers: $PASS/$TOTAL healthy"
echo "  Additional failures: $FAILURES"
echo ""
echo "  Worker URLs for Render env vars:"
echo "    MCP_IMPLEMENT_WORKER_URL=https://$CADDY_HOST"
echo "    MCP_ARCHITECT_WORKER_URL=https://$CADDY_HOST/architect"
echo "    MCP_REVIEW_WORKER_URL=https://$CADDY_HOST/review"
echo "    MCP_OPERATE_WORKER_URL=https://$CADDY_HOST/operate"
echo "    OPENJARVIS_SERVE_URL=https://$CADDY_HOST/openjarvis"
echo "    OBSIDIAN_REMOTE_MCP_URL=https://$CADDY_HOST/obsidian"
echo "============================================"

if [ "$PASS" -eq "$TOTAL" ] && [ "$FAILURES" -eq 0 ]; then
  ok "All workers deployed successfully!"
  exit 0
else
  warn "Some workers failed ??check logs with: journalctl -u <service-name> -f"
  exit 1
fi
