param(
  [Parameter(Mandatory = $true)]
  [string]$MsiPath,

  [Parameter(Mandatory = $true)]
  [string]$ExpectedProductVersion,

  [Parameter(Mandatory = $true)]
  [string]$ExpectedProductCode,

  [Parameter(Mandatory = $true)]
  [string]$ExpectedUpgradeCode,

  [Parameter(Mandatory = $true)]
  [int]$ExpectedPayloadFileCount
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Assert-Equal {
  param(
    [Parameter(Mandatory = $true)]$Actual,
    [Parameter(Mandatory = $true)]$Expected,
    [Parameter(Mandatory = $true)][string]$Code
  )

  if ($Actual -ne $Expected) {
    throw "$Code`: expected '$Expected', received '$Actual'"
  }
}

function Get-TableCount {
  param(
    [Parameter(Mandatory = $true)]$Database,
    [Parameter(Mandatory = $true)][string]$TableName
  )

  $view = $null
  $record = $null
  try {
    $view = $Database.OpenView("SELECT * FROM ``$TableName``")
    [void]$view.Execute()
    $count = 0
    while ($null -ne ($record = $view.Fetch())) {
      $count += 1
      [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($record)
      $record = $null
    }
    return $count
  }
  catch [System.Runtime.InteropServices.COMException] {
    return 0
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
}

function Get-Properties {
  param([Parameter(Mandatory = $true)]$Database)

  $properties = @{}
  $view = $Database.OpenView('SELECT `Property`, `Value` FROM `Property`')
  $record = $null
  try {
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
    [void]$view.Close()
    [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($view)
  }
  return ,$properties
}

function Get-Directories {
  param([Parameter(Mandatory = $true)]$Database)

  $directories = @{}
  $view = $Database.OpenView(
    'SELECT `Directory`, `Directory_Parent`, `DefaultDir` FROM `Directory`'
  )
  $record = $null
  try {
    [void]$view.Execute()
    while ($null -ne ($record = $view.Fetch())) {
      $directories[$record.StringData(1)] = @{
        Parent = $record.StringData(2)
        Name = $record.StringData(3)
      }
      [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($record)
      $record = $null
    }
  }
  finally {
    if ($null -ne $record) {
      [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($record)
    }
    [void]$view.Close()
    [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($view)
  }
  return ,$directories
}

function Get-ActionSequence {
  param(
    [Parameter(Mandatory = $true)]$Database,
    [Parameter(Mandatory = $true)][string]$Action
  )

  $view = $Database.OpenView(
    "SELECT ``Sequence`` FROM ``InstallExecuteSequence`` WHERE ``Action`` = '$Action'"
  )
  $record = $null
  try {
    [void]$view.Execute()
    $record = $view.Fetch()
    if ($null -eq $record) {
      throw "INSTALLER_SEQUENCE_ACTION_MISSING:$Action"
    }
    return $record.IntegerData(1)
  }
  finally {
    if ($null -ne $record) {
      [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($record)
    }
    [void]$view.Close()
    [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($view)
  }
}

$resolvedMsiPath = (Resolve-Path -LiteralPath $MsiPath).Path
if ([System.IO.Path]::GetExtension($resolvedMsiPath) -ne '.msi') {
  throw 'INSTALLER_INSPECTION_MSI_REQUIRED'
}

$installer = $null
$database = $null
try {
  $installer = New-Object -ComObject WindowsInstaller.Installer
  $database = $installer.OpenDatabase($resolvedMsiPath, 0)
  $properties = Get-Properties -Database $database
  $directories = Get-Directories -Database $database
  $installExecuteSequence = Get-ActionSequence -Database $database `
    -Action 'InstallExecute'
  $installFinalizeSequence = Get-ActionSequence -Database $database `
    -Action 'InstallFinalize'
  $removeExistingProductsSequence = Get-ActionSequence -Database $database `
    -Action 'RemoveExistingProducts'

  Assert-Equal $properties['ProductName'] 'Eky' 'INSTALLER_PRODUCT_NAME_INVALID'
  Assert-Equal $properties['Manufacturer'] 'Eky' 'INSTALLER_MANUFACTURER_INVALID'
  Assert-Equal $properties['ProductVersion'] $ExpectedProductVersion 'INSTALLER_VERSION_INVALID'
  Assert-Equal $properties['ProductCode'] "{$($ExpectedProductCode.ToUpperInvariant())}" 'INSTALLER_PRODUCT_CODE_INVALID'
  Assert-Equal $properties['UpgradeCode'] "{$($ExpectedUpgradeCode.ToUpperInvariant())}" 'INSTALLER_UPGRADE_CODE_INVALID'

  if ($properties.ContainsKey('ALLUSERS') -and $properties['ALLUSERS'] -ne '') {
    throw 'INSTALLER_SCOPE_NOT_PER_USER'
  }
  if ($properties.ContainsKey('MSIINSTALLPERUSER')) {
    throw 'INSTALLER_SCOPE_DUAL_PURPOSE_FORBIDDEN'
  }

  Assert-Equal $directories['EkyInstallFolder'].Parent 'EkyProgramsDirectory' 'INSTALLER_ROOT_PARENT_INVALID'
  Assert-Equal $directories['EkyInstallFolder'].Name 'Eky' 'INSTALLER_ROOT_NAME_INVALID'
  Assert-Equal $directories['EkyProgramsDirectory'].Parent 'LocalAppDataFolder' 'INSTALLER_PROGRAMS_PARENT_INVALID'
  Assert-Equal $directories['EkyProgramsDirectory'].Name 'Programs' 'INSTALLER_PROGRAMS_NAME_INVALID'
  Assert-Equal $directories['ApplicationProgramsFolder'].Parent 'ProgramMenuFolder' 'INSTALLER_SHORTCUT_PARENT_INVALID'
  Assert-Equal $directories['ApplicationProgramsFolder'].Name 'Eky' 'INSTALLER_SHORTCUT_FOLDER_INVALID'

  foreach ($forbiddenDirectory in @('AppDataFolder', 'CommonAppDataFolder', 'PersonalFolder')) {
    if ($directories.ContainsKey($forbiddenDirectory)) {
      throw "INSTALLER_USER_DATA_DIRECTORY_FORBIDDEN:$forbiddenDirectory"
    }
  }

  $fileCount = Get-TableCount -Database $database -TableName 'File'
  $componentCount = Get-TableCount -Database $database -TableName 'Component'
  $registryCount = Get-TableCount -Database $database -TableName 'Registry'
  $removeFileCount = Get-TableCount -Database $database -TableName 'RemoveFile'
  $shortcutCount = Get-TableCount -Database $database -TableName 'Shortcut'
  $customActionCount = Get-TableCount -Database $database -TableName 'CustomAction'

  Assert-Equal $fileCount $ExpectedPayloadFileCount 'INSTALLER_PAYLOAD_FILE_COUNT_INVALID'
  Assert-Equal $componentCount ($fileCount + $removeFileCount) 'INSTALLER_COMPONENT_OWNERSHIP_INVALID'
  Assert-Equal $registryCount $componentCount 'INSTALLER_REGISTRY_KEYPATH_COUNT_INVALID'
  Assert-Equal $shortcutCount 1 'INSTALLER_SHORTCUT_COUNT_INVALID'
  Assert-Equal $customActionCount 0 'INSTALLER_CUSTOM_ACTION_FORBIDDEN'
  if ($removeFileCount -lt 3) {
    throw 'INSTALLER_DIRECTORY_CLEANUP_INCOMPLETE'
  }
  if (
    $removeExistingProductsSequence -le $installExecuteSequence -or
    $removeExistingProductsSequence -ge $installFinalizeSequence
  ) {
    throw 'INSTALLER_MAJOR_UPGRADE_SEQUENCE_INVALID'
  }

  [ordered]@{
    componentCount = $componentCount
    customActionCount = $customActionCount
    fileCount = $fileCount
    installRoot = '%LOCALAPPDATA%\Programs\Eky'
    msiPath = $resolvedMsiPath
    productCode = $properties['ProductCode']
    productVersion = $properties['ProductVersion']
    removeFileCount = $removeFileCount
    removeExistingProductsSequence = $removeExistingProductsSequence
    scope = 'perUser'
    shortcutCount = $shortcutCount
    upgradeCode = $properties['UpgradeCode']
  } | ConvertTo-Json -Compress
}
finally {
  if ($null -ne $database) {
    [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($database)
  }
  if ($null -ne $installer) {
    [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($installer)
  }
}
