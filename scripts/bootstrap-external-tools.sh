#!/usr/bin/env bash
# bootstrap-external-tools.sh — Checks and optionally installs external tool dependencies
# Usage: bash scripts/bootstrap-external-tools.sh [--check-only] [--install]
set -euo pipefail

CHECK_ONLY=false
INSTALL=false
for arg in "$@"; do
  case "$arg" in
    --check-only) CHECK_ONLY=true ;;
    --install)    INSTALL=true ;;
  esac
done

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

ok()   { printf "${GREEN}[OK]${NC}   %s\n" "$1"; }
warn() { printf "${YELLOW}[WARN]${NC} %s\n" "$1"; }
fail() { printf "${RED}[FAIL]${NC} %s\n" "$1"; }

SCORE=0
TOTAL=0

check_cmd() {
  local name="$1" cmd="$2" install_hint="$3"
  TOTAL=$((TOTAL + 1))
  if command -v "$cmd" &>/dev/null; then
    local ver
    ver=$("$cmd" --version 2>/dev/null | head -1 || echo "unknown")
    ok "$name: $ver"
    SCORE=$((SCORE + 1))
    return 0
  else
    if [ "$INSTALL" = true ]; then
      warn "$name not found — install hint: $install_hint"
    else
      fail "$name not found ($cmd)"
      [ -n "$install_hint" ] && printf "       Install: %s\n" "$install_hint"
    fi
    return 1
  fi
}

check_url() {
  local name="$1" url="$2"
  TOTAL=$((TOTAL + 1))
  if curl -sf --max-time 5 "$url" &>/dev/null; then
    ok "$name: reachable at $url"
    SCORE=$((SCORE + 1))
    return 0
  else
    fail "$name: unreachable at $url"
    return 1
  fi
}

check_env() {
  local name="$1" var="$2"
  TOTAL=$((TOTAL + 1))
  if [ -n "${!var:-}" ]; then
    ok "$name: \$$var set"
    SCORE=$((SCORE + 1))
    return 0
  else
    warn "$name: \$$var not set"
    return 1
  fi
}

echo ""
echo "=== External Tool Layer Readiness Check ==="
echo ""

# --- Prerequisites ---
echo "--- Prerequisites ---"
check_cmd "Docker"  "docker"  "https://docs.docker.com/get-docker/" || true
check_cmd "Node.js" "node"    "nvm install 20" || true
check_cmd "npm"     "npm"     "comes with Node.js" || true
check_cmd "curl"    "curl"    "apt install curl" || true

echo ""
echo "--- Ollama (Local LLM) ---"
check_cmd "Ollama" "ollama" "curl -fsSL https://ollama.ai/install.sh | sh" || true
OLLAMA_URL="${OLLAMA_BASE_URL:-http://127.0.0.1:11434}"
check_url "Ollama API" "$OLLAMA_URL/api/tags" || true

echo ""
echo "--- NVIDIA OpenShell ---"
check_cmd "OpenShell" "openshell" "curl -LsSf https://raw.githubusercontent.com/NVIDIA/OpenShell/main/install.sh | sh" || true
if command -v openshell &>/dev/null; then
  echo "  Sandbox list:"
  openshell sandbox list 2>/dev/null | head -10 || warn "  Could not list sandboxes"
fi

echo ""
echo "--- NVIDIA NemoClaw ---"
check_cmd "NemoClaw" "nemoclaw" "curl -fsSL https://www.nvidia.com/nemoclaw.sh | bash" || true
check_env "NVIDIA API Key" "NVIDIA_API_KEY" || true

echo ""
echo "--- OpenClaw ---"
check_cmd "OpenClaw" "openclaw" "Windows: irm https://openclaw.ai/install.ps1 | iex  |  Linux: curl https://openclaw.ai/install.sh | sh" || true

echo ""
echo "--- OpenJarvis (Stanford) ---"
check_cmd "OpenJarvis" "jarvis" "git clone https://github.com/open-jarvis/OpenJarvis.git && cd OpenJarvis && uv sync" || true
if command -v jarvis &>/dev/null; then
  jarvis doctor 2>/dev/null | head -5 || warn "  jarvis doctor failed"
fi
OPENJARVIS_URL="${OPENJARVIS_SERVE_URL:-http://127.0.0.1:8000}"
check_url "OpenJarvis API" "$OPENJARVIS_URL/health" || true

echo ""
echo "--- LiteLLM / Nemotron ---"
check_env "NVIDIA NIM API Key" "NVIDIA_NIM_API_KEY" || true
if [ -f "litellm.config.yaml" ]; then
  if grep -q "muel-nemotron" litellm.config.yaml; then
    ok "Nemotron model registered in litellm.config.yaml"
    SCORE=$((SCORE + 1))
  else
    warn "Nemotron model not found in litellm.config.yaml"
  fi
  TOTAL=$((TOTAL + 1))
fi

echo ""
echo "=== Result: $SCORE/$TOTAL checks passed ==="
echo ""

if [ "$SCORE" -eq "$TOTAL" ]; then
  ok "All external tools ready"
  exit 0
elif [ "$SCORE" -ge $((TOTAL / 2)) ]; then
  warn "Partial readiness — some tools missing"
  exit 0
else
  fail "Most tools unavailable — see install hints above"
  exit 1
fi
