<#
.SYNOPSIS
  Register a team member's SSH public key on the GCP MCP server.
  Run by the team lead after receiving the public key from bootstrap-team.ps1.
.EXAMPLE
  .\scripts\register-team-ssh.ps1 -PubKey "ssh-ed25519 AAAA... user@PC"
  .\scripts\register-team-ssh.ps1 -PubKeyFile C:\keys\teammate.pub
#>
param(
  [string]$PubKey,
  [string]$PubKeyFile,
  [string]$GcpHost = 'fancy@34.56.232.61',
  [string]$AdminKeyPath = (Join-Path $env:USERPROFILE '.ssh\google_compute_engine')
)

$ErrorActionPreference = 'Stop'

if (-not $PubKey -and $PubKeyFile) {
  $PubKey = (Get-Content $PubKeyFile -Raw).Trim()
}
if (-not $PubKey) {
  # Try clipboard
  $PubKey = (Get-Clipboard | Out-String).Trim()
  if ($PubKey -notmatch '^ssh-') {
    Write-Host "Usage: .\register-team-ssh.ps1 -PubKey 'ssh-ed25519 AAAA... user@PC'" -ForegroundColor Red
    Write-Host "  or paste the key and run again (reads from clipboard)" -ForegroundColor Gray
    exit 1
  }
  Write-Host "Using public key from clipboard." -ForegroundColor Cyan
}

# Validate key format
if ($PubKey -notmatch '^ssh-(ed25519|rsa|ecdsa)') {
  Write-Host "Invalid SSH public key format: $($PubKey.Substring(0, [Math]::Min(40, $PubKey.Length)))..." -ForegroundColor Red
  exit 1
}

# Extract comment for display
$parts = $PubKey -split '\s+'
$comment = if ($parts.Count -ge 3) { $parts[2] } else { 'unknown' }

Write-Host "`nRegistering SSH key for: $comment" -ForegroundColor Cyan
Write-Host "Target: $GcpHost" -ForegroundColor Gray

# Escape for shell
$escapedKey = $PubKey.Replace("'", "'\\''")

$cmd = "mkdir -p ~/.ssh && chmod 700 ~/.ssh && grep -qF '$escapedKey' ~/.ssh/authorized_keys 2>/dev/null || echo '$escapedKey' >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys && echo 'KEY_REGISTERED'"

$result = & ssh -o ConnectTimeout=10 -o StrictHostKeyChecking=accept-new -i $AdminKeyPath $GcpHost $cmd 2>&1

if ($result -match 'KEY_REGISTERED') {
  Write-Host "`n  OK  Key registered for $comment" -ForegroundColor Green
  Write-Host "  Team member can now use gcpCompute MCP server." -ForegroundColor Gray
  Write-Host "  Tell them to restart VS Code to activate the connection.`n" -ForegroundColor Gray
} else {
  Write-Host "`n  FAIL  Could not register key" -ForegroundColor Red
  Write-Host "  Output: $result" -ForegroundColor Gray
  exit 1
}
