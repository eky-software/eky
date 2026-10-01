param(
  [Parameter(Mandatory)][string]$ArchivePath,
  [Parameter(Mandatory)][string]$OutputPath,
  [Parameter(Mandatory)][string]$PublicKeyPath,
  [Parameter(Mandatory)][string]$ExpectedFingerprint,
  [Parameter(Mandatory)][string]$WorkRoot,
  [switch]$ReportFailureCode
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$codesLoaded = $false
try {
  . (Join-Path $PSScriptRoot 'encryptedEvidenceOpenPgp.ps1')
  $codesLoaded = $true
  $null = Invoke-EvidenceEncryption -ArchivePath $ArchivePath -OutputPath $OutputPath `
    -PublicKeyPath $PublicKeyPath -ExpectedFingerprint $ExpectedFingerprint -WorkRoot $WorkRoot
  exit 0
} catch {
  $code = 'WORKSPACE_ENCRYPTED_EVIDENCE_UNVERIFIED'
  if ($ReportFailureCode) {
    $code = 'EVIDENCE_ENCRYPTION_FAILED'
    if ($codesLoaded -and $_.Exception.Message -cin $script:EvidenceEncryptionFailureCodes) {
      $code = $_.Exception.Message
    }
  }
  [Console]::Error.WriteLine($code)
  exit 1
}
