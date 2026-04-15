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
.EXAMPLE
  .\scripts\publish-gcp-shared-mcp.ps1 -SyncProfile openjarvis-shared-control -RestartServices
#>
param(
  [string]$GcpHost = 'fancy@34.56.232.61',
  [string]$PublicHost = '34.56.232.61.sslip.io',
  [string]$RuntimeDir = '/opt/muel/shared-mcp-runtime',
  [string]$LegacyRepoDir = '/opt/muel/discord-news-bot',
  [string]$KeyPath = (Join-Path $env:USERPROFILE '.ssh\google_compute_engine'),
  [ValidateSet('full', 'openjarvis-shared-control')]
  [string]$SyncProfile = 'full',
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
  '.github',
  'bot.ts',
  'server.ts',
  'ecosystem.config.cjs',
  'ecosystem.role-workers.config.cjs',
  'package.json',
  'package-lock.json',
  'render.yaml',
  'config',
  'docs',
  'retros',
  'scripts',
  'src',
  'tsconfig.json',
  'vitest.config.ts'
)

$openJarvisSharedControlPaths = @(
  'package.json',
  'package-lock.json',
  'config/runtime/operating-baseline.json',
  'docs/planning/EXECUTION_BOARD.md',
  'scripts/bootstrap-n8n-local.mjs',
  'scripts/openjarvis-workflow-state.mjs',
  'scripts/run-hermes-vscode-bridge.ts',
  'scripts/run-openjarvis-goal-cycle.mjs',
  'scripts/sync-openjarvis-memory.ts',
  'scripts/lib/automationActivationPack.mjs',
  'scripts/lib/cliArgs.mjs',
  'scripts/lib/openjarvisAutopilotCapacity.mjs',
  'src/mcp/toolAdapter.ts',
  'src/services/automation/apiFirstAgentFallbackService.ts',
  'src/services/openjarvis/openjarvisAutopilotStatusService.ts',
  'src/services/openjarvis/openjarvisHermesRuntimeControlService.ts',
  'src/services/openjarvis/openjarvisMemorySyncStatusService.ts',
  'src/services/runtime/hermesVsCodeBridgeService.ts'
)

$profilePaths = switch ($SyncProfile) {
  'openjarvis-shared-control' { $openJarvisSharedControlPaths }
  default { $defaultPaths }
}

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
foreach ($relPath in ($profilePaths + $IncludePath)) {
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
  Write-Host "Sync profile: $SyncProfile" -ForegroundColor Gray
  Write-Host "Runtime target: ${GcpHost}:$RuntimeDir" -ForegroundColor Gray
  Write-Host "Legacy source checkout: ${GcpHost}:$LegacyRepoDir" -ForegroundColor DarkGray

  Write-Step 1 'Checking remote runtime target...'
  $runtimeCheck = (Invoke-Ssh "bash -lc 'set -e; mkdir -p $RuntimeDir; if [ -d $RuntimeDir/.git ]; then echo RUNTIME_IS_GIT; fi; echo RUNTIME_READY'") | Out-String
  if ($runtimeCheck -match 'RUNTIME_IS_GIT') {
    if (-not $Force) {
      Write-Fail 'Runtime target is a git checkout. Re-run with -Force only if you intend to overwrite it.'
      exit 1
    }
    Write-Warn 'Runtime target is a git checkout, but continuing because -Force was supplied.'
  }
  if ($runtimeCheck -match 'RUNTIME_READY') {
    Write-Ok 'Runtime target is ready'
  }

  $legacyStatusOutput = (Invoke-Ssh "bash -lc 'if [ -d $LegacyRepoDir/.git ]; then cd $LegacyRepoDir && git status --porcelain; fi'") | Out-String
  $legacyStatusLines = @($legacyStatusOutput -split "`r?`n" | Where-Object { $_.Trim() })
  if ($legacyStatusLines.Count -gt 0) {
    Write-Warn 'Legacy source checkout is dirty, but shared MCP publish no longer blocks on it:'
    $legacyStatusLines | Select-Object -First 20 | ForEach-Object { Write-Host $_ -ForegroundColor DarkGray }
    if ($legacyStatusLines.Count -gt 20) {
      Write-Host "... ($($legacyStatusLines.Count - 20) more lines)" -ForegroundColor DarkGray
    }
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
  $extractOutput = Invoke-Ssh "bash -lc 'set -e; mkdir -p $RuntimeDir; tar -xf /tmp/shared-mcp-rollout.tar -C $RuntimeDir; rm -f /tmp/shared-mcp-rollout.tar; echo REMOTE_SYNC_OK'"
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
if [ -f $RuntimeDir/config/runtime/gcp-worker.Caddyfile.template ]; then
  sed "s|__WORKER_HOST__|$PublicHost|g" $RuntimeDir/config/runtime/gcp-worker.Caddyfile.template | sudo tee /etc/caddy/Caddyfile >/dev/null
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
mkdir -p $RuntimeDir/config/env
if [ ! -f $RuntimeDir/.env ] && [ -f $LegacyRepoDir/.env ]; then
  cp $LegacyRepoDir/.env $RuntimeDir/.env
fi
if [ ! -f $RuntimeDir/config/env/unified-mcp.gcp.env ] && [ -f $LegacyRepoDir/config/env/unified-mcp.gcp.env ]; then
  cp $LegacyRepoDir/config/env/unified-mcp.gcp.env $RuntimeDir/config/env/unified-mcp.gcp.env
elif [ ! -f $RuntimeDir/config/env/unified-mcp.gcp.env ] && [ -f $RuntimeDir/config/env/unified-mcp.gcp.env.example ]; then
  cp $RuntimeDir/config/env/unified-mcp.gcp.env.example $RuntimeDir/config/env/unified-mcp.gcp.env
fi
if [ -L $RuntimeDir/node_modules ]; then
  rm $RuntimeDir/node_modules
fi
if [ -f $RuntimeDir/package.json ]; then
  cd $RuntimeDir
  npm install --ignore-scripts --no-fund --no-audit --loglevel=error >/tmp/shared-mcp-npm-install.log 2>&1 || { cat /tmp/shared-mcp-npm-install.log; exit 1; }
  rm -f /tmp/shared-mcp-npm-install.log
fi
sed \
  -e "s|^User=.*|User=$remoteUser|" \
  -e "s|/opt/muel/shared-mcp-runtime|$RuntimeDir|g" \
  -e "s|/opt/muel/discord-news-bot|$RuntimeDir|g" \
  -e "s|Environment=HOME=/opt/muel|Environment=HOME=$remoteHome|" \
  $RuntimeDir/config/systemd/unified-mcp-http.service | sed 's/\r$//' | sudo tee /etc/systemd/system/unified-mcp-http.service >/dev/null
sudo systemctl daemon-reload
sudo systemctl stop unified-mcp-http >/dev/null 2>&1 || true
sudo pkill -f '$RuntimeDir/scripts/unified-mcp-http.ts' >/dev/null 2>&1 || true
sudo pkill -f '$LegacyRepoDir/scripts/unified-mcp-http.ts' >/dev/null 2>&1 || true
sudo systemctl reset-failed unified-mcp-http >/dev/null 2>&1 || true
sudo systemctl enable unified-mcp-http >/dev/null
sudo systemctl start unified-mcp-http
rm -f /tmp/shared-mcp-local-health.json
for attempt in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21 22 23 24 25 26 27 28 29 30; do
  if curl -fsS http://127.0.0.1:8850/mcp/health >/tmp/shared-mcp-local-health.json 2>/dev/null; then
    cat /tmp/shared-mcp-local-health.json
    rm -f /tmp/shared-mcp-local-health.json
    break
  fi
  sleep 1
done
if [ -f /tmp/shared-mcp-local-health.json ]; then
  rm -f /tmp/shared-mcp-local-health.json
  exit 1
fi
$caddyBlock
echo RESTART_OK
"@) -replace "`r", ''

    $restartScriptPath = Join-Path $env:TEMP 'publish-gcp-shared-mcp-restart.sh'
    [System.IO.File]::WriteAllText($restartScriptPath, $restartScript, [System.Text.UTF8Encoding]::new($false))

    try {
      & scp -q -i $KeyPath $restartScriptPath "$GcpHost`:/tmp/publish-gcp-shared-mcp-restart.sh"
      $restartOutput = Invoke-Ssh 'bash /tmp/publish-gcp-shared-mcp-restart.sh; rm -f /tmp/publish-gcp-shared-mcp-restart.sh'
    }
    finally {
      if (Test-Path $restartScriptPath) {
        Remove-Item $restartScriptPath -Force
      }
    }

    if (($restartOutput | Out-String) -match 'RESTART_OK') {
      Write-Ok 'shared MCP service restart complete'
    }
    else {
      throw "Service restart did not complete cleanly: $restartOutput"
    }
  }

  Write-Step 5 'Checking canonical shared MCP health...'
  $publicHealthRaw = & curl.exe --silent --show-error --fail --retry 30 --retry-all-errors --retry-delay 1 "https://$PublicHost/mcp/health"
  $health = (($publicHealthRaw | Out-String).Trim() | ConvertFrom-Json)
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