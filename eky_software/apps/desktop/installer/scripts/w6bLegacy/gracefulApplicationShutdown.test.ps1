param(
  [Parameter(Mandatory = $true)]
  [ValidateSet(
    'windowDelayed',
    'windowTimeout',
    'duplicateWindowOwners',
    'foreignWindowIgnored',
    'processIdentityMismatch',
    'rootExitsBeforeWindow'
  )]
  [string]$TestCase
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '..\windowsInstallerProcessTree.ps1')
. (Join-Path $PSScriptRoot 'gracefulApplicationShutdown.ps1')

$script:OwnedProcesses = @()
$script:EventHandles = @()
$script:FixtureRoot = Join-Path $env:TEMP `
  ('eky-w6b-window-' + [Guid]::NewGuid().ToString('N'))
$script:WindowFixturePath = Join-Path $script:FixtureRoot `
  'EkyW6bWindowFixture.exe'

function Initialize-W6bGracefulWindowFixture {
  New-Item -ItemType Directory -Path $script:FixtureRoot -Force | Out-Null
  Add-Type -TypeDefinition @'
using System;
using System.Diagnostics;
using System.Threading;
using System.Windows.Forms;

public static class EkyW6bWindowFixture
{
    [STAThread]
    public static int Main(string[] args)
    {
        if (args.Length != 2 && args.Length != 3)
        {
            return 40;
        }
        Process child = null;
        using (var open = EventWaitHandle.OpenExisting(args[0]))
        using (var ready = EventWaitHandle.OpenExisting(args[1]))
        {
            if (!open.WaitOne(5000))
            {
                return 41;
            }
            if (args.Length == 3)
            {
                var childInfo = new ProcessStartInfo
                {
                    FileName = Application.ExecutablePath,
                    Arguments = args[0] + " " + args[2],
                    UseShellExecute = false
                };
                child = Process.Start(childInfo);
            }
            using (var form = new Form())
            {
                form.Text = "Eky W6B synthetic window";
                form.Shown += (_, __) => ready.Set();
                Application.Run(form);
            }
        }
        if (child != null)
        {
            child.Dispose();
        }
        return 0;
    }
}
'@ -OutputAssembly $script:WindowFixturePath `
    -OutputType WindowsApplication `
    -ReferencedAssemblies @(
      'System.dll',
      'System.Drawing.dll',
      'System.Windows.Forms.dll'
    )
}

function ConvertTo-W6bGracefulEncodedCommand {
  param([Parameter(Mandatory = $true)][string]$Command)

  return [Convert]::ToBase64String(
    [Text.Encoding]::Unicode.GetBytes($Command)
  )
}

function New-W6bGracefulEvent {
  param([Parameter(Mandatory = $true)][string]$Name)

  $event = [Threading.EventWaitHandle]::new(
    $false,
    [Threading.EventResetMode]::ManualReset,
    $Name
  )
  $script:EventHandles += $event
  return $event
}

function Start-W6bGracefulPowerShellProcess {
  param([Parameter(Mandatory = $true)][string]$Command)

  $process = Start-Process powershell.exe -ArgumentList @(
    '-NoProfile',
    '-NonInteractive',
    '-STA',
    '-EncodedCommand',
    (ConvertTo-W6bGracefulEncodedCommand -Command $Command)
  ) -WindowStyle Hidden -PassThru
  $script:OwnedProcesses += $process
  return $process
}

function Start-W6bGracefulWindowProcess {
  param(
    [Parameter(Mandatory = $true)][string]$OpenEventName,
    [Parameter(Mandatory = $true)][string]$ReadyEventName,
    [AllowNull()][string]$ChildReadyEventName = $null
  )

  $arguments = @($OpenEventName, $ReadyEventName)
  if (![string]::IsNullOrEmpty($ChildReadyEventName)) {
    $arguments += $ChildReadyEventName
  }
  $process = Start-Process -FilePath $script:WindowFixturePath `
    -ArgumentList $arguments -PassThru
  $script:OwnedProcesses += $process
  return $process
}

