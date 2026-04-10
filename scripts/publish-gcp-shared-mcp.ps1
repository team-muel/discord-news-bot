<#
.SYNOPSIS
  Publish the shared MCP surface to the GCP VM.
.DESCRIPTION
  Syncs the shared MCP files needed by the remote unified MCP service, optionally
  reinstalls unified-mcp-http.service, reloads Caddy, and checks the canonical
  shared MCP health endpoint.
.EXAMPLE
  .\scripts\publish-gcp-shared-mcp.ps1 -RestartServices
.EXAMPLE
  .\scripts\publish-gcp-shared-mcp.ps1 -IncludePath src/utils -RestartServices
#>
param(
  [string]$GcpHost = 'fancy@34.56.232.61',
  [string]$PublicHost = '34.56.232.61.sslip.io',
  [string]$RepoDir = '/opt/muel/discord-news-bot',
  [string]$KeyPath = (Join-Path $env:USERPROFILE '.ssh\google_compute_engine'),
  [string[]]$IncludePath = @(),
  [switch]$RestartServices,
  [switch]$SkipCaddyReload,
  [switch]$Force
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
if (-not (Test-Path (Join-Path $repoRoot 'package.json'))) {
  $repoRoot = Split-Path -Parent $PSScriptRoot
}

$defaultPaths = @(
  'config/env/unified-mcp.gcp.env.example',
  'config/runtime/gcp-worker.Caddyfile.template',
  'config/systemd/unified-mcp-http.service',
  'docs/planning/mcp/IDE_MCP_WORKSPACE_SETUP.md',
  'package.json',
  'package-lock.json',
  'scripts/unified-mcp-http.ts',
  'scripts/unified-mcp-stdio.ts',
  'src',
  'tsconfig.json'
)

$allowedDirtyPatterns = @(
  '^\?\? config/env/.*\.env(?:\.bak)?$',
  '^\?\? config/runtime/.*$',
  '^\?\? docs/\.obsidian/.*$',
  '^\?\? docs/ops/.*$'
)

function Write-Step($n, $msg) { Write-Host "`n[$n] $msg" -ForegroundColor Cyan }
function Write-Ok($msg) { Write-Host "  OK  $msg" -ForegroundColor Green }
function Write-Warn($msg) { Write-Host "  WARN  $msg" -ForegroundColor Yellow }
function Write-Fail($msg) { Write-Host "  FAIL  $msg" -ForegroundColor Red }

function Invoke-Ssh([string]$command) {
  & ssh -o ConnectTimeout=10 -o StrictHostKeyChecking=accept-new -i $KeyPath $GcpHost $command 2>&1
}

$remoteUser = if ($GcpHost -match '^(?<user>[^@]+)@') { $Matches.user } else { 'fancy' }
$remoteHome = "/home/$remoteUser"
$archivePath = Join-Path $repoRoot 'tmp\shared-mcp-rollout.tar'

$syncPaths = New-Object System.Collections.Generic.List[string]
foreach ($relPath in ($defaultPaths + $IncludePath)) {
  if (-not $syncPaths.Contains($relPath)) {
    $syncPaths.Add($relPath)
  }
}

foreach ($relPath in $syncPaths) {
  if (-not (Test-Path (Join-Path $repoRoot $relPath))) {
    throw "Missing sync path: $relPath"
  }
}

Push-Location $repoRoot
try {
  Write-Host "`n=== Publish GCP Shared MCP ===" -ForegroundColor Magenta
  Write-Host "Repo: $repoRoot" -ForegroundColor Gray
  Write-Host "Target: ${GcpHost}:$RepoDir" -ForegroundColor Gray

  Write-Step 1 'Checking remote repository state...'
  $statusOutput = (Invoke-Ssh "bash -lc 'set -e; cd $RepoDir; git rev-parse --is-inside-work-tree >/dev/null; git status --porcelain'") | Out-String
  $statusLines = @($statusOutput -split "`r?`n" | Where-Object { $_.Trim() })
  $blockingStatus = New-Object System.Collections.Generic.List[string]
  $allowedStatus = New-Object System.Collections.Generic.List[string]

  foreach ($line in $statusLines) {
    $isAllowed = $false
    foreach ($pattern in $allowedDirtyPatterns) {
      if ($line -match $pattern) {
        $allowedStatus.Add($line)
        $isAllowed = $true
        break
      }
    }

    if (-not $isAllowed) {
      $blockingStatus.Add($line)
    }
  }

  if ($allowedStatus.Count -gt 0) {
    Write-Warn 'Ignoring deployment-local artifacts in the remote repo:'
    $allowedStatus | ForEach-Object { Write-Host $_ -ForegroundColor DarkGray }
  }

  if ($blockingStatus.Count -gt 0) {
    if (-not $Force) {
      Write-Fail 'Remote repo has blocking changes. Re-run with -Force only if you intend to overwrite them.'
      $blockingStatus | ForEach-Object { Write-Host $_ -ForegroundColor DarkYellow }
      exit 1
    }
    Write-Warn 'Remote repo has blocking changes, but continuing because -Force was supplied.'
    $blockingStatus | ForEach-Object { Write-Host $_ -ForegroundColor DarkYellow }
  }
  else {
    Write-Ok 'Remote repo is publishable'
  }

  Write-Step 2 'Creating rollout archive...'
  if (Test-Path $archivePath) {
    Remove-Item $archivePath -Force
  }
  & tar -cf $archivePath @($syncPaths.ToArray())
  if (-not (Test-Path $archivePath)) {
    throw 'Failed to create rollout archive'
  }
  Write-Ok "Archive created at $archivePath"

  Write-Step 3 'Uploading and extracting shared MCP files...'
  & scp -q -i $KeyPath $archivePath "$GcpHost`:/tmp/shared-mcp-rollout.tar"
  $extractOutput = Invoke-Ssh "bash -lc 'set -e; mkdir -p $RepoDir; tar -xf /tmp/shared-mcp-rollout.tar -C $RepoDir; rm -f /tmp/shared-mcp-rollout.tar; echo REMOTE_SYNC_OK'"
  if (($extractOutput | Out-String) -match 'REMOTE_SYNC_OK') {
    Write-Ok 'Remote sync complete'
  }
  else {
    throw "Remote sync did not complete cleanly: $extractOutput"
  }

  if ($RestartServices) {
    Write-Step 4 'Reinstalling shared MCP service and reloading ingress...'
    $caddyBlock = if ($SkipCaddyReload) {
      "echo CADDY_SKIPPED"
    }
    else {
      @"
if [ -f $RepoDir/config/runtime/gcp-worker.Caddyfile.template ]; then
  sed "s|__WORKER_HOST__|$PublicHost|g" $RepoDir/config/runtime/gcp-worker.Caddyfile.template | sudo tee /etc/caddy/Caddyfile >/dev/null
  if sudo systemctl is-active --quiet caddy; then
    sudo systemctl reload caddy
  else
    sudo systemctl start caddy
  fi
  echo CADDY_RELOADED
fi
"@
    }

    $restartScript = (@"
set -e
if [ ! -f $RepoDir/config/env/unified-mcp.gcp.env ] && [ -f $RepoDir/config/env/unified-mcp.gcp.env.example ]; then
  cp $RepoDir/config/env/unified-mcp.gcp.env.example $RepoDir/config/env/unified-mcp.gcp.env
fi
sed \
  -e "s|^User=.*|User=$remoteUser|" \
  -e "s|/opt/muel/muel-platform|$RepoDir|g" \
  -e "s|/opt/muel/discord-news-bot|$RepoDir|g" \
  -e "s|Environment=HOME=/opt/muel|Environment=HOME=$remoteHome|" \
  $RepoDir/config/systemd/unified-mcp-http.service | sed 's/\r$//' | sudo tee /etc/systemd/system/unified-mcp-http.service >/dev/null
sudo systemctl daemon-reload
sudo systemctl stop unified-mcp-http >/dev/null 2>&1 || true
sudo pkill -f '$RepoDir/scripts/unified-mcp-http.ts' >/dev/null 2>&1 || true
sudo systemctl reset-failed unified-mcp-http >/dev/null 2>&1 || true
sudo systemctl enable unified-mcp-http >/dev/null
sudo systemctl start unified-mcp-http
$caddyBlock
echo RESTART_OK
"@) -replace "`r", ''
    $restartBase64 = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($restartScript))
    $restartOutput = Invoke-Ssh ('bash -lc "echo {0} | base64 -d | bash"' -f $restartBase64)

    if (($restartOutput | Out-String) -match 'RESTART_OK') {
      Write-Ok 'shared MCP service restart complete'
    }
    else {
      throw "Service restart did not complete cleanly: $restartOutput"
    }
  }

  Write-Step 5 'Checking canonical shared MCP health...'
  $health = Invoke-RestMethod -Method Get -Uri "https://$PublicHost/mcp/health" -TimeoutSec 10
  if ($health.status -ne 'ok') {
    throw 'Shared MCP health probe returned a non-ok status'
  }

  Write-Ok "Shared MCP healthy (tools=$($health.tools))"
  Write-Host "  Canonical: https://$PublicHost/mcp/health" -ForegroundColor Gray
  Write-Host "  Compatibility: https://$PublicHost/obsidian/health" -ForegroundColor Gray
}
finally {
  if (Test-Path $archivePath) {
    Remove-Item $archivePath -Force
  }
  Pop-Location
}