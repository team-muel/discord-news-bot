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
$script:WslDistro = if ($env:WSL_DISTRO) { $env:WSL_DISTRO } else { 'Ubuntu-24.04' }
$script:DotEnvCache = $null

function Write-Ok { param([string]$Msg) Write-Host "[OK]   $Msg" -ForegroundColor Green }
function Write-Warn { param([string]$Msg) Write-Host "[WARN] $Msg" -ForegroundColor Yellow }
function Write-Fail { param([string]$Msg) Write-Host "[FAIL] $Msg" -ForegroundColor Red }

function Get-DotEnvMap {
    if ($null -ne $script:DotEnvCache) {
        return $script:DotEnvCache
    }

    $map = @{}
    if (Test-Path '.env') {
        foreach ($line in Get-Content '.env') {
            if ($line -match '^\s*#') { continue }
            if ($line -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$') {
                $name = $matches[1]
                $value = $matches[2]
                if ($value.Length -ge 2) {
                    $first = $value.Substring(0, 1)
                    $last = $value.Substring($value.Length - 1, 1)
                    if (($first -eq '"' -and $last -eq '"') -or ($first -eq "'" -and $last -eq "'")) {
                        $value = $value.Substring(1, $value.Length - 2)
                    }
                }
                $map[$name] = $value
            }
        }
    }

    $script:DotEnvCache = $map
    return $script:DotEnvCache
}

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

function Test-DockerEngine {
    param(
        [string]$InstallHint = ''
    )
    $script:Total++
    $exe = Get-Command docker -ErrorAction SilentlyContinue
    if (-not $exe) {
        Write-Fail 'Docker: not found (docker)'
        if ($InstallHint) { Write-Host "       Install: $InstallHint" }
        return $false
    }

    $clientVer = 'unknown'
    try { $clientVer = (& docker --version 2>&1 | Select-Object -First 1) } catch {}

    $serverVer = ''
    try { $serverVer = (& docker version --format '{{.Server.Version}}' 2>$null | Select-Object -First 1) } catch {}
    if ($serverVer) {
        Write-Ok "Docker: $clientVer / server $serverVer"
        $script:Score++
        return $true
    }

    Write-Fail "Docker: CLI found but engine is not running ($clientVer)"
    Write-Host '       Start Docker Desktop and retry.'
    return $false
}

function Test-WslCommand {
    param(
        [string]$Name,
        [string]$Command,
        [string]$ProbeCommand,
        [string]$InstallHint = ''
    )
    $script:Total++
    $wsl = Get-Command wsl.exe -ErrorAction SilentlyContinue
    if (-not $wsl) {
        Write-Fail "$Name`: WSL not found"
        if ($InstallHint) { Write-Host "       Install: $InstallHint" }
        return $false
    }

    $bashScript = @(
        'if [ -f "$HOME/.bashrc" ]; then . "$HOME/.bashrc" >/dev/null 2>&1; fi',
        'if [ -f "$HOME/.profile" ]; then . "$HOME/.profile" >/dev/null 2>&1; fi',
        'if [ -f "$HOME/.nvm/nvm.sh" ]; then . "$HOME/.nvm/nvm.sh" >/dev/null 2>&1; fi',
        'if [ -f "/root/.nvm/nvm.sh" ]; then . "/root/.nvm/nvm.sh" >/dev/null 2>&1; fi',
        'export PATH="$HOME/.local/bin:$HOME/.npm/bin:$HOME/.npm-global/bin:/root/.local/bin:$PATH"',
        "$ProbeCommand 2>&1 | head -1"
    ) -join '; '
    $encodedScript = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($bashScript))
    $wslCommand = "printf '%s' '$encodedScript' | base64 -d | bash"

    try {
        $wslOutput = & wsl.exe -d $script:WslDistro -- bash -lc $wslCommand 2>&1
        $exitCode = $LASTEXITCODE
        $output = $wslOutput | Select-Object -First 1
        if ($exitCode -eq 0 -and $output) {
            Write-Ok "$Name`: $output (via WSL $script:WslDistro)"
            $script:Score++
            return $true
        }
    }
    catch {}

    Write-Fail "$Name`: not found in WSL $script:WslDistro ($Command)"
    if ($InstallHint) { Write-Host "       Install: $InstallHint" }
    return $false
}

