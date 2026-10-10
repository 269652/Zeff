# Makes Zeff's certificate with Windows' own crypto (ASCII only: PowerShell 5.1 reads ANSI).
# A "Zeff Local CA" signs a server certificate for -Names (+ 127.0.0.1, ::1); both are exported
# to -Dir and then removed from the store WITH their keys, so the CA can never sign again.
# Prints the CA's thumbprint.
param([string]$Dir, [string]$Password, [string]$Names)
$ErrorActionPreference = 'Stop'

$san = (($Names -split ',') | ForEach-Object { "DNS=$_" }) -join '&'
$san = "$san&IPAddress=127.0.0.1&IPAddress=::1"

$ca = New-SelfSignedCertificate -Subject 'CN=Zeff Local CA, O=Zeff (this computer only)' -FriendlyName 'Zeff Local CA' `
  -KeyAlgorithm RSA -KeyLength 2048 -HashAlgorithm SHA256 -KeyUsage CertSign, CRLSign, DigitalSignature `
  -TextExtension @('2.5.29.19={critical}{text}ca=1&pathlength=0') -NotAfter (Get-Date).AddYears(20) `
  -CertStoreLocation 'Cert:\CurrentUser\My'
try {
  $leaf = New-SelfSignedCertificate -Subject 'CN=zeff' -FriendlyName 'Zeff (https://zeff)' -Signer $ca `
    -KeyAlgorithm RSA -KeyLength 2048 -HashAlgorithm SHA256 -KeyExportPolicy Exportable `
    -KeyUsage DigitalSignature, KeyEncipherment `
    -TextExtension @("2.5.29.17={text}$san", '2.5.29.37={text}1.3.6.1.5.5.7.3.1') `
    -NotAfter (Get-Date).AddYears(10) -CertStoreLocation 'Cert:\CurrentUser\My'
  try {
    Export-Certificate -Cert $ca -FilePath (Join-Path $Dir 'zeff-ca.cer') | Out-Null
    $pw = ConvertTo-SecureString $Password -AsPlainText -Force
    Export-PfxCertificate -Cert $leaf -FilePath (Join-Path $Dir 'zeff.pfx') -Password $pw -CryptoAlgorithmOption AES256_SHA256 | Out-Null
  } finally {
    Remove-Item ('Cert:\CurrentUser\My\' + $leaf.Thumbprint) -DeleteKey
  }
} finally {
  Remove-Item ('Cert:\CurrentUser\My\' + $ca.Thumbprint) -DeleteKey
}
Write-Output $ca.Thumbprint
