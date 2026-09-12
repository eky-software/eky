param([Parameter(Mandatory = $true)][ValidateSet('start', 'stop', 'analyze')][string]$Mode)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false
$root = $null
$instance = $null
$wpr = $null
$boundary = 'context'
$readerLoaded = $false

# Invoked only by the opt-in diagnostic workflow. Its existing step limits
# bound recorder/exporter commands; this file never starts or stops a test.
function Invoke-CaptureTool([string]$Tool, [string[]]$Arguments, [string]$Label) {
  & $Tool @Arguments *> (Join-Path $root "$Label.private.log")
  if ($LASTEXITCODE -ne 0) { throw 'INSPECTOR_CAPTURE_TOOL_FAILED' }
}

function Confirm-RecorderStopped([string]$Label) {
  Invoke-CaptureTool $wpr @('-status', '-instancename', $instance) $Label
  if ([IO.File]::ReadAllText((Join-Path $root "$Label.private.log")) -notmatch 'WPR is not recording') {
    throw 'INSPECTOR_CAPTURE_STOP_UNVERIFIED'
  }
}

try {
  if ($env:GITHUB_ACTIONS -cne 'true' -or $env:RUNNER_OS -cne 'Windows' -or
      $env:GITHUB_RUN_ID -notmatch '^[1-9][0-9]+$' -or $env:GITHUB_RUN_ATTEMPT -notmatch '^[1-9][0-9]*$' -or
      ![IO.Path]::IsPathFullyQualified($env:RUNNER_TEMP)) { throw 'INSPECTOR_CAPTURE_CONTEXT_INVALID' }
  $root = Join-Path $env:RUNNER_TEMP 'eky-inspector-capture'
  $instance = "EkyInspectorDiagnostic-$env:GITHUB_RUN_ID-$env:GITHUB_RUN_ATTEMPT"
  $wpr = Join-Path $env:SystemRoot 'System32/wpr.exe'
  $toolkit = Join-Path ${env:ProgramFiles(x86)} 'Windows Kits/10/Windows Performance Toolkit'
  $exporter = Join-Path $toolkit 'wpaexporter.exe'
  $catalog = Join-Path $toolkit 'Catalog/AppLaunch.wpaProfile'
  . (Join-Path $PSScriptRoot 'installerProductInspectionTrace.ps1')
  $readerLoaded = $true

  if ($Mode -ceq 'start') {
    $boundary = 'preparation'
    if (Test-Path -LiteralPath $root) { throw 'INSPECTOR_CAPTURE_ROOT_OCCUPIED' }
    [void][IO.Directory]::CreateDirectory($root)
    foreach ($path in @($wpr, $exporter, $catalog)) {
      if (!(Test-Path -LiteralPath $path -PathType Leaf)) { throw 'INSPECTOR_CAPTURE_TOOL_UNAVAILABLE' }
    }
    New-InspectorTraceProfile $catalog (Join-Path $root 'events.wpaProfile')
    $profile = Join-Path $root 'inspector.wprp'
    [IO.File]::WriteAllText($profile, @'
<?xml version="1.0" encoding="utf-8"?>
<WindowsPerformanceRecorder Version="1.0" Author="Eky">
  <Profiles>
    <EventCollector Id="InspectorCollector" Name="Eky inspector observations">
      <BufferSize Value="64" /><Buffers Value="8" />
    </EventCollector>
    <EventProvider Id="InspectorProvider" Name="*Eky-InstallerProductInspection-V1" />
    <Profile Id="EkyInspector.Verbose.Memory" Name="EkyInspector" Description="Inspector boundary diagnosis" LoggingMode="Memory" DetailLevel="Verbose">
      <Collectors><EventCollectorId Value="InspectorCollector"><EventProviders>
        <EventProviderId Value="InspectorProvider" />
      </EventProviders></EventCollectorId></Collectors>
    </Profile>
  </Profiles>
</WindowsPerformanceRecorder>
'@)
    Confirm-RecorderStopped 'before'
    [IO.File]::WriteAllText((Join-Path $root 'start-attempted'), '')
    $boundary = 'recorderStart'
    Invoke-CaptureTool $wpr @('-start', 'CPU', '-start', "$profile!EkyInspector", '-instancename', $instance) 'start'
  } elseif ($Mode -ceq 'stop') {
    $boundary = 'recorderStop'
    if (!(Test-Path -LiteralPath (Join-Path $root 'start-attempted'))) { throw 'INSPECTOR_CAPTURE_NOT_STARTED' }
    try {
      Invoke-CaptureTool $wpr @('-stop', (Join-Path $root 'capture.etl'), '-instancename', $instance) 'stop'
      Confirm-RecorderStopped 'after'
      [IO.File]::WriteAllText((Join-Path $root 'stopped'), '')
    } catch {
      # Cancel only this recording, never another WPR session or test process.
      Invoke-CaptureTool $wpr @('-cancel', '-instancename', $instance) 'cancel'
      Confirm-RecorderStopped 'after-cancel'
      throw 'INSPECTOR_CAPTURE_STOP_FAILED'
    }
  } else {
    $boundary = 'stopVerification'
    if (!(Test-Path -LiteralPath (Join-Path $root 'stopped'))) { throw 'INSPECTOR_CAPTURE_STOP_UNVERIFIED' }
    $boundary = 'eventExport'
    Invoke-CaptureTool $exporter @('-i', (Join-Path $root 'capture.etl'), '-profile',
      (Join-Path $root 'events.wpaProfile'), '-outputfolder', $root) 'events-export'
    $boundary = 'eventRead'
    $events = @(Get-InspectorTraceEvents @(Read-InspectorTraceTable (Join-Path $root 'Generic_Events_Inspector.csv')))
    $threads = @($events.thread | Select-Object -Unique)
    $boundary = 'schedulingProfile'
    New-InspectorTraceProfile $catalog (Join-Path $root 'threads.wpaProfile') $threads
    $boundary = 'schedulingExport'
    Invoke-CaptureTool $exporter @('-i', (Join-Path $root 'capture.etl'), '-profile',
      (Join-Path $root 'threads.wpaProfile'), '-outputfolder', $root) 'threads-export'
    $boundary = 'schedulingRead'
    $switches = @(Read-InspectorTraceTable (Join-Path $root 'CPU_Usage_(Precise)_Inspector.csv'))
    $boundary = 'summaryValidation'
    $summaries = @(Get-InspectorTraceSummary $events $switches)
    # Validate the complete extraction before releasing any observation.
    foreach ($summary in $summaries) { $summary | ConvertTo-Json -Compress }
  }
  [ordered]@{ schemaVersion = 1; operation = 'installerProductInspectionCapture'; phase = $Mode;
    status = 'completed'; resultCode = 'diagnosticOnly' } | ConvertTo-Json -Compress
} catch {
  $code = if ($readerLoaded) { Resolve-InspectorTraceErrorCode $_.Exception.Message } else { 'INSPECTOR_CAPTURE_UNEXPECTED_FAILURE' }
  if ($null -ne $root -and (Test-Path -LiteralPath $root -PathType Container)) {
    try { [IO.File]::WriteAllText((Join-Path $root "$Mode.failure.private.txt"), $_.ToString()) } catch { }
  }
  [ordered]@{ schemaVersion = 1; operation = 'installerProductInspectionCapture'; phase = $Mode;
    status = 'failed'; resultCode = 'captureUnverified'; failureBoundary = $boundary; errorCode = $code } | ConvertTo-Json -Compress
  exit 1
}
