param(
  [string]$GcloudPath = 'C:\Users\fancy\AppData\Local\Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd',
  [string]$OutputPath = '.\tmp\gcloud-auth-output.txt',
  [string]$CodePath = '.\tmp\gcloud-auth-code.txt',
  [string]$StatusPath = '.\tmp\gcloud-auth-status.txt'
)

$ErrorActionPreference = 'Stop'

$outputFile = [System.IO.Path]::GetFullPath($OutputPath)
$codeFile = [System.IO.Path]::GetFullPath($CodePath)
$statusFile = [System.IO.Path]::GetFullPath($StatusPath)

New-Item -ItemType Directory -Force -Path ([System.IO.Path]::GetDirectoryName($outputFile)) | Out-Null
New-Item -ItemType Directory -Force -Path ([System.IO.Path]::GetDirectoryName($codeFile)) | Out-Null
New-Item -ItemType Directory -Force -Path ([System.IO.Path]::GetDirectoryName($statusFile)) | Out-Null

Set-Content -Path $outputFile -Value ''
Set-Content -Path $statusFile -Value 'starting'
if (Test-Path $codeFile) {
  Remove-Item $codeFile -Force
}

$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = $GcloudPath
$psi.Arguments = 'auth login --no-launch-browser --brief'
$psi.UseShellExecute = $false
$psi.RedirectStandardInput = $true
$psi.RedirectStandardOutput = $true
$psi.RedirectStandardError = $true
$psi.CreateNoWindow = $true

$proc = New-Object System.Diagnostics.Process
$proc.StartInfo = $psi

$appendLine = {
  param([string]$line)
  if ($null -ne $line) {
    Add-Content -Path $outputFile -Value $line
  }
}

$outEvent = Register-ObjectEvent -InputObject $proc -EventName OutputDataReceived -Action {
  if ($EventArgs.Data -ne $null) {
    Add-Content -Path $using:outputFile -Value $EventArgs.Data
  }
}
$errEvent = Register-ObjectEvent -InputObject $proc -EventName ErrorDataReceived -Action {
  if ($EventArgs.Data -ne $null) {
    Add-Content -Path $using:outputFile -Value $EventArgs.Data
  }
}

$null = $proc.Start()
$proc.BeginOutputReadLine()
$proc.BeginErrorReadLine()
Set-Content -Path $statusFile -Value 'waiting_for_code'

while (-not (Test-Path $codeFile)) {
  if ($proc.HasExited) {
    break
  }
  Start-Sleep -Milliseconds 500
}

if ((Test-Path $codeFile) -and (-not $proc.HasExited)) {
  $code = (Get-Content -Path $codeFile -Raw).Trim()
  if ($code) {
    $proc.StandardInput.WriteLine($code)
    $proc.StandardInput.Flush()
    Set-Content -Path $statusFile -Value 'code_submitted'
  }
}

$proc.WaitForExit()
Set-Content -Path $statusFile -Value ("exited:{0}" -f $proc.ExitCode)

Unregister-Event -SourceIdentifier $outEvent.Name -ErrorAction SilentlyContinue
Unregister-Event -SourceIdentifier $errEvent.Name -ErrorAction SilentlyContinue
Remove-Job -Id $outEvent.Id -Force -ErrorAction SilentlyContinue
Remove-Job -Id $errEvent.Id -Force -ErrorAction SilentlyContinue

exit $proc.ExitCode