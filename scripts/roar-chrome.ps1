<#
  Launch Chrome with the DevTools debug port so the Roar export (roar-mcp) can
  attach to it. Sign in to Roar ONCE in this window; the session is kept in a
  dedicated profile under %LOCALAPPDATA%\Zeff\roar-chrome-profile, separate from
  your normal Chrome, so there is no profile-lock conflict. It lives OUTSIDE the
  repo on purpose: a running Chrome exclusively locks files in its profile, and a
  locked file inside the project tree breaks 'next build' (Turbopack traces it).
  Re-run any time; it reuses the session.

  Usage: npm run roar:chrome   (or: powershell -ExecutionPolicy Bypass -File scripts\roar-chrome.ps1)
#>
$ErrorActionPreference = "Stop"
$profileDir = Join-Path $env:LOCALAPPDATA "Zeff\roar-chrome-profile"
New-Item -ItemType Directory -Force -Path $profileDir | Out-Null
$port = if ($env:ROAR_CDP_PORT) { $env:ROAR_CDP_PORT } else { 9222 }

$chrome = @(
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
  "$env:LocalAppData\Google\Chrome\Application\chrome.exe",
  # Edge (Chromium-based) is part of Windows 10/11: the fallback. CHROME_PATH names any other browser.
  "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
  "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe"
)
if ($env:CHROME_PATH) { $chrome = @($env:CHROME_PATH) + $chrome }
$chrome = $chrome | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $chrome) { throw "No Chrome or Edge found in the usual locations - install one, or set CHROME_PATH to the browser's exe." }

# Is the debug port already serving?
try {
  Invoke-WebRequest -UseBasicParsing "http://127.0.0.1:$port/json/version" -TimeoutSec 2 | Out-Null
  Write-Host "A debug Chrome is already running on port $port. Sign in to Roar there if needed."
  return
} catch { }

Start-Process -FilePath $chrome -ArgumentList @(
  "--remote-debugging-port=$port",
  "--user-data-dir=`"$profileDir`"",
  "--no-first-run",
  "--no-default-browser-check",
  "https://roar.marcel.ai/app/timesheet"
)
Write-Host "Launched Chrome with debug port $port."
Write-Host "Sign in to Roar in that window once (Microsoft SSO). Then use 'Export to Roar' in Zeff."
