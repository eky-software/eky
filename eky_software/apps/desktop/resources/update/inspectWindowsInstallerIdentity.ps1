param(
  [Parameter(Mandatory = $true)]
  [string]$MsiPath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Get-Properties {
  param([Parameter(Mandatory = $true)]$Database)

  $properties = @{}
  $view = $null
  $record = $null
  try {
    $view = $Database.OpenView('SELECT `Property`, `Value` FROM `Property`')
    [void]$view.Execute()
    while ($null -ne ($record = $view.Fetch())) {
      $properties[$record.StringData(1)] = $record.StringData(2)
      [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($record)
      $record = $null
    }
  }
  finally {
    if ($null -ne $record) {
      [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($record)
    }
    if ($null -ne $view) {
      [void]$view.Close()
      [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($view)
    }
  }
  return ,$properties
}

$resolvedMsiPath = (Resolve-Path -LiteralPath $MsiPath).Path
if ([System.IO.Path]::GetExtension($resolvedMsiPath) -ne '.msi') {
  throw 'UPDATE_MSI_REQUIRED'
}

$installer = $null
$database = $null
$summary = $null
try {
  $installer = New-Object -ComObject WindowsInstaller.Installer
  $database = $installer.OpenDatabase($resolvedMsiPath, 0)
  $properties = Get-Properties -Database $database
  $summary = $database.SummaryInformation(0)
  $template = [string]$summary.Property(7)
  $templateArchitecture = ($template -split ';', 2)[0]

  $packageScope = 'perUser'
  if (
    ($properties.ContainsKey('ALLUSERS') -and $properties['ALLUSERS'] -ne '') -or
    $properties.ContainsKey('MSIINSTALLPERUSER')
  ) {
    $packageScope = 'unsupported'
  }

  [ordered]@{
    architecture = $templateArchitecture
    packageScope = $packageScope
    productCode = $properties['ProductCode']
    productVersion = $properties['ProductVersion']
    upgradeCode = $properties['UpgradeCode']
  } | ConvertTo-Json -Compress
}
finally {
  if ($null -ne $summary) {
    [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($summary)
  }
  if ($null -ne $database) {
    [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($database)
  }
  if ($null -ne $installer) {
    [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($installer)
  }
}
