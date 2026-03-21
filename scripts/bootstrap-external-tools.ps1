<#
.SYNOPSIS
  External Tool Layer readiness check for Windows.
.DESCRIPTION
  Verifies that CLI tools, APIs, and environment variables required by
  the External Tool Integration Plan are present and reachable.
  Mirrors scripts/bootstrap-external-tools.sh for Linux/macOS.
.PARAMETER CheckOnly
  Only report; do not attempt any installation hints.
.EXAMPLE
  pwsh scripts/bootstrap-external-tools.ps1
  pwsh scripts/bootstrap-external-tools.ps1 -CheckOnly
#>
[CmdletBinding()]
param(
    [switch]$CheckOnly
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Continue'

$script:Score = 0
$script:Total = 0

function Write-Ok { param([string]$Msg) Write-Host "[OK]   $Msg" -ForegroundColor Green }
function Write-Warn { param([string]$Msg) Write-Host "[WARN] $Msg" -ForegroundColor Yellow }
function Write-Fail { param([string]$Msg) Write-Host "[FAIL] $Msg" -ForegroundColor Red }

function Test-Command {
    param(
        [string]$Name,
        [string]$Command,
        [string]$InstallHint = ''
    )
    $script:Total++
    $exe = Get-Command $Command -ErrorAction SilentlyContinue
    if ($exe) {
        $ver = 'unknown'
        try { $ver = (& $Command --version 2>&1 | Select-Object -First 1) } catch {}
        Write-Ok "$Name`: $ver"
        $script:Score++
        return $true
    }
    else {
        Write-Fail "$Name`: not found ($Command)"
        if ($InstallHint) { Write-Host "       Install: $InstallHint" }
        return $false
    }
}

function Test-Url {
    param(
        [string]$Name,
        [string]$Url
    )
    $script:Total++
    try {
        $resp = Invoke-RestMethod -Uri $Url -Method Get -TimeoutSec 5 -ErrorAction Stop
        Write-Ok "$Name`: reachable at $Url"
        $script:Score++
        return $true
    }
    catch {
        Write-Fail "$Name`: unreachable at $Url"
        return $false
    }
}

function Test-EnvVar {
    param(
        [string]$Name,
        [string]$VarName
    )
    $script:Total++
    $val = [Environment]::GetEnvironmentVariable($VarName)
    if (-not $val) {
        try { $val = (Get-ChildItem "env:$VarName" -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Value) } catch {}
    }
    if ($val) {
        Write-Ok "$Name`: `$$VarName set"
        $script:Score++
        return $true
    }
    else {
        Write-Warn "$Name`: `$$VarName not set"
        return $false
    }
}

Write-Host ''
Write-Host '=== External Tool Layer Readiness Check (Windows) ===' -ForegroundColor Cyan
Write-Host ''

# --- Prerequisites ---
Write-Host '--- Prerequisites ---'
Test-Command 'Node.js'  'node'   'https://nodejs.org or nvm-windows' | Out-Null
Test-Command 'npm'      'npm'    'comes with Node.js' | Out-Null
Test-Command 'Docker'   'docker' 'https://docs.docker.com/get-docker/' | Out-Null
Test-Command 'Git'      'git'    'https://git-scm.com/download/win' | Out-Null
Test-Command 'Python'   'python' 'https://python.org or winget install Python.Python.3.13' | Out-Null
Test-Command 'uv'       'uv'    'pip install uv' | Out-Null
Test-Command 'curl'     'curl.exe' 'built-in on Windows 10+' | Out-Null

Write-Host ''
Write-Host '--- Ollama (Local LLM) ---'
$ollamaOk = Test-Command 'Ollama' 'ollama' 'https://ollama.com/download'
if ($ollamaOk) {
    $ollamaUrl = if ($env:OLLAMA_BASE_URL) { $env:OLLAMA_BASE_URL } else { 'http://127.0.0.1:11434' }
    Test-Url 'Ollama API' "$ollamaUrl/api/tags" | Out-Null
    # Check required models
    try {
        $tags = Invoke-RestMethod -Uri "$ollamaUrl/api/tags" -TimeoutSec 5 -ErrorAction Stop
        $modelNames = $tags.models | ForEach-Object { $_.name }
        $requiredModels = @('qwen2.5:7b-instruct', 'mistral:latest')
        foreach ($m in $requiredModels) {
            $script:Total++
            if ($modelNames -contains $m) {
                Write-Ok "  Model $m`: available"
                $script:Score++
            }
            else {
                Write-Warn "  Model $m`: not pulled (ollama pull $m)"
            }
        }
    }
    catch {
        Write-Warn '  Could not query Ollama model list'
    }
}

Write-Host ''
Write-Host '--- NVIDIA OpenShell ---'
Test-Command 'OpenShell' 'openshell' 'curl -LsSf https://raw.githubusercontent.com/NVIDIA/OpenShell/main/install.sh | sh (WSL)' | Out-Null

Write-Host ''
Write-Host '--- NVIDIA NemoClaw ---'
Test-Command 'NemoClaw' 'nemoclaw' 'curl -fsSL https://www.nvidia.com/nemoclaw.sh | bash (WSL)' | Out-Null
Test-EnvVar  'NVIDIA API Key' 'NVIDIA_API_KEY' | Out-Null

Write-Host ''
Write-Host '--- OpenClaw ---'
Test-Command 'OpenClaw' 'openclaw' 'irm https://openclaw.ai/install.ps1 | iex' | Out-Null

Write-Host ''
Write-Host '--- OpenJarvis (Stanford) ---'
$jarvisOk = Test-Command 'OpenJarvis' 'jarvis' 'git clone https://github.com/open-jarvis/OpenJarvis.git && cd OpenJarvis && uv sync'
if ($jarvisOk) {
    try { jarvis doctor 2>&1 | Select-Object -First 5 | ForEach-Object { Write-Host "  $_" } } catch { Write-Warn '  jarvis doctor failed' }
}
$jarvisUrl = if ($env:OPENJARVIS_SERVE_URL) { $env:OPENJARVIS_SERVE_URL } else { 'http://127.0.0.1:8000' }
Test-Url 'OpenJarvis API' "$jarvisUrl/health" | Out-Null

Write-Host ''
Write-Host '--- LiteLLM / Nemotron ---'
Test-EnvVar 'NVIDIA NIM API Key' 'NVIDIA_NIM_API_KEY' | Out-Null
$script:Total++
if (Test-Path 'litellm.config.yaml') {
    if (Select-String -Path 'litellm.config.yaml' -Pattern 'muel-nemotron' -Quiet) {
        Write-Ok 'Nemotron model registered in litellm.config.yaml'
        $script:Score++
    }
    else {
        Write-Warn 'Nemotron model not found in litellm.config.yaml'
    }
}
else {
    Write-Warn 'litellm.config.yaml not found'
}

Write-Host ''
Write-Host '--- .env Integration Check ---'
$script:Total++
if (Test-Path '.env') {
    Write-Ok '.env file present'
    $script:Score++
}
else {
    Write-Fail '.env file missing (copy from .env.example)'
}

Write-Host ''
Write-Host "=== Result: $script:Score/$script:Total checks passed ===" -ForegroundColor Cyan
Write-Host ''

if ($script:Score -eq $script:Total) {
    Write-Ok 'All external tools ready'
    exit 0
}
elseif ($script:Score -ge [math]::Floor($script:Total / 2)) {
    Write-Warn 'Partial readiness — some tools missing'
    exit 0
}
else {
    Write-Fail 'Most tools unavailable — see install hints above'
    exit 1
}
