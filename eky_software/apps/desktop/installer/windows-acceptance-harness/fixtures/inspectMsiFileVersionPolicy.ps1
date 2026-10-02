param(
  [Parameter(Mandatory = $true)][ValidateSet('Metadata', 'Installed')][string]$Mode,
  [Parameter(Mandatory = $true)][string]$DescriptorPath,
  [Parameter(Mandatory = $true)][string]$OutputPath
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Write-Result {
  param($Value)
  $bytes = [Text.UTF8Encoding]::new($false).GetBytes(($Value | ConvertTo-Json -Depth 6 -Compress))
  $stream = [IO.File]::Open($OutputPath, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
  try { $stream.Write($bytes, 0, $bytes.Length) } finally { $stream.Dispose() }
}

function Read-Rows {
  param($Database, [string]$Query, [string[]]$Columns)
  $view = $null
  $record = $null
  try {
    $view = $Database.OpenView($Query)
    [void]$view.Execute()
    while ($null -ne ($record = $view.Fetch())) {
      $row = [ordered]@{}
      for ($i = 0; $i -lt $Columns.Count; $i++) { $row[$Columns[$i]] = $record.StringData($i + 1) }
      [pscustomobject]$row
      [void][Runtime.InteropServices.Marshal]::ReleaseComObject($record)
      $record = $null
    }
  } finally {
    if ($null -ne $record) { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($record) }
    if ($null -ne $view) {
      [void]$view.Close()
      [void][Runtime.InteropServices.Marshal]::ReleaseComObject($view)
    }
  }
}

function Read-FileVersion {
  param([string]$Path)
  $info = [Diagnostics.FileVersionInfo]::GetVersionInfo($Path)
  if (-not $info.FileVersion) { throw 'msiPolicyVersionMissing' }
  return '{0}.{1}.{2}.{3}' -f $info.FileMajorPart, $info.FileMinorPart, $info.FileBuildPart, $info.FilePrivatePart
}

function Read-Metadata {
  param($Descriptor, [string]$Role)
  $installer = $null
  $database = $null
  try {
    $installer = New-Object -ComObject WindowsInstaller.Installer
    $database = $installer.OpenDatabase($Descriptor.$Role.installerPath, 0)
    $properties = Get-Properties $database
    if ($properties['ProductName'] -cne $Descriptor.productName -or
        $properties['ProductCode'] -cne $Descriptor.$Role.productCode -or
        $properties['ProductVersion'] -cne $Descriptor.$Role.version -or
        $properties['UpgradeCode'] -cne $Descriptor.upgradeCode -or
        $properties.ContainsKey('ALLUSERS')) { throw 'msiPolicyIdentityInvalid' }
    $sequences = @{}
    foreach ($table in @('InstallUISequence', 'InstallExecuteSequence', 'AdminUISequence', 'AdminExecuteSequence', 'AdvtExecuteSequence')) {
      $sequences[$table] = @(Get-InstallerPolicyRows $database $table)
    }
    Assert-ReinstallModePolicy -Properties $properties -CustomActions @(Get-InstallerPolicyRows $database 'CustomAction') -Sequences $sequences
    $execute = Get-ActionSequence $database 'InstallExecute'
    $remove = Get-ActionSequence $database 'RemoveExistingProducts'
    $finalize = Get-ActionSequence $database 'InstallFinalize'
    if (-not ($execute -lt $remove -and $remove -lt $finalize)) { throw 'msiPolicyUpgradeSequenceInvalid' }
    $files = @(Read-Rows $database 'SELECT `File`, `FileName`, `Version`, `Language`, `Attributes`, `Component_` FROM `File`' @('id', 'name', 'version', 'language', 'attributes', 'component'))
    $components = @(Read-Rows $database 'SELECT `Component`, `ComponentId`, `Attributes`, `KeyPath`, `Directory_` FROM `Component`' @('id', 'guid', 'attributes', 'keyPath', 'directory'))
    $registry = @(Read-Rows $database 'SELECT `Registry`, `Root`, `Key`, `Component_` FROM `Registry`' @('id', 'root', 'key', 'component'))
    $directories = @(Read-Rows $database 'SELECT `Directory`, `Directory_Parent`, `DefaultDir` FROM `Directory`' @('id', 'parent', 'name'))
    $installDirectory = @($directories | Where-Object { $_.id -ceq 'INSTALLFOLDER' })
    if ($installDirectory.Count -ne 1 -or $installDirectory[0].parent -cne 'LocalAppDataFolder' -or
        ($installDirectory[0].name -split '\|')[-1] -cne ('EkyMsiPolicy-' + $Descriptor.runNonce)) {
      throw 'msiPolicyDirectoryInvalid'
    }
    if ($files.Count -ne 3 -or $components.Count -ne 3 -or $registry.Count -ne 3) { throw 'msiPolicyInventoryInvalid' }
    foreach ($expected in $Descriptor.files) {
      $match = @($files | Where-Object { ($_.name -split '\|')[-1] -ceq $expected.name })
      $expectedVersion = $expected.($Role + 'Version')
      if ($match.Count -ne 1 -or $match[0].version -cne $expectedVersion -or
          (Read-FileVersion (Join-Path $Descriptor.$Role.payloadRoot $expected.name)) -cne $expectedVersion) {
        throw 'msiPolicyFileVersionInvalid'
      }
      # Vital files may inherit package compression or explicitly mark it.
      if ([int]$match[0].attributes -notin @(512, 16896)) { throw 'msiPolicyFileAttributesInvalid' }
      $component = @($components | Where-Object { $_.id -ceq $match[0].component })
      if ($component.Count -ne 1 -or [int]$component[0].attributes -ne 260 -or
          $component[0].directory -cne 'INSTALLFOLDER') { throw 'msiPolicyComponentInvalid' }
      $key = @($registry | Where-Object { $_.id -ceq $component[0].keyPath -and $_.component -ceq $component[0].id })
      if ($key.Count -ne 1 -or $key[0].root -cne '1' -or $key[0].key -cne $Descriptor.registryKey) {
        throw 'msiPolicyRegistryInvalid'
      }
    }
    return [ordered]@{ files = $files; components = $components }
  } finally {
    if ($null -ne $database) { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($database) }
    if ($null -ne $installer) { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($installer) }
  }
}

try {
  $descriptor = Get-Content -LiteralPath $DescriptorPath -Raw | ConvertFrom-Json
  if ($descriptor.runNonce -cnotmatch '^[0-9a-f]{64}$' -or
      $descriptor.productName -cne 'Eky MSI Policy Probe' -or
      $descriptor.registryKey -cne ('Software\EkyMsiPolicy\' + $descriptor.runNonce) -or
      $descriptor.installRoot -ine (Join-Path $env:LOCALAPPDATA ('EkyMsiPolicy-' + $descriptor.runNonce))) {
    throw 'msiPolicyDescriptorInvalid'
  }
  if ($Mode -eq 'Metadata') {
    # Reuse the production read-only policy guard, not a parallel interpretation.
    $source = Join-Path $PSScriptRoot '..\..\scripts\inspectWindowsInstaller.ps1'
    $tokens = $null
    $errors = $null
    $ast = [Management.Automation.Language.Parser]::ParseFile($source, [ref]$tokens, [ref]$errors)
    if ($errors.Count -ne 0) { throw 'msiPolicyReaderInvalid' }
    foreach ($name in @('Get-Properties', 'Get-ActionSequence', 'Get-InstallerPolicyRows', 'Assert-ReinstallModePolicy')) {
      $definitions = @($ast.FindAll({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq $name }, $false))
      if ($definitions.Count -ne 1) { throw 'msiPolicyReaderInvalid' }
      . ([scriptblock]::Create($definitions[0].Extent.Text))
    }
    $result = [ordered]@{ source = (Read-Metadata $descriptor 'source'); target = (Read-Metadata $descriptor 'target') }
    foreach ($file in $result.source.files) {
      $target = @($result.target.files | Where-Object { $_.id -ceq $file.id })
      if ($target.Count -ne 1 -or $target[0].language -cne $file.language) { throw 'msiPolicyLanguageInvalid' }
    }
    foreach ($component in $result.source.components) {
      $target = @($result.target.components | Where-Object { $_.id -ceq $component.id })
      if ($target.Count -ne 1 -or $target[0].guid -cne $component.guid -or $target[0].keyPath -cne $component.keyPath) {
        throw 'msiPolicyComponentIdentityInvalid'
      }
    }
    $output = [ordered]@{ schemaVersion = 1; metadataVerified = $true }
  } else {
    $versions = [ordered]@{}
    foreach ($file in $descriptor.files) {
      $path = Join-Path $descriptor.installRoot $file.name
      $versions[$file.name] = if (Test-Path -LiteralPath $path) { Read-FileVersion $path } else { $null }
    }
    $output = [ordered]@{ schemaVersion = 1; registryPresent = (Test-Path -LiteralPath ('HKCU:\' + $descriptor.registryKey)); versions = $versions }
  }
  Write-Result $output
} catch {
  $code = [string]$_.Exception.Message
  if ($code -cin @('INSTALLER_SEQUENCE_ACTION_MISSING:InstallExecute',
      'INSTALLER_SEQUENCE_ACTION_MISSING:RemoveExistingProducts',
      'INSTALLER_SEQUENCE_ACTION_MISSING:InstallFinalize')) { $code = 'msiPolicyUpgradeSequenceInvalid' }
  $known = @('msiPolicyVersionMissing', 'msiPolicyIdentityInvalid', 'msiPolicyUpgradeSequenceInvalid',
    'msiPolicyInventoryInvalid', 'msiPolicyFileVersionInvalid', 'msiPolicyFileAttributesInvalid',
    'msiPolicyComponentInvalid', 'msiPolicyRegistryInvalid', 'msiPolicyDescriptorInvalid',
    'msiPolicyReaderInvalid', 'msiPolicyLanguageInvalid', 'msiPolicyComponentIdentityInvalid',
    'msiPolicyDirectoryInvalid', 'INSTALLER_REINSTALL_POLICY_READ_FAILED',
    'INSTALLER_REINSTALL_MODE_INVALID', 'INSTALLER_REINSTALL_FORBIDDEN',
    'INSTALLER_CUSTOM_ACTION_FORBIDDEN', 'INSTALLER_REINSTALL_SEQUENCE_INVALID')
  if ($code -cnotin $known) { $code = 'unknown' }
  try { Write-Result ([ordered]@{ schemaVersion = 1; errorCode = $code }) } catch { }
  exit 1
}
