# The admin part of the https://zeff setup, run elevated by the launcher (ASCII only).
#  - hosts: "127.0.0.1 <names>", tagged "# zeff-launcher" (replaces an earlier one)
#  - trusts -Cer (the Zeff Local CA) for the whole computer
# Logs to -Log. Exit code 0 = everything done.
param([string]$Cer, [string]$Names, [string]$Log)
$ErrorActionPreference = 'Stop'
$ok = $true
function Note($m) { Add-Content -Path $Log -Value ("{0} [setup] {1}" -f (Get-Date -Format s), $m) }

$hosts = Join-Path $env:SystemRoot 'System32\drivers\etc\hosts'
try {
  $enc = [System.Text.Encoding]::Default
  $lines = @()
  if (Test-Path $hosts) { $lines = [System.IO.File]::ReadAllLines($hosts, $enc) | Where-Object { $_ -notmatch '# zeff-launcher' } }
  $lines += "127.0.0.1`t$($Names -replace ',', ' ')`t# zeff-launcher"
  [System.IO.File]::WriteAllLines($hosts, [string[]]$lines, $enc)
  Note "hosts: 127.0.0.1 $Names"
  ipconfig /flushdns | Out-Null
} catch {
  Note "hosts: $($_.Exception.Message)"
  $ok = $false
}

try {
  $out = certutil.exe -addstore -f Root $Cer 2>&1
  if ($LASTEXITCODE -ne 0) { throw ($out -join ' ') }
  Note 'trusted the Zeff Local CA for this computer'
} catch {
  Note "certutil: $($_.Exception.Message)"
  $ok = $false
}

if ($ok) { exit 0 } else { exit 1 }