function Start-W6bGracefulWindowFixture {
  try {
    $prefix = 'Local\EkyW6bWindow-' + [Guid]::NewGuid().ToString('N')
    $openName = "$prefix-open"
    $readyName = "$prefix-ready"
    $open = New-W6bGracefulEvent -Name $openName
    $ready = New-W6bGracefulEvent -Name $readyName
    return [pscustomobject]@{
      open = $open
      process = Start-W6bGracefulWindowProcess `
        -OpenEventName $openName -ReadyEventName $readyName
      ready = $ready
    }
  }
  catch {
    throw 'W6B_LEGACY_GRACEFUL_FIXTURE_START_FAILED'
  }
}

function Start-W6bGracefulNoWindowFixture {
  param([int]$WaitMilliseconds = 20000)

  $eventName = 'Local\EkyW6bNoWindow-' + [Guid]::NewGuid().ToString('N')
  $release = New-W6bGracefulEvent -Name $eventName
  $command = @"
`$release = [Threading.EventWaitHandle]::OpenExisting('$eventName')
try {
  if (!`$release.WaitOne($WaitMilliseconds)) { exit 42 }
  exit 0
}
finally { `$release.Dispose() }
"@
  return [pscustomobject]@{
    process = Start-W6bGracefulPowerShellProcess -Command $command
    release = $release
  }
}

function Start-W6bGracefulDuplicateWindowFixture {
  $prefix = 'Local\EkyW6bDuplicate-' + [Guid]::NewGuid().ToString('N')
  $readyOneName = "$prefix-ready-one"
  $readyTwoName = "$prefix-ready-two"
  $openName = "$prefix-open"
  $readyOne = New-W6bGracefulEvent -Name $readyOneName
  $readyTwo = New-W6bGracefulEvent -Name $readyTwoName
  $open = New-W6bGracefulEvent -Name $openName
  $open.Set() | Out-Null
  return [pscustomobject]@{
    process = Start-W6bGracefulWindowProcess `
      -OpenEventName $openName `
      -ReadyEventName $readyOneName `
      -ChildReadyEventName $readyTwoName
    readyOne = $readyOne
    readyTwo = $readyTwo
  }
}

function New-W6bGracefulRootIdentity {
  param([Parameter(Mandatory = $true)]$Process)

  return New-EkyProcessIdentity -ProcessId ([int]$Process.Id) `
    -CreationToken (ConvertTo-EkyProcessCreationToken `
      -CreationTime ([DateTime]$Process.StartTime))
}

function Assert-W6bGracefulThrows {
  param(
    [Parameter(Mandatory = $true)][scriptblock]$Action,
    [Parameter(Mandatory = $true)][string]$ExpectedCode
  )

  try {
    & $Action
  }
  catch {
    if ($_.Exception.Message -ceq $ExpectedCode) {
      return
    }
    if ($_.Exception.Message -match '^W6B_LEGACY_[A-Z0-9_]+$') {
      throw $_.Exception.Message
    }
    throw 'W6B_LEGACY_GRACEFUL_TEST_ERROR_CODE_MISMATCH'
  }
  throw 'W6B_LEGACY_GRACEFUL_TEST_EXPECTED_FAILURE_MISSING'
}

function Stop-W6bGracefulOwnedFixtures {
  foreach ($event in $script:EventHandles) {
    try { $event.Set() | Out-Null } catch {}
  }
  foreach ($process in $script:OwnedProcesses) {
    try {
      $process.Refresh()
      if (!$process.HasExited) {
        Stop-EkyProcessTree -Process $process
      }
    }
    catch {}
    finally { $process.Dispose() }
  }
  foreach ($event in $script:EventHandles) {
    $event.Dispose()
  }
  if (Test-Path -LiteralPath $script:FixtureRoot) {
    Remove-Item -LiteralPath $script:FixtureRoot -Recurse -Force
  }
}

try {
  Initialize-W6bGracefulWindowFixture
  switch ($TestCase) {
    'windowDelayed' {
      $fixture = Start-W6bGracefulWindowFixture
      $fixture.process.Refresh()
      if ($fixture.process.MainWindowHandle -ne [IntPtr]::Zero) {
        throw 'W6B_LEGACY_GRACEFUL_TEST_WINDOW_OPENED_EARLY'
      }
      $fixture.open.Set() | Out-Null
      Stop-W6bEkyGracefully -Process $fixture.process `
        -TimeoutMilliseconds 5000 -PollMilliseconds 25
      if (!$fixture.ready.WaitOne(0)) {
        throw 'W6B_LEGACY_GRACEFUL_TEST_WINDOW_NOT_OBSERVED'
      }
    }
    'windowTimeout' {
      $fixture = Start-W6bGracefulNoWindowFixture
      $identity = New-W6bGracefulRootIdentity -Process $fixture.process
      Assert-W6bGracefulThrows -ExpectedCode `
        'W6B_LEGACY_APPLICATION_WINDOW_TIMEOUT' -Action {
          Wait-W6bOwnedApplicationWindow -RootIdentity $identity `
            -Deadline ([DateTime]::UtcNow.AddMilliseconds(250)) `
            -PollMilliseconds 25
        }
    }
    'duplicateWindowOwners' {
      $fixture = Start-W6bGracefulDuplicateWindowFixture
      if (
        !$fixture.readyOne.WaitOne(5000) -or
        !$fixture.readyTwo.WaitOne(5000)
      ) {
        throw 'W6B_LEGACY_GRACEFUL_TEST_DUPLICATE_NOT_READY'
      }
      $identity = New-W6bGracefulRootIdentity -Process $fixture.process
      Assert-W6bGracefulThrows -ExpectedCode `
        'W6B_LEGACY_APPLICATION_WINDOW_OWNERSHIP_AMBIGUOUS' -Action {
          Wait-W6bOwnedApplicationWindow -RootIdentity $identity `
            -Deadline ([DateTime]::UtcNow.AddSeconds(2)) `
            -PollMilliseconds 25
        }
    }
    'foreignWindowIgnored' {
      $foreign = Start-W6bGracefulWindowFixture
      $foreign.open.Set() | Out-Null
      if (!$foreign.ready.WaitOne(5000)) {
        throw 'W6B_LEGACY_GRACEFUL_TEST_FOREIGN_NOT_READY'
      }
      $owned = Start-W6bGracefulNoWindowFixture
      $identity = New-W6bGracefulRootIdentity -Process $owned.process
      Assert-W6bGracefulThrows -ExpectedCode `
        'W6B_LEGACY_APPLICATION_WINDOW_TIMEOUT' -Action {
          Wait-W6bOwnedApplicationWindow -RootIdentity $identity `
            -Deadline ([DateTime]::UtcNow.AddMilliseconds(250)) `
            -PollMilliseconds 25
        }
      $foreign.process.Refresh()
      if (
        $foreign.process.HasExited -or
        $foreign.process.MainWindowHandle -eq [IntPtr]::Zero
      ) {
        throw 'W6B_LEGACY_GRACEFUL_TEST_FOREIGN_WINDOW_CHANGED'
      }
    }
    'processIdentityMismatch' {
      $fixture = Start-W6bGracefulNoWindowFixture
      $identity = New-W6bGracefulRootIdentity -Process $fixture.process
      $identity = New-EkyProcessIdentity -ProcessId $identity.processId `
        -CreationToken ([long]::Parse($identity.creationToken) + 1).ToString()
      Assert-W6bGracefulThrows -ExpectedCode `
        'W6B_LEGACY_APPLICATION_PROCESS_IDENTITY_MISMATCH' -Action {
          Get-W6bOwnedApplicationWindowState -RootIdentity $identity
        }
    }
    'rootExitsBeforeWindow' {
      $process = Start-W6bGracefulPowerShellProcess -Command 'exit 0'
      $identity = New-W6bGracefulRootIdentity -Process $process
      $process.WaitForExit(5000) | Out-Null
      Assert-W6bGracefulThrows -ExpectedCode `
        'W6B_LEGACY_APPLICATION_EXITED_BEFORE_WINDOW' -Action {
          Wait-W6bOwnedApplicationWindow -RootIdentity $identity `
            -Deadline ([DateTime]::UtcNow.AddSeconds(1)) `
            -PollMilliseconds 25
        }
    }
  }
  [ordered]@{ status = 'passed'; testCase = $TestCase } |
    ConvertTo-Json -Compress
}
catch {
  $candidate = ([string]$_.Exception.Message -split ':')[0]
  $errorCode = if ($candidate -match '^W6B_LEGACY_[A-Z0-9_]+$') {
    $candidate
  }
  else {
    'W6B_LEGACY_GRACEFUL_TEST_FAILED'
  }
  [ordered]@{
    errorCode = $errorCode
    status = 'failed'
    testCase = $TestCase
  } | ConvertTo-Json -Compress
  exit 1
}
finally {
  Stop-W6bGracefulOwnedFixtures
}
