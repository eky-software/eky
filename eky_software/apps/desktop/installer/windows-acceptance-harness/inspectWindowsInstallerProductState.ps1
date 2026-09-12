param(
  [Parameter(Mandatory = $true)][string]$ProductCode,
  [Parameter(Mandatory = $true)][string]$ResultPath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$installer = $null
$resolvedResultPath = $null
$temporaryPath = $null
$inspectionEvents = $null

# Payload-free ETW observations use the platform's optional trace session.
# No console/file sink, delivery acknowledgement or success decision is added.
try {
  $inspectionEvents = [System.Diagnostics.Tracing.EventSource]::new('Eky-InstallerProductInspection-V1')
} catch { }
function Write-InspectionEvent([string]$Name) {
  try {
    if ($null -ne $inspectionEvents) { $inspectionEvents.Write($Name) }
  } catch { }
}
Write-InspectionEvent 'scriptStarted'

try {
  if (
    $ProductCode -cnotmatch '^\{[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}\}$' -or
    ![IO.Path]::IsPathRooted($ResultPath) -or
    $ResultPath.IndexOf([char]0) -ge 0 -or
    $ResultPath -match '(^|[\\/])(?:\.|\.\.)([\\/]|$)' -or
    $ResultPath -match '[\\/]$' -or
    (Test-Path -LiteralPath $ResultPath)
  ) {
    Write-InspectionEvent 'requestRejected'
    exit 64
  }

  $resolvedResultPath = [IO.Path]::GetFullPath($ResultPath)
  $resultDirectory = [IO.Path]::GetDirectoryName($resolvedResultPath)
  if (!(Test-Path -LiteralPath $resultDirectory -PathType Container)) {
    Write-InspectionEvent 'requestRejected'
    exit 64
  }
  $ResultPath = $resolvedResultPath
  Write-InspectionEvent 'requestValidated'

  Write-InspectionEvent 'comCreationStarted'
  $installer = New-Object -ComObject WindowsInstaller.Installer
  Write-InspectionEvent 'comCreationCompleted'
  Write-InspectionEvent 'productStateStarted'
  $productState = [int]$installer.ProductState($ProductCode)
  Write-InspectionEvent 'productStateCompleted'

  $productName = $null
  $productVersion = $null
  $localPackagePresent = $false
  if ($productState -ge 1) {
    Write-InspectionEvent 'productNameStarted'
    $productName = [string]$installer.ProductInfo($ProductCode, 'ProductName')
    Write-InspectionEvent 'productNameCompleted'
    Write-InspectionEvent 'productVersionStarted'
    $productVersion = [string]$installer.ProductInfo($ProductCode, 'VersionString')
    Write-InspectionEvent 'productVersionCompleted'
    Write-InspectionEvent 'localPackageQueryStarted'
    $localPackage = [string]$installer.ProductInfo($ProductCode, 'LocalPackage')
    Write-InspectionEvent 'localPackageQueryCompleted'
    Write-InspectionEvent 'localPackageCheckStarted'
    $localPackagePresent = Test-Path -LiteralPath $localPackage -PathType Leaf
    Write-InspectionEvent 'localPackageCheckCompleted'
  }

  Write-InspectionEvent 'registryInspectionStarted'
  $ownedRegistryExists = Test-Path -LiteralPath 'HKCU:\Software\Eky\Installer' -PathType Container
  Write-InspectionEvent 'registryInspectionCompleted'
  Write-InspectionEvent 'processInspectionStarted'
  $ekyProcessCount = @(Get-Process -Name 'Eky' -ErrorAction SilentlyContinue).Count
  Write-InspectionEvent 'processInspectionCompleted'
  $result = [ordered]@{
    schemaVersion = 1
    productState = $productState
    productName = $productName
    productVersion = $productVersion
    localPackagePresent = [bool]$localPackagePresent
    ownedRegistryExists = $ownedRegistryExists
    ekyProcessCount = $ekyProcessCount
  }
  Write-InspectionEvent 'resultSerializeStarted'
  $serialized = $result | ConvertTo-Json -Compress
  Write-InspectionEvent 'resultSerializeCompleted'
  $temporaryPath = "$ResultPath.$([guid]::NewGuid().ToString('N')).tmp"
  Write-InspectionEvent 'resultWriteStarted'
  [IO.File]::WriteAllText(
    $temporaryPath,
    "$serialized`n",
    [Text.UTF8Encoding]::new($false)
  )
  Write-InspectionEvent 'resultWriteCompleted'
  Write-InspectionEvent 'resultPublishStarted'
  [IO.File]::Move($temporaryPath, $ResultPath)
  $temporaryPath = $null
  Write-InspectionEvent 'resultPublishCompleted'
  exit 0
}
catch {
  Write-InspectionEvent 'inspectionFailed'
  exit 1
}
finally {
  try {
    if ($null -ne $installer) {
      Write-InspectionEvent 'comReleaseStarted'
      [void][Runtime.InteropServices.Marshal]::ReleaseComObject($installer)
      Write-InspectionEvent 'comReleaseCompleted'
    }
    if ($null -ne $temporaryPath -and (Test-Path -LiteralPath $temporaryPath)) {
      Remove-Item -LiteralPath $temporaryPath -Force -ErrorAction SilentlyContinue
    }
  } finally {
    Write-InspectionEvent 'scriptFinished'
    try {
      if ($null -ne $inspectionEvents) { $inspectionEvents.Dispose() }
    } catch { }
  }
}
