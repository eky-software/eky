param(
  [Parameter(Mandatory = $true)][string]$ProductCode,
  [Parameter(Mandatory = $true)][string]$ResultPath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$installer = $null
$temporaryPath = $null

try {
  if (
    $ProductCode -cnotmatch '^\{[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}\}$' -or
    ![IO.Path]::IsPathRooted($ResultPath) -or
    [IO.Path]::GetFullPath($ResultPath) -cne $ResultPath -or
    (Test-Path -LiteralPath $ResultPath)
  ) {
    exit 64
  }

  $resultDirectory = [IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($ResultPath))
  if (!(Test-Path -LiteralPath $resultDirectory -PathType Container)) {
    exit 64
  }

  $installer = New-Object -ComObject WindowsInstaller.Installer
  try {
    $productState = [int]$installer.ProductState($ProductCode)
  }
  catch {
    $productState = -1
  }

  $productName = $null
  $productVersion = $null
  $localPackagePresent = $false
  if ($productState -ge 1) {
    $productName = [string]$installer.ProductInfo($ProductCode, 'ProductName')
    $productVersion = [string]$installer.ProductInfo($ProductCode, 'VersionString')
    $localPackage = [string]$installer.ProductInfo($ProductCode, 'LocalPackage')
    $localPackagePresent = Test-Path -LiteralPath $localPackage -PathType Leaf
  }

  $result = [ordered]@{
    schemaVersion = 1
    productState = $productState
    productName = $productName
    productVersion = $productVersion
    localPackagePresent = [bool]$localPackagePresent
    ownedRegistryExists = Test-Path -LiteralPath 'HKCU:\Software\Eky\Installer' -PathType Container
    ekyProcessCount = @(
      Get-Process -Name 'Eky' -ErrorAction SilentlyContinue
    ).Count
  }
  $serialized = $result | ConvertTo-Json -Compress
  $temporaryPath = "$ResultPath.$([guid]::NewGuid().ToString('N')).tmp"
  [IO.File]::WriteAllText(
    $temporaryPath,
    "$serialized`n",
    [Text.UTF8Encoding]::new($false)
  )
  [IO.File]::Move($temporaryPath, $ResultPath)
  $temporaryPath = $null
  exit 0
}
catch {
  exit 1
}
finally {
  if ($null -ne $installer) {
    [void][Runtime.InteropServices.Marshal]::ReleaseComObject($installer)
  }
  if ($null -ne $temporaryPath -and (Test-Path -LiteralPath $temporaryPath)) {
    Remove-Item -LiteralPath $temporaryPath -Force -ErrorAction SilentlyContinue
  }
}
