<#
  Install / remove Zeff autostart on Windows login (no admin required).

  It drops a shortcut in your Startup folder that launches scripts\zeff-serve.ps1
  hidden, which runs the production server on http://127.0.0.1:9333 and keeps it
  alive. Uses the per-user Startup folder, so no elevation is needed.

  Usage:
    powershell -ExecutionPolicy Bypass -File scripts\autostart.ps1 -Install
    powershell -ExecutionPolicy Bypass -File scripts\autostart.ps1 -Uninstall
    powershell -ExecutionPolicy Bypass -File scripts\autostart.ps1 -Start
    powershell -ExecutionPolicy Bypass -File scripts\autostart.ps1 -Stop
    powershell -ExecutionPolicy Bypass -File scripts\autostart.ps1 -Status
#>
param(
  [switch]$Install,
  [switch]$Uninstall,
  [switch]$Start,
  [switch]$Stop,
  [switch]$Status
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$serve = Join-Path $root "scripts\zeff-serve.ps1"
$startup = [Environment]::GetFolderPath("Startup")
$lnk = Join-Path $startup "Zeff Server.lnk"
$psExe = (Get-Command powershell).Source
$port = 9333

function Get-ZeffProcesses {
  Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -and $_.CommandLine -match 'next(\\|/)dist.*start' -and $_.CommandLine -match "$port" }
}

function Start-Zeff {
  Start-Process -FilePath $psExe `
    -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-File", "`"$serve`"") `
    -WindowStyle Hidden | Out-Null
  Write-Host "Started the Zeff server (http://127.0.0.1:$port). Give it a few seconds."
}

function Stop-Zeff {
  # Stop the watchdog shells first, then the server processes.
  Get-CimInstance Win32_Process -Filter "Name = 'powershell.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -match 'zeff-serve\.ps1' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  $procs = Get-ZeffProcesses
  if ($procs) { $procs | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }; Write-Host "Stopped the Zeff server." }
  else { Write-Host "No running Zeff server found." }
}

if ($Install) {
  $ws = New-Object -ComObject WScript.Shell
  $s = $ws.CreateShortcut($lnk)
  $s.TargetPath = $psExe
  $s.Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$serve`""
  $s.WorkingDirectory = $root
  $s.WindowStyle = 7  # minimized (no visible window)
  $s.Description = "Start the Zeff time-tracking server on login"
  $s.Save()
  Write-Host "Installed autostart shortcut:`n  $lnk"
  Write-Host "Zeff will start on your next login. Use -Start to launch it now."
}
elseif ($Uninstall) {
  if (Test-Path $lnk) { Remove-Item $lnk -Force; Write-Host "Removed autostart shortcut." }
  else { Write-Host "No autostart shortcut was installed." }
}
elseif ($Start) { Start-Zeff }
elseif ($Stop) { Stop-Zeff }
else {
  # Status (default)
  if (Test-Path $lnk) { Write-Host "Autostart: INSTALLED ($lnk)" } else { Write-Host "Autostart: not installed (run -Install)" }
  $procs = Get-ZeffProcesses
  if ($procs) { Write-Host "Server process: running (PID $($procs.ProcessId -join ', '))" } else { Write-Host "Server process: not running" }
  try {
    $r = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$port/api/calendar/ingest" -TimeoutSec 3
    Write-Host "HTTP check: responding on :$port (status $($r.StatusCode))"
  } catch {
    Write-Host "HTTP check: not responding on :$port"
  }
}
