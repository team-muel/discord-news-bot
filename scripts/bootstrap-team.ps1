<#
.SYNOPSIS
  One-click team onboarding for Muel Discord News Bot MCP environment.
.DESCRIPTION
  Installs npm dependencies, creates .env from template, generates SSH key
  for GCP access, and validates the setup. Team members run this once after
  cloning the repo.
.EXAMPLE
  .\scripts\bootstrap-team.ps1
#>
param(
  [switch]$SkipNpm,
  [switch]$SkipSsh,
  [switch]$Force
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
if (-not (Test-Path (Join-Path $repoRoot 'package.json'))) {
  $repoRoot = Split-Path -Parent $PSScriptRoot
}
Push-Location $repoRoot

function Write-Step($n, $msg) { Write-Host "`n[$n] $msg" -ForegroundColor Cyan }
function Write-Ok($msg)       { Write-Host "  OK  $msg" -ForegroundColor Green }
function Write-Skip($msg)     { Write-Host "  SKIP  $msg" -ForegroundColor Yellow }
function Write-Warn($msg)     { Write-Host "  WARN  $msg" -ForegroundColor Yellow }

try {
  Write-Host "`n=== Muel MCP Team Bootstrap ===" -ForegroundColor Magenta
  Write-Host "This script sets up your local environment for MCP tools.`n"

  # ── Step 1: Node.js / npm ──
  Write-Step 1 "Checking Node.js..."
  $nodeVer = & node --version 2>$null
  if (-not $nodeVer) {
    Write-Host "  Node.js not found. Install from https://nodejs.org" -ForegroundColor Red
    exit 1
  }
  Write-Ok "Node.js $nodeVer"

  # ── Step 2: npm install ──
  Write-Step 2 "Installing npm dependencies..."
  if ($SkipNpm) {
    Write-Skip "Skipped (-SkipNpm)"
  } elseif ((Test-Path 'node_modules') -and -not $Force) {
    Write-Skip "node_modules exists (use -Force to reinstall)"
  } else {
    & npm install --ignore-scripts 2>&1 | Out-Null
    Write-Ok "npm install complete"
  }

  # ── Step 3: .env file ──
  Write-Step 3 "Setting up .env file..."
  $envFile = Join-Path $repoRoot '.env'
  $envExample = Join-Path $repoRoot '.env.example'

  if ((Test-Path $envFile) -and -not $Force) {
    Write-Skip ".env already exists (use -Force to overwrite)"
  } else {
    Copy-Item $envExample $envFile -Force
    Write-Ok "Created .env from .env.example"

    Write-Host ""
    Write-Host "  Minimum keys to fill in .env:" -ForegroundColor White
    Write-Host "    SUPABASE_URL         = (ask team lead)" -ForegroundColor Gray
    Write-Host "    SUPABASE_KEY         = (ask team lead)" -ForegroundColor Gray
    Write-Host "    OPENAI_API_KEY       = (your own or shared)" -ForegroundColor Gray
    Write-Host ""
    Write-Host "  Optional (for Discord bot):" -ForegroundColor White
    Write-Host "    DISCORD_TOKEN        = (ask team lead)" -ForegroundColor Gray
    Write-Host ""
  }

  # ── Step 4: SSH key for GCP ──
  Write-Step 4 "Setting up SSH key for GCP MCP server..."
  $sshDir = Join-Path $env:USERPROFILE '.ssh'
  $keyPath = Join-Path $sshDir 'google_compute_engine'
  $pubPath = "$keyPath.pub"

  if ($SkipSsh) {
    Write-Skip "Skipped (-SkipSsh)"
  } elseif ((Test-Path $keyPath) -and -not $Force) {
    Write-Skip "SSH key already exists at $keyPath"
    $pubKey = Get-Content $pubPath -Raw
  } else {
    if (-not (Test-Path $sshDir)) { New-Item -ItemType Directory -Path $sshDir | Out-Null }

    $comment = "$env:USERNAME@$env:COMPUTERNAME"
    & ssh-keygen -t ed25519 -f $keyPath -N '""' -C $comment 2>&1 | Out-Null
    if (-not (Test-Path $pubPath)) {
      Write-Host "  SSH key generation failed" -ForegroundColor Red
      exit 1
    }
    Write-Ok "SSH key generated at $keyPath"
    $pubKey = Get-Content $pubPath -Raw
  }

  if (-not $SkipSsh) {
    Write-Host ""
    Write-Host "  Your public key (send this to team lead):" -ForegroundColor White
    Write-Host "  ────────────────────────────────────────────" -ForegroundColor DarkGray
    Write-Host "  $($pubKey.Trim())" -ForegroundColor Yellow
    Write-Host "  ────────────────────────────────────────────" -ForegroundColor DarkGray
    Write-Host ""

    # Copy to clipboard if available
    try {
      $pubKey.Trim() | Set-Clipboard
      Write-Ok "Public key copied to clipboard"
    } catch {
      Write-Warn "Could not copy to clipboard — copy manually from above"
    }
  }

  # ── Step 5: Verify mcp.json ──
  Write-Step 5 "Checking MCP configuration..."
  $mcpJson = Join-Path $repoRoot '.vscode' 'mcp.json'
  if (Test-Path $mcpJson) {
    Write-Ok ".vscode/mcp.json found"
  } else {
    Write-Warn ".vscode/mcp.json not found — run 'git checkout .vscode/mcp.json'"
  }

  # ── Step 6: Quick validation ──
  Write-Step 6 "Validating setup..."
  $checks = @()

  # Check npm scripts exist
  $pkg = Get-Content (Join-Path $repoRoot 'package.json') -Raw | ConvertFrom-Json
  if ($pkg.scripts.'mcp:dev') { $checks += @{name='mcp:dev script'; ok=$true} }
  else { $checks += @{name='mcp:dev script'; ok=$false} }

  if ($pkg.scripts.'mcp:indexing:dev') { $checks += @{name='mcp:indexing:dev script'; ok=$true} }
  else { $checks += @{name='mcp:indexing:dev script'; ok=$false} }

  # Check SSH connectivity (non-blocking)
  if (-not $SkipSsh) {
    $sshTest = & ssh -o ConnectTimeout=5 -o StrictHostKeyChecking=accept-new -o BatchMode=yes -i $keyPath fancy@34.56.232.61 "echo ok" 2>&1
    if ($sshTest -match 'ok') {
      $checks += @{name='GCP SSH access'; ok=$true}
    } else {
      $checks += @{name='GCP SSH access'; ok=$false}
    }
  }

  foreach ($c in $checks) {
    if ($c.ok) { Write-Ok $c.name }
    else { Write-Warn "$($c.name) — not ready yet" }
  }

  # ── Summary ──
  Write-Host "`n=== Setup Complete ===" -ForegroundColor Magenta
  Write-Host ""
  Write-Host "Next steps:" -ForegroundColor White
  Write-Host "  1. Fill in minimum keys in .env (SUPABASE_URL, SUPABASE_KEY)" -ForegroundColor Gray
  Write-Host "  2. Send your SSH public key to team lead (already in clipboard)" -ForegroundColor Gray
  Write-Host "  3. After team lead confirms key registration, restart VS Code" -ForegroundColor Gray
  Write-Host "  4. Open Copilot Chat — MCP tools are auto-configured" -ForegroundColor Gray
  Write-Host ""
  Write-Host "Available MCP servers after setup:" -ForegroundColor White
  Write-Host "  deepwiki      — works immediately (no setup needed)" -ForegroundColor Green
  Write-Host "  supabase      — works immediately (OAuth in browser)" -ForegroundColor Green
  Write-Host "  muelCore      — needs .env (SUPABASE_URL, SUPABASE_KEY)" -ForegroundColor Yellow
  Write-Host "  muelIndexing  — needs .env (same as muelCore)" -ForegroundColor Yellow
  Write-Host "  gcpCompute    — needs SSH key registered by team lead" -ForegroundColor Yellow
  Write-Host ""

} finally {
  Pop-Location
}
