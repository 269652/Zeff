# Zeff production server launcher, run at login by the autostart shortcut.
# Runs `next start` on 127.0.0.1:9333, hidden, and restarts it if it exits.
# Logs to data\autostart.log. Stop it with: npm run autostart:uninstall (removes
# boot entry) and scripts\autostart.ps1 -Stop (kills the running server).

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$log = Join-Path $root "data\autostart.log"
New-Item -ItemType Directory -Force -Path (Split-Path $log) | Out-Null

$next = Join-Path $root "node_modules\next\dist\bin\next"
$port = "9333"

if (-not (Test-Path (Join-Path $root ".next"))) {
  "$(Get-Date -Format o) WARNING: no production build (.next) found. Run 'npm run build' first." | Add-Content $log
}

while ($true) {
  "$(Get-Date -Format o) starting Zeff on http://127.0.0.1:$port" | Add-Content $log
  try {
    $p = Start-Process -FilePath "node" `
      -ArgumentList @("`"$next`"", "start", "-H", "127.0.0.1", "-p", $port) `
      -WorkingDirectory $root -WindowStyle Hidden -PassThru
    $p.WaitForExit()
    "$(Get-Date -Format o) Zeff exited (code $($p.ExitCode)); restarting in 5s" | Add-Content $log
  } catch {
    "$(Get-Date -Format o) launcher error: $($_.Exception.Message)" | Add-Content $log
  }
  Start-Sleep -Seconds 5
}
