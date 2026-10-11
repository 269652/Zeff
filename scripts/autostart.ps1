<#
  Install / remove Zeff autostart on Windows (no admin required).

  Registers a per-user Scheduled Task "Zeff Server" that launches
  scripts\zeff-serve.ps1 hidden (the watchdog that runs the production server on
  http://127.0.0.1:9333 and keeps it alive). The task fires on log on AND on
  session unlock / console connect, so it also starts after a Windows "Fast
  Startup" resume - where a plain Startup-folder shortcut does NOT re-run. The
  task launches the watchdog detached from any terminal, so it survives your shell.

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
$psExe = (Get-Command powershell).Source
$port = 9333
$taskName = "Zeff Server"
$oldLnk = Join-Path ([Environment]::GetFolderPath("Startup")) "Zeff Server.lnk"
$me = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name

function Get-ZeffProcesses {
  Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -and $_.CommandLine -match 'next(\\|/)dist.*start' -and $_.CommandLine -match "$port" }
}

function Get-ZeffTask { Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue }

function Install-ZeffTask {
  $action = New-ScheduledTaskAction -Execute $psExe `
    -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$serve`"" -WorkingDirectory $root

  $triggers = @(New-ScheduledTaskTrigger -AtLogOn -User $me)
  # Session-state triggers cover a Fast-Startup resume (no fresh logon fires):
  # 8 = SessionUnlock, 1 = ConsoleConnect.
  $cls = Get-CimClass -Namespace Root/Microsoft/Windows/TaskScheduler -ClassName MSFT_TaskSessionStateChangeTrigger
  foreach ($sc in 8, 1) {
    $t = New-CimInstance -CimClass $cls -ClientOnly
    $t.StateChange = [uint32]$sc
    $t.UserId = $me
    $t.Enabled = $true
    $triggers += $t
  }

  $principal = New-ScheduledTaskPrincipal -UserId $me -LogonType Interactive -RunLevel Limited
  $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero) -Hidden

  Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $triggers `
    -Principal $principal -Settings $settings -Description "Keep the Zeff time-tracking server running (logon + unlock)." -Force | Out-Null

  if (Test-Path $oldLnk) { Remove-Item $oldLnk -Force; Write-Host "Removed the old Startup-folder shortcut." }
}

function Start-Zeff {
  if (Get-ZeffTask) {
    Start-ScheduledTask -TaskName $taskName
    Write-Host "Started Zeff via the scheduled task (http://127.0.0.1:$port). Give it a few seconds."
  } else {
    Start-Process -FilePath $psExe -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-File", "`"$serve`"") -WindowStyle Hidden | Out-Null
    Write-Host "Task not installed - ran the watchdog directly (run -Install for reliable autostart)."
  }
}

function Stop-Zeff {
  if (Get-ZeffTask) { Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue | Out-Null }
  Get-CimInstance Win32_Process -Filter "Name = 'powershell.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -match 'zeff-serve\.ps1' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  $procs = Get-ZeffProcesses
  if ($procs) { $procs | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }; Write-Host "Stopped the Zeff server." }
  else { Write-Host "No running Zeff server found." }
}

if ($Install) {
  Install-ZeffTask
  Write-Host "Installed autostart task '$taskName' (fires on log on, unlock and console connect)."
  Write-Host "Zeff will start automatically. Use -Start to launch it now."
}
elseif ($Uninstall) {
  if (Get-ZeffTask) { Unregister-ScheduledTask -TaskName $taskName -Confirm:$false; Write-Host "Removed the autostart task." }
  else { Write-Host "No autostart task was installed." }
  if (Test-Path $oldLnk) { Remove-Item $oldLnk -Force; Write-Host "Removed the old Startup-folder shortcut." }
}
elseif ($Start) { Start-Zeff }
elseif ($Stop) { Stop-Zeff }
else {
  # Status (default)
  if (Get-ZeffTask) { Write-Host "Autostart: INSTALLED (scheduled task '$taskName' - logon + unlock + console connect)" }
  elseif (Test-Path $oldLnk) { Write-Host "Autostart: OLD Startup shortcut only (run -Install to switch to the scheduled task)" }
  else { Write-Host "Autostart: not installed (run -Install)" }
  $procs = Get-ZeffProcesses
  if ($procs) { Write-Host "Server process: running (PID $($procs.ProcessId -join ', '))" } else { Write-Host "Server process: not running" }
  try {
    $r = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$port/api/calendar/ingest" -TimeoutSec 3
    Write-Host "HTTP check: responding on :$port (status $($r.StatusCode))"
  } catch {
    Write-Host "HTTP check: not responding on :$port"
  }
}