function Invoke-WslText {
    param(
        [string]$CommandText
    )

    $wsl = Get-Command wsl.exe -ErrorAction SilentlyContinue
    if (-not $wsl) {
        return [PSCustomObject]@{ Ok = $false; Output = 'WSL not found' }
    }

    $bashScript = @(
        'if [ -f "$HOME/.bashrc" ]; then . "$HOME/.bashrc" >/dev/null 2>&1; fi',
        'if [ -f "$HOME/.profile" ]; then . "$HOME/.profile" >/dev/null 2>&1; fi',
        'if [ -f "$HOME/.nvm/nvm.sh" ]; then . "$HOME/.nvm/nvm.sh" >/dev/null 2>&1; fi',
        'if [ -f "/root/.nvm/nvm.sh" ]; then . "/root/.nvm/nvm.sh" >/dev/null 2>&1; fi',
        'export PATH="$HOME/.local/bin:$HOME/.npm/bin:$HOME/.npm-global/bin:/root/.local/bin:$PATH"',
        "$CommandText 2>&1"
    ) -join '; '
    $encodedScript = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($bashScript))
    $wslCommand = "printf '%s' '$encodedScript' | base64 -d | bash"

    try {
        $wslOutput = & wsl.exe -d $script:WslDistro -- bash -lc $wslCommand 2>&1
        $exitCode = $LASTEXITCODE
        return [PSCustomObject]@{
            Ok     = ($exitCode -eq 0)
            Output = (($wslOutput | Out-String).Trim())
        }
    }
    catch {
        return [PSCustomObject]@{
            Ok     = $false
            Output = ($_ | Out-String).Trim()
        }
    }
}

function Test-Url {
    param(
        [string]$Name,
        [string]$Url
    )
    $script:Total++
    try {
        Invoke-RestMethod -Uri $Url -Method Get -TimeoutSec 5 -ErrorAction Stop | Out-Null
        Write-Ok "$Name`: reachable at $Url"
        $script:Score++
        return $true
    }
    catch {
        Write-Fail "$Name`: unreachable at $Url"
        return $false
    }
}

function Test-UrlAny {
    param(
        [string]$Name,
        [string[]]$Urls,
        [hashtable]$Headers = @{}
    )
    $script:Total++
    foreach ($Url in $Urls) {
        try {
            $statusCode = (Invoke-WebRequest -Uri $Url -Method Get -Headers $Headers -UseBasicParsing -TimeoutSec 5 -ErrorAction Stop).StatusCode
            if ($statusCode -ge 200 -and $statusCode -lt 300) {
                Write-Ok "$Name`: reachable at $Url"
                $script:Score++
                return $true
            }
        }
        catch {
            $statusCode = $null
            try { $statusCode = [int]$_.Exception.Response.StatusCode } catch {}
            if ($statusCode -eq 401) {
                Write-Ok "$Name`: reachable at $Url (auth required)"
                $script:Score++
                return $true
            }
        }
    }
    Write-Fail "$Name`: unreachable at $($Urls -join ', ')"
    return $false
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
    if (-not $val) {
        $dotEnv = Get-DotEnvMap
        if ($dotEnv.ContainsKey($VarName)) {
            $val = $dotEnv[$VarName]
        }
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
Test-DockerEngine 'https://docs.docker.com/get-docker/' | Out-Null
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
        if ($env:OLLAMA_MODEL) {
            $requiredModels += $env:OLLAMA_MODEL
        }
        if ($env:NEMOCLAW_INFERENCE_MODEL) {
            $requiredModels += $env:NEMOCLAW_INFERENCE_MODEL
        }
        $requiredModels = $requiredModels | Where-Object { $_ } | Select-Object -Unique
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
$openShellOk = Test-WslCommand 'OpenShell' 'openshell' 'which openshell || ls -l "$HOME/.local/bin/openshell" || ls -l "/usr/local/bin/openshell"' 'curl -LsSf https://raw.githubusercontent.com/NVIDIA/OpenShell/main/install.sh | sh (WSL)'
$dotEnv = Get-DotEnvMap
$sandboxName = if ($env:NEMOCLAW_SANDBOX_NAME) { $env:NEMOCLAW_SANDBOX_NAME } elseif ($dotEnv.ContainsKey('NEMOCLAW_SANDBOX_NAME')) { $dotEnv['NEMOCLAW_SANDBOX_NAME'] } else { 'muel-assistant' }
if ($openShellOk) {
    $script:Total++
    $sandboxList = Invoke-WslText "openshell sandbox list --names"
    if ($sandboxList.Ok -and (($sandboxList.Output -split "`r?`n") -contains $sandboxName)) {
        Write-Ok "OpenShell sandbox $sandboxName`: registered"
        $script:Score++
    }
    elseif ($sandboxList.Ok) {
        Write-Warn "OpenShell sandbox $sandboxName`: not registered"
    }
    else {
        Write-Warn "OpenShell sandbox list failed: $($sandboxList.Output | Select-Object -First 1)"
    }
}

Write-Host ''
Write-Host '--- NVIDIA NemoClaw ---'
Test-WslCommand 'NemoClaw' 'nemoclaw' 'ls -l "$HOME/.local/bin/nemoclaw" || ls -l "$HOME/.nvm/versions/node/$(node -v 2>/dev/null)/bin/nemoclaw"' 'curl -fsSL https://www.nvidia.com/nemoclaw.sh | bash -s -- --non-interactive (WSL)' | Out-Null
Test-EnvVar  'NVIDIA API Key' 'NVIDIA_API_KEY' | Out-Null

Write-Host ''
Write-Host '--- OpenClaw ---'
$openClawOk = Test-Command 'OpenClaw' 'openclaw' 'irm https://openclaw.ai/install.ps1 | iex'
if ($openClawOk) {
    $script:Total++
    try {
        $modelStatus = openclaw models status --json | ConvertFrom-Json -ErrorAction Stop
        if ($modelStatus.defaultModel) {
            Write-Ok "OpenClaw default model: $($modelStatus.defaultModel)"
            $script:Score++
        }
        else {
            Write-Warn 'OpenClaw default model unavailable'
        }
    }
    catch {
        Write-Warn 'OpenClaw model status unavailable'
    }

    $gatewayUrl = if ($env:OPENCLAW_GATEWAY_URL) { $env:OPENCLAW_GATEWAY_URL } elseif ($dotEnv.ContainsKey('OPENCLAW_GATEWAY_URL')) { $dotEnv['OPENCLAW_GATEWAY_URL'] } elseif ($env:OPENCLAW_BASE_URL) { $env:OPENCLAW_BASE_URL } elseif ($dotEnv.ContainsKey('OPENCLAW_BASE_URL')) { $dotEnv['OPENCLAW_BASE_URL'] } else { $null }
    if ($gatewayUrl) {
        $script:Total++
        try {
            $gatewayResp = Invoke-WebRequest -Uri "$gatewayUrl/v1/models" -Method Get -UseBasicParsing -TimeoutSec 5 -ErrorAction Stop
            $contentType = [string]$gatewayResp.Headers['Content-Type']
            if ($contentType -match 'application/json') {
                Write-Ok "OpenClaw chat surface: JSON at $gatewayUrl/v1/models"
                $script:Score++
            }
            else {
                Write-Warn "OpenClaw gateway is control-only at $gatewayUrl (content-type: $contentType)"
            }
        }
        catch {
            Write-Warn "OpenClaw chat surface unreachable at $gatewayUrl/v1/models"
        }
    }
}

Write-Host ''
Write-Host '--- OpenJarvis (Stanford) ---'
$jarvisOk = Test-Command 'OpenJarvis' 'jarvis' 'git clone https://github.com/open-jarvis/OpenJarvis.git && cd OpenJarvis && uv sync'
if ($jarvisOk) {
    try { jarvis doctor 2>&1 | Select-Object -First 5 | ForEach-Object { Write-Host "  $_" } } catch { Write-Warn '  jarvis doctor failed' }
}
$jarvisUrl = if ($env:OPENJARVIS_SERVE_URL) { $env:OPENJARVIS_SERVE_URL } else { 'http://127.0.0.1:8000' }
$jarvisHeaders = @{}
$jarvisApiKey = if ($env:OPENJARVIS_API_KEY) { $env:OPENJARVIS_API_KEY } elseif ($env:OPENJARVIS_SERVE_API_KEY) { $env:OPENJARVIS_SERVE_API_KEY } else { $null }
if ($jarvisApiKey) {
    $jarvisHeaders.Authorization = "Bearer $jarvisApiKey"
}
Test-UrlAny 'OpenJarvis API' @("$jarvisUrl/v1/models", "$jarvisUrl/health") $jarvisHeaders | Out-Null

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
Write-Host '--- Local Implement Worker ---'
$workerUrl = if ($env:MCP_IMPLEMENT_WORKER_URL) { $env:MCP_IMPLEMENT_WORKER_URL.TrimEnd('/') } elseif ($dotEnv.ContainsKey('MCP_IMPLEMENT_WORKER_URL')) { $dotEnv['MCP_IMPLEMENT_WORKER_URL'].TrimEnd('/') } else { 'http://127.0.0.1:8787' }
$script:Total++
try {
    $workerHealth = Invoke-RestMethod -Uri "$workerUrl/health" -Method Get -TimeoutSec 5 -ErrorAction Stop
    if ($workerHealth.ok -or $workerHealth.service) {
        Write-Ok "Implement worker: reachable at $workerUrl"
        $script:Score++
    }
    else {
        Write-Warn "Implement worker responded unexpectedly at $workerUrl"
    }
}
catch {
    Write-Warn "Implement worker: unreachable at $workerUrl"
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
    Write-Warn 'Partial readiness - some tools missing'
    exit 0
}
else {
    Write-Fail 'Most tools unavailable — see install hints above'
    exit 1
}
