param([Parameter(Mandatory = $true)][ValidateSet('start', 'stop', 'analyze', 'compareEvents')][string]$Mode)

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
  # These fixed tool arguments contain paths/switches, never quoted commands.
  # Start-Process joins ArgumentList; reject unsupported quoting before launch.
  if ($Arguments.Count -eq 0 -or @($Arguments | Where-Object {
    $_ -match '["\r\n\x00]' -or $_.EndsWith('\')
  }).Count -ne 0) { throw 'INSPECTOR_CAPTURE_ARGUMENTS_INVALID' }
  $argumentLine = ($Arguments | ForEach-Object { '"' + $_ + '"' }) -join ' '
  $process = Start-Process -FilePath $Tool -ArgumentList $argumentLine -Wait -PassThru -NoNewWindow `
    -RedirectStandardOutput (Join-Path $root "$Label.private.log") `
    -RedirectStandardError (Join-Path $root "$Label.stderr.private.log")
  try {
    if (!$process.HasExited) { throw 'INSPECTOR_CAPTURE_TOOL_EXIT_UNVERIFIED' }
    if ($process.ExitCode -ne 0) {
      $failure = [InvalidOperationException]::new('INSPECTOR_CAPTURE_TOOL_FAILED')
      $failure.Data['toolExitCode'] = $process.ExitCode
      throw $failure
    }
  } finally { $process.Dispose() }
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
    Confirm-InspectorCaptureSpace ([IO.DriveInfo]::new([IO.Path]::GetPathRoot($root)).AvailableFreeSpace)
    [void][IO.Directory]::CreateDirectory($root)
    foreach ($path in @($wpr, $exporter, $catalog)) {
      if (!(Test-Path -LiteralPath $path -PathType Leaf)) { throw 'INSPECTOR_CAPTURE_TOOL_UNAVAILABLE' }
    }
    New-InspectorTraceProfile $catalog (Join-Path $root 'events.wpaProfile')
    $cpuExport = Join-Path $root 'cpu-export.private.wprp'
    $cpuProfile = Join-Path $root 'cpu-bounded.private.wprp'
    Invoke-CaptureTool $wpr @('-exportprofile', 'CPU', $cpuExport, '-filemode') 'cpu-export'
    $bounded = New-InspectorCpuCaptureProfile ([xml][IO.File]::ReadAllText($cpuExport))
    $bounded.Save($cpuProfile)
    $profile = Join-Path $root 'inspector.wprp'
    [IO.File]::WriteAllText($profile, @'
<?xml version="1.0" encoding="utf-8"?>
<WindowsPerformanceRecorder Version="1.0" Author="Eky">
  <Profiles>
    <EventCollector Id="InspectorCollector" Name="Eky inspector observations">
      <BufferSize Value="64" /><Buffers Value="8" />
      <MaximumFileSize Value="16" FileMode="Sequential" />
    </EventCollector>
    <EventProvider Id="InspectorProvider" Name="*Eky-InstallerProductInspection-V1" />
    <Profile Id="EkyInspector.Verbose.File" Name="EkyInspector" Description="Inspector boundary diagnosis" LoggingMode="File" DetailLevel="Verbose">
      <Collectors><EventCollectorId Value="InspectorCollector"><EventProviders>
        <EventProviderId Value="InspectorProvider" />
      </EventProviders></EventCollectorId></Collectors>
    </Profile>
  </Profiles>
</WindowsPerformanceRecorder>
'@)
    Invoke-CaptureTool $wpr @('-profiles', $cpuProfile) 'cpu-profile-validation'
    Invoke-CaptureTool $wpr @('-profiles', $profile) 'inspector-profile-validation'
    $recordingRoot = Join-Path $root 'recording'
    [void][IO.Directory]::CreateDirectory($recordingRoot)
    Confirm-RecorderStopped 'before'
    [IO.File]::WriteAllText((Join-Path $root 'start-attempted'), '')
    $boundary = 'recorderStart'
    Invoke-CaptureTool $wpr @('-start', "$cpuProfile!CPU", '-start', "$profile!EkyInspector",
      '-filemode', '-recordtempto', $recordingRoot, '-instancename', $instance) 'start'
  } elseif ($Mode -ceq 'stop') {
    $boundary = 'recorderStop'
    if (!(Test-Path -LiteralPath (Join-Path $root 'start-attempted'))) { throw 'INSPECTOR_CAPTURE_NOT_STARTED' }
    $collectorFailure = $null
    try {
      Invoke-CaptureTool $wpr @('-status', 'collectors', '-instancename', $instance) 'collectors-before-stop'
      Confirm-InspectorCaptureCollectors ([IO.File]::ReadAllText((Join-Path $root 'collectors-before-stop.private.log')))
    } catch { $collectorFailure = $_.Exception }
    try {
      Invoke-CaptureTool $wpr @('-stop', (Join-Path $root 'capture.etl'), '-instancename', $instance) 'stop'
      Confirm-RecorderStopped 'after'
    } catch {
      # Cancel only this recording, never another WPR session or test process.
      Invoke-CaptureTool $wpr @('-cancel', '-instancename', $instance) 'cancel'
      Confirm-RecorderStopped 'after-cancel'
      throw 'INSPECTOR_CAPTURE_STOP_FAILED'
    }
    # A cap-stopped/missing collector or event loss cannot be cured by a merge.
    # Recorder cleanup is still mandatory when this diagnostic check fails.
    if ($null -ne $collectorFailure) { throw $collectorFailure }
    [IO.File]::WriteAllText((Join-Path $root 'stopped'), '')
  } elseif ($Mode -ceq 'compareEvents') {
    $boundary = 'stopVerification'
    if (!(Test-Path -LiteralPath (Join-Path $root 'stopped'))) { throw 'INSPECTOR_CAPTURE_STOP_UNVERIFIED' }
    $etl = Join-Path $root 'capture.etl'
    $traceHash = (Get-FileHash -LiteralPath $etl -Algorithm SHA256).Hash
    $comparisonFailed = $false
    foreach ($view in @('current', 'minimal')) {
      $boundary = 'eventExport'
      $outputRoot = Join-Path $root "comparison-$view"
      if (Test-Path -LiteralPath $outputRoot) { throw 'INSPECTOR_CAPTURE_ROOT_OCCUPIED' }
      [void][IO.Directory]::CreateDirectory($outputRoot)
      $profile = Join-Path $outputRoot 'events.wpaProfile'
      New-InspectorTraceProfile $catalog $profile -MinimalEvents:($view -ceq 'minimal')
      $label = "comparison-$view"
      $report = [ordered]@{ schemaVersion = 1; operation = 'installerProductInspectionCapture';
        phase = 'eventViewComparison'; view = $view; status = 'failed'; resultCode = 'diagnosticUnverified' }
      try {
        Invoke-CaptureTool $exporter @('-i', $etl, '-profile', $profile, '-outputfolder', $outputRoot) $label
        $report.toolExitCode = 0
        $boundary = 'eventRead'
        $table = if ($view -ceq 'minimal') { 'Generic_Events_InspectorMinimal.csv' } else { 'Generic_Events_Inspector.csv' }
        $rows = @(Read-InspectorTraceTable (Join-Path $outputRoot $table))
        $events = @(Get-InspectorTraceEvents $rows)
        $report.eventCount = $events.Count
        if ($view -ceq 'minimal') {
          $boundary = 'externalProof'
          Confirm-InspectorExternalReadOnlyEvents $rows
          $report.providerBinding = 'validated'
          $report.readOnlyBoundaries = 'validated'
        }
        $report.status = 'completed'
        $report.resultCode = 'diagnosticOnly'
      } catch {
        $comparisonFailed = $true
        $report.failureBoundary = $boundary
        $report.errorCode = Resolve-InspectorTraceErrorCode $_.Exception.Message
        if ($_.Exception.Data['toolExitCode'] -is [int]) { $report.toolExitCode = $_.Exception.Data['toolExitCode'] }
        try { [IO.File]::WriteAllText((Join-Path $outputRoot 'failure.private.txt'), $_.ToString()) } catch { }
      }
      $report.exportOutput = Get-InspectorExportLogObservation (Join-Path $root "$label.private.log") (Join-Path $root "$label.stderr.private.log")
      $report | ConvertTo-Json -Depth 5 -Compress
    }
    $boundary = 'traceIdentity'
    if ((Get-FileHash -LiteralPath $etl -Algorithm SHA256).Hash -cne $traceHash) { throw 'INSPECTOR_TRACE_CHANGED' }
    [ordered]@{ schemaVersion = 1; operation = 'installerProductInspectionCapture'; phase = 'traceIdentity';
      status = 'completed'; resultCode = 'sameTraceBytes' } | ConvertTo-Json -Compress
    if ($comparisonFailed) { throw 'INSPECTOR_TRACE_COMPARISON_FAILED' }
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
  exit 0
} catch {
  $failure = $_.Exception
  $code = if ($readerLoaded) { Resolve-InspectorTraceErrorCode $failure.Message } else { 'INSPECTOR_CAPTURE_UNEXPECTED_FAILURE' }
  if ($null -ne $root -and (Test-Path -LiteralPath $root -PathType Container)) {
    try { [IO.File]::WriteAllText((Join-Path $root "$Mode.failure.private.txt"), $_.ToString()) } catch { }
  }
  $result = [ordered]@{ schemaVersion = 1; operation = 'installerProductInspectionCapture'; phase = $Mode;
    status = 'failed'; resultCode = 'captureUnverified'; failureBoundary = $boundary; errorCode = $code }
  if ($readerLoaded) {
    $shape = @(Get-InspectorTraceFailureShape $failure)
    if ($shape.Count -gt 0) { $result.processLabelShape = $shape }
  }
  if ($code -ceq 'INSPECTOR_CAPTURE_TOOL_FAILED' -and $failure.Data['toolExitCode'] -is [int]) {
    $result.toolExitCode = $failure.Data['toolExitCode']
  }
  if ($boundary -cin @('eventExport', 'schedulingExport')) {
    $label = if ($boundary -ceq 'eventExport') { 'events-export' } else { 'threads-export' }
    $result.exportOutput = Get-InspectorExportLogObservation (Join-Path $root "$label.private.log") (Join-Path $root "$label.stderr.private.log")
  }
  $result | ConvertTo-Json -Depth 5 -Compress
  exit 1
}
