#!/usr/bin/env bash
# Setup OpenJarvis on GCP VM (e2-micro, Debian/Ubuntu)
#
# NOTE: Stanford OpenJarvis (open-jarvis/OpenJarvis) is NOT published on PyPI.
# Installation requires: git clone + uv sync (~200MB+ with dependencies).
# On e2-micro (1GB RAM), this may OOM during dependency compilation.
#
# LITE MODE (recommended for e2-micro):
#   Skip this script entirely. Set OPENJARVIS_ENABLED=true and LITELLM_BASE_URL
#   in the worker env. The adapter will use LiteLLM proxy for jarvis.ask directly.
#   jarvis.optimize/bench/trace require the full CLI and are unavailable in lite mode.
#
# FULL INSTALL (requires e2-small/2GB+ RAM):
#   git clone https://github.com/open-jarvis/OpenJarvis.git /opt/openjarvis
#   cd /opt/openjarvis && pip install --break-system-packages -e .
#   jarvis init --engine litellm
#
# Usage: bash scripts/setup-gcp-openjarvis.sh
# Run as the same user that runs the role workers.

set -euo pipefail

LITELLM_PROXY_URL="${LITELLM_BASE_URL:-https://muel-litellm-proxy.onrender.com}"
LITELLM_MODEL="${LITELLM_MODEL:-muel-balanced}"

echo "=== GCP OpenJarvis CLI Setup ==="
echo "LiteLLM proxy: ${LITELLM_PROXY_URL}"
echo "Default model: ${LITELLM_MODEL}"
echo ""

# 1. Ensure Python 3.11+ and pip
if ! command -v python3 &>/dev/null; then
  echo "[1/5] Installing Python3..."
  sudo apt-get update -qq
  sudo apt-get install -y -qq python3 python3-pip python3-venv
else
  echo "[1/5] Python3 already installed: $(python3 --version)"
fi

# 2. Install OpenJarvis CLI
# Stanford OpenJarvis is NOT on PyPI as "openjarvis".
# The PyPI package "open-jarvis" is a DIFFERENT project (Philipp Scheer, CouchDB-based).
echo "[2/5] Attempting OpenJarvis install from GitHub..."
if pip3 install --user --break-system-packages --quiet git+https://github.com/open-jarvis/OpenJarvis.git 2>/dev/null; then
  echo "  Installed from GitHub source"
else
  echo "  WARNING: GitHub install failed (likely OOM on e2-micro)."
  echo "  Falling back to LITE MODE — adapter will use LiteLLM proxy directly."
  echo "  Set OPENJARVIS_ENABLED=true and LITELLM_BASE_URL in worker env."
  echo ""
  echo "  For full install, upgrade VM to e2-small (2GB) and retry."
  echo ""
  echo "=== Lite Mode Active ==="
  echo "Enable in worker env: OPENJARVIS_ENABLED=true"
  echo "  LITELLM_BASE_URL=${LITELLM_PROXY_URL}"
  echo "  LITELLM_MODEL=${LITELLM_MODEL}"
  exit 0
fi

# Ensure ~/.local/bin is in PATH
export PATH="$HOME/.local/bin:$PATH"
if ! grep -q '.local/bin' "$HOME/.bashrc" 2>/dev/null; then
  echo 'export PATH="$HOME/.local/bin:$PATH"' >> "$HOME/.bashrc"
fi

# 3. Verify installation
if ! command -v jarvis &>/dev/null; then
  echo "ERROR: jarvis CLI not found in PATH after install"
  echo "Try: export PATH=\$HOME/.local/bin:\$PATH"
  exit 1
fi
echo "[3/5] jarvis CLI installed: $(jarvis --version 2>/dev/null || echo 'version check failed')"

# 4. Configure OpenJarvis to use LiteLLM as engine
JARVIS_CONFIG_DIR="$HOME/.openjarvis"
JARVIS_CONFIG="$JARVIS_CONFIG_DIR/config.toml"
mkdir -p "$JARVIS_CONFIG_DIR"

cat > "$JARVIS_CONFIG" << EOF
# OpenJarvis config — GCP e2-micro (LiteLLM proxy mode)
# All inference routed through Render LiteLLM proxy.
# No local model loading (insufficient RAM).

[engine]
default = "litellm"

[engine.litellm]
base_url = "${LITELLM_PROXY_URL}"
model = "${LITELLM_MODEL}"
timeout = 30

[agent]
default = "simple"

[logging]
level = "warning"
EOF

echo "[4/5] Config written to ${JARVIS_CONFIG}"

# 5. Verify jarvis can reach LiteLLM proxy
echo "[5/5] Testing LiteLLM proxy connectivity..."
if curl -sf --max-time 10 "${LITELLM_PROXY_URL}/health" >/dev/null 2>&1; then
  echo "  LiteLLM proxy reachable"
else
  echo "  WARNING: LiteLLM proxy not reachable at ${LITELLM_PROXY_URL}"
  echo "  jarvis CLI will still work but inference calls may fail"
fi

echo ""
echo "=== Setup Complete ==="
echo "Enable in worker env: OPENJARVIS_ENABLED=true"
echo "Test: jarvis ask 'Hello, what is 2+2?'"
