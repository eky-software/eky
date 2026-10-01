param(
  [Parameter(Mandatory)][string]$ArchivePath,
  [Parameter(Mandatory)][string]$OutputPath,
  [Parameter(Mandatory)][string]$PublicKeyPath,
  [Parameter(Mandatory)][string]$ExpectedFingerprint,
  [Parameter(Mandatory)][string]$WorkRoot
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
try {
  . (Join-Path $PSScriptRoot 'encryptedEvidenceOpenPgp.ps1')
  $null = Invoke-EvidenceEncryption -ArchivePath $ArchivePath -OutputPath $OutputPath `
    -PublicKeyPath $PublicKeyPath -ExpectedFingerprint $ExpectedFingerprint -WorkRoot $WorkRoot
  exit 0
} catch {
  [Console]::Error.WriteLine('WORKSPACE_ENCRYPTED_EVIDENCE_UNVERIFIED')
  exit 1
}
