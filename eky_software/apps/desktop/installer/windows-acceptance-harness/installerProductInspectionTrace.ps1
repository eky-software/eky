Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Resolve-InspectorTraceErrorCode([string]$Message) {
  $allowed = @('INSPECTOR_CAPTURE_TOOL_FAILED', 'INSPECTOR_CAPTURE_STOP_UNVERIFIED',
    'INSPECTOR_CAPTURE_ARGUMENTS_INVALID', 'INSPECTOR_CAPTURE_TOOL_EXIT_UNVERIFIED',
    'INSPECTOR_CAPTURE_CONTEXT_INVALID', 'INSPECTOR_CAPTURE_ROOT_OCCUPIED',
    'INSPECTOR_CAPTURE_TOOL_UNAVAILABLE', 'INSPECTOR_CAPTURE_NOT_STARTED',
    'INSPECTOR_CAPTURE_PROFILE_INVALID', 'INSPECTOR_CAPTURE_SPACE_INSUFFICIENT',
    'INSPECTOR_CAPTURE_COLLECTORS_UNVERIFIED', 'INSPECTOR_CAPTURE_EVENTS_LOST',
    'INSPECTOR_CAPTURE_STOP_FAILED', 'INSPECTOR_TRACE_TABLE_LIMIT',
    'INSPECTOR_TRACE_TABLE_INVALID', 'INSPECTOR_TRACE_EVENTS_MISSING',
    'INSPECTOR_TRACE_PROVIDER_INVALID', 'INSPECTOR_TRACE_EVENT_NAME_INVALID',
    'INSPECTOR_TRACE_EVENT_THREAD_INVALID', 'INSPECTOR_TRACE_EVENT_PROCESS_INVALID',
    'INSPECTOR_TRACE_EVENT_PROCESS_MISSING', 'INSPECTOR_TRACE_EVENT_PROCESS_NUMERIC',
    'INSPECTOR_TRACE_EVENT_PROCESS_COMPACT', 'INSPECTOR_TRACE_EVENT_PROCESS_GROUPED',
    'INSPECTOR_TRACE_EVENT_TIME_INVALID', 'INSPECTOR_TRACE_THREADS_INVALID',
    'INSPECTOR_TRACE_STREAMS_INVALID', 'INSPECTOR_TRACE_SWITCH_INVALID',
    'INSPECTOR_TRACE_EXTERNAL_BINDING_INVALID', 'INSPECTOR_TRACE_BOUNDARIES_INVALID',
    'INSPECTOR_TRACE_CHANGED', 'INSPECTOR_TRACE_COMPARISON_FAILED',
    'INSPECTOR_TRACE_COMMAND_MISSING', 'INSPECTOR_TRACE_COMMAND_AMBIGUOUS', 'INSPECTOR_TRACE_STATISTICS_INVALID',
    'INSPECTOR_TRACE_LIFETIME_INVALID', 'INSPECTOR_TRACE_PHASE_INVALID')
  if ($Message -cin $allowed) { return $Message }
  return 'INSPECTOR_CAPTURE_UNEXPECTED_FAILURE'
}

function Confirm-InspectorCaptureSpace([long]$AvailableBytes) {
  if ($AvailableBytes -lt 6GB) { throw 'INSPECTOR_CAPTURE_SPACE_INSUFFICIENT' }
}

# Derive from this runner's built-in CPU profile, preserving its providers.
# Unknown inheritance or additional collectors must not start an uncapped trace.
function New-InspectorCpuCaptureProfile([xml]$ExportedProfile) {
  $profile = [xml]$ExportedProfile.CloneNode($true)
  $root = $profile.SelectSingleNode('/WindowsPerformanceRecorder/Profiles')
  if ($null -eq $root -or $profile.SelectNodes('//*[@Base]').Count -ne 0 -or
      $profile.SelectNodes('//MaximumFileSize | //FileMax').Count -ne 0 -or
      $root.SelectNodes('Profile').Count -ne 1 -or
      $root.SelectNodes('SystemCollector').Count -ne 1 -or
      $root.SelectNodes('EventCollector').Count -ne 1 -or
      $root.SelectNodes('*[contains(local-name(), "Collector")]').Count -ne 2) {
    throw 'INSPECTOR_CAPTURE_PROFILE_INVALID'
  }
  $selected = $root.SelectSingleNode('Profile')
  if ($selected.GetAttribute('Id') -cne 'CPU.Verbose.File' -or
      $selected.GetAttribute('Name') -cne 'CPU' -or
      $selected.GetAttribute('LoggingMode') -cne 'File' -or
      $selected.GetAttribute('DetailLevel') -cne 'Verbose' -or
      $selected.SelectNodes('Collectors/*').Count -ne 2) { throw 'INSPECTOR_CAPTURE_PROFILE_INVALID' }
  foreach ($kind in @('System', 'Event')) {
    $collector = $root.SelectSingleNode("${kind}Collector")
    $reference = $selected.SelectSingleNode("Collectors/${kind}CollectorId")
    if ($null -eq $reference -or $collector.GetAttribute('Id') -ceq '' -or
        $collector.GetAttribute('Name') -ceq '' -or
        $reference.GetAttribute('Value') -cne $collector.GetAttribute('Id')) {
      throw 'INSPECTOR_CAPTURE_PROFILE_INVALID'
    }
    $limit = $profile.CreateElement('MaximumFileSize')
    $limit.SetAttribute('Value', '1024')
    $limit.SetAttribute('FileMode', 'Sequential')
    # The WPR schema places the limit after optional StackCaching.
    $after = $collector.SelectSingleNode('StackCaching')
    if ($null -eq $after) { $after = $collector.SelectSingleNode('Buffers') }
    if ($null -eq $after) { throw 'INSPECTOR_CAPTURE_PROFILE_INVALID' }
    [void]$collector.InsertAfter($limit, $after)
  }
  return ,$profile
}

function Confirm-InspectorCaptureCollectors([string]$Status) {
  # WPR's English CLI output is private. Unknown/localized output fails closed.
  $collectors = @([regex]::Matches($Status, '(?m)^\s*Collector Name\s*:\s*([^\r\n]+)') |
    ForEach-Object { $_.Groups[1].Value.Trim() })
  $lost = @([regex]::Matches($Status, '(?m)^\s*Events Lost\s*:\s*([^\r\n]+)') |
    ForEach-Object { $_.Groups[1].Value.Trim() })
  if ($Status -cnotmatch 'Actively recording collectors:' -or
      $Status -cnotmatch '(?m)^\s*Logging mode\s*:\s*File\s*$' -or
      $collectors.Count -ne 3 -or $lost.Count -ne 3 -or
      @($collectors | Select-Object -Unique).Count -ne 3) {
    throw 'INSPECTOR_CAPTURE_COLLECTORS_UNVERIFIED'
  }
  if (@($lost | Where-Object { $_ -cne '0' }).Count -ne 0) { throw 'INSPECTOR_CAPTURE_EVENTS_LOST' }
}

function Get-InspectorProcessLabelShape([string]$Label) {
  $shape = [Collections.Generic.List[string]]::new()
  $punctuation = @{ '(' = 'roundOpen'; ')' = 'roundClose'; '[' = 'squareOpen'; ']' = 'squareClose';
    '<' = 'angleOpen'; '>' = 'angleClose'; ':' = 'colon'; ',' = 'comma'; '.' = 'dot';
    '/' = 'slash'; '\' = 'backslash'; '-' = 'hyphen' }
  foreach ($character in $Label.ToCharArray()) {
    $token = if ([char]::IsLetter($character)) { 'text' }
      elseif ([char]::IsDigit($character)) { 'number' }
      elseif ([char]::IsWhiteSpace($character)) { 'space' }
      elseif ($punctuation.ContainsKey([string]$character)) { $punctuation[[string]$character] }
      else { 'other' }
    if ($shape.Count -eq 0 -or $shape[$shape.Count - 1] -cne $token) { $shape.Add($token) }
    if ($shape.Count -gt 24) { return @('shapeLimit') }
  }
  return $shape.ToArray()
}

function Get-InspectorTraceFailureShape([Exception]$Failure) {
  if ((Resolve-InspectorTraceErrorCode $Failure.Message) -cne 'INSPECTOR_TRACE_EVENT_PROCESS_INVALID') { return @() }
  $shape = @($Failure.Data['processLabelShape'])
  $allowed = @('text', 'number', 'space', 'roundOpen', 'roundClose', 'squareOpen', 'squareClose',
    'angleOpen', 'angleClose', 'colon', 'comma', 'dot', 'slash', 'backslash', 'hyphen', 'other', 'shapeLimit')
  if ($shape.Count -gt 0 -and $shape.Count -le 24 -and
      @($shape | Where-Object { $_ -cnotin $allowed }).Count -eq 0) { return $shape }
  return @()
}

function Get-InspectorExportLogObservation([string]$OutputPath, [string]$ErrorPath) {
  # Messages are observations, not a causal classification of the exit code.
  # A successful exporter may also contain non-fatal error messages.
  try {
    $texts = @($OutputPath, $ErrorPath | ForEach-Object {
      if ((Get-Item -LiteralPath $_).Length -gt 1MB) { throw 'privateOutputLimit' }
      [IO.File]::ReadAllText($_)
    })
    $text = $texts -join "`n"
    $signals = [ordered]@{
      profileSelected = $text -match '(?m)^Exporting Profile:'
      traceRangeSelected = $text -match 'Exporting entire trace time range'
      timeInversionMessage = $text -match '(?i)time inversions?'
      eventLossMessage = $text -match '(?i)(events? (?:were |was )?lost|lost events?)'
      noDataMessage = $text -match '(?i)(no (?:matching |exportable )?(?:data|tables)|no events (?:found|available))'
      profileFailureMessage = $text -match '(?i)(?:failed|unable|cannot|could not) (?:to )?(?:load|parse|read) (?:the )?profile'
      memoryFailureMessage = $text -match 'System\.OutOfMemoryException|(?i)not enough memory'
      fileCorruptionMessage = $text -match '(?i)\bthe file or directory is corrupted and unreadable\b'
    }
    return [ordered]@{ logRead = 'completed'; stdoutPresent = $texts[0].Length -gt 0;
      stderrPresent = $texts[1].Length -gt 0; signals = $signals }
  } catch {
    return [ordered]@{ logRead = 'unavailable'; stdoutPresent = $null; stderrPresent = $null; signals = $null }
  }
}

function Get-InspectorTraceProviderId {
  $provider = [Diagnostics.Tracing.EventSource]::new('Eky-InstallerProductInspection-V1')
  try { return $provider.Guid } finally { $provider.Dispose() }
}

# This is a provider-presence observation, not an event-order or loss-count proof.
function Read-InspectorTraceStatistics([string]$Path) {
  if ((Get-Item -LiteralPath $Path).Length -gt 1MB) { Stop-InspectorTraceTableLimit 'bytes' }
  $reader = [IO.StreamReader]::new($Path)
  try {
    $buffer = [char[]]::new(1MB + 1)
    $length = $reader.ReadBlock($buffer, 0, $buffer.Length)
    if ($length -gt 1MB) { Stop-InspectorTraceTableLimit 'bytes' }
    $text = [string]::new($buffer, 0, $length)
  } finally { $reader.Dispose() }
  $identity = (Get-InspectorTraceProviderId).ToString()
  $section = $null
  $seen = @{}
  $totals = @{}
  $count = $null
  foreach ($line in ($text -split '\r?\n')) {
    if ($line -cmatch '^(Classic EventGuid|Crimson ProviderId|TraceLogging ProviderId)\s+TotalCount\s+TotalSize\s+Name\s*$') {
      $section = $Matches[1]
      if ($seen.ContainsKey($section)) { throw 'INSPECTOR_TRACE_STATISTICS_INVALID' }
      $seen[$section] = $true
    } elseif ($line -cmatch '^\s*[0-9]{1,16}\s+[0-9]{1,16}\s+<All>\s*$') {
      if ($null -eq $section -or $totals.ContainsKey($section)) { throw 'INSPECTOR_TRACE_STATISTICS_INVALID' }
      $totals[$section] = $true
    } elseif ($line -match ([regex]::Escape($identity)) -or $line.Contains('Eky-InstallerProductInspection-V1')) {
      if ($section -cne 'TraceLogging ProviderId' -or $null -ne $count -or
          $line -cnotmatch '^\{([0-9a-fA-F-]{36})\}\s+([0-9]{1,16})\s+[0-9]{1,16}\s+Eky-InstallerProductInspection-V1\s*$') {
        throw 'INSPECTOR_TRACE_STATISTICS_INVALID'
      }
      if ($Matches[1] -ine $identity -or [long]$Matches[2] -gt 9007199254740991) { throw 'INSPECTOR_TRACE_STATISTICS_INVALID' }
      $count = [long]$Matches[2]
    }
  }
  if ($seen.Count -eq 0 -or $seen.Count -ne $totals.Count) { throw 'INSPECTOR_TRACE_STATISTICS_INVALID' }
  return [ordered]@{ providerPresent = $null -ne $count -and $count -gt 0;
    eventCount = if ($null -eq $count) { 0 } else { $count } }
}

# This diagnostic reader never controls the test or infers Job membership.
function Stop-InspectorTraceTableLimit([ValidateSet('bytes', 'rows')][string]$Kind) {
  $failure = [InvalidOperationException]::new('INSPECTOR_TRACE_TABLE_LIMIT')
  $failure.Data['tableLimitKind'] = $Kind
  throw $failure
}

function Read-InspectorTraceTable([string]$Path) {
  if ((Get-Item -LiteralPath $Path).Length -gt 32MB) { Stop-InspectorTraceTableLimit 'bytes' }
  Add-Type -AssemblyName Microsoft.VisualBasic
  $parser = [Microsoft.VisualBasic.FileIO.TextFieldParser]::new($Path, [Text.Encoding]::UTF8)
  try {
    $parser.SetDelimiters(',')
    $parser.HasFieldsEnclosedInQuotes = $true
    $headers = $parser.ReadFields()
    $seen = @{}
    for ($index = 0; $index -lt $headers.Length; $index++) {
      $name = $headers[$index]
      if ($seen.ContainsKey($name)) { $seen[$name]++; $headers[$index] += '_' + $seen[$name] }
      else { $seen[$name] = 1 }
    }
    $count = 0
    while (!$parser.EndOfData) {
      if (++$count -gt 100000) { Stop-InspectorTraceTableLimit 'rows' }
      $fields = $parser.ReadFields()
      if ($fields.Length -ne $headers.Length) { throw 'INSPECTOR_TRACE_TABLE_INVALID' }
      $row = [ordered]@{}
      for ($index = 0; $index -lt $headers.Length; $index++) { $row[$headers[$index]] = $fields[$index] }
      [pscustomobject]$row
    }
  } finally { $parser.Dispose() }
}

# xperf's process action emits two fixed headers and interleaved process/thread
# records. Command lines are an opaque, unquoted remainder, not CSV strings.
# This projection is diagnostic only: neither parentage nor ETW exit is a Job proof.
function Read-LegacyCommandTrace([string]$Path, [switch]$ContractFixture) {
  if ((Get-Item -LiteralPath $Path).Length -gt 32MB) { Stop-InspectorTraceTableLimit 'bytes' }
  Add-Type -AssemblyName Microsoft.VisualBasic
  $parser = [Microsoft.VisualBasic.FileIO.TextFieldParser]::new($Path, [Text.Encoding]::UTF8)
  $processes = [Collections.Generic.List[object]]::new()
  try {
    $parser.SetDelimiters(',')
    $parser.HasFieldsEnclosedInQuotes = $false
    $parser.TrimWhiteSpace = $true
    if (($parser.ReadFields() -join ',') -cne 'Start Time,End Time,Process,DataPtr,Process Name ( PID),ParentPID,SessionID,UniqueKey,Command Line' -or
        ($parser.ReadFields() -join ',') -cne 'Start Time,End Time,Thread,DataPtr,Process Name ( PID),ThreadID,StackBase,StackLimit,UsrStkBase,UsrStkLmt,TebBase,StartAddr') {
      throw 'INSPECTOR_TRACE_TABLE_INVALID'
    }
    $owner = $null
    $count = 0
    while (!$parser.EndOfData) {
      if (++$count -gt 100000) { Stop-InspectorTraceTableLimit 'rows' }
      $fields = $parser.ReadFields()
      if ($fields.Count -lt 8 -or $fields[4] -notmatch '^(.+) \(\s*([0-9]{1,10})\)$') { throw 'INSPECTOR_TRACE_TABLE_INVALID' }
      $name = $Matches[1]; $identifier = $Matches[2]
      $label = "$name ($identifier)"
      $times = @(for ($index = 0; $index -lt 2; $index++) {
        if ($index -eq 0 -and $fields[$index] -ceq 'MIN') { [double]::NegativeInfinity }
        elseif ($index -eq 1 -and $fields[$index] -ceq 'MAX') { [double]::PositiveInfinity }
        elseif ($fields[$index] -cmatch '^[0-9]{1,16}$') { [double]$fields[$index] / 1000000 }
        else { throw 'INSPECTOR_TRACE_LIFETIME_INVALID' }
      })
      if ($times[0] -gt $times[1] -or $fields[5] -cnotmatch '^[0-9]{1,10}$') { throw 'INSPECTOR_TRACE_LIFETIME_INVALID' }
      if ($fields[2] -ceq 'Process' -and $fields.Count -ge 9) {
        if ($fields[7] -notmatch '^0x[0-9a-f]+$') { throw 'INSPECTOR_TRACE_LIFETIME_INVALID' }
        $owner = [pscustomobject]@{ label = $label; identifier = $identifier; name = $name;
          start = $times[0]; end = $times[1]; parent = $fields[5]; key = $fields[7];
          commandLine = $fields[8..($fields.Count - 1)] -join ',';
          threads = [Collections.Generic.List[object]]::new() }
        $processes.Add($owner)
      } elseif ($fields[2] -ceq 'Thread' -and $fields.Count -eq 12 -and $null -ne $owner -and $owner.label -ceq $label) {
        $owner.threads.Add([pscustomobject]@{ process = $label; thread = $fields[5]; start = $times[0]; end = $times[1] })
      } else { throw 'INSPECTOR_TRACE_TABLE_INVALID' }
    }
  } finally { $parser.Dispose() }

  $hostToken = '(?:"[^"\r\n]*[\\/]dotnet(?:\.exe)?"|[^\s"]*dotnet(?:\.exe)?)'
  $assembly = if ($ContractFixture) { 'Eky.WindowsProcessSupervisor.ContractFixture.dll' } else { 'Eky.WindowsProcessSupervisor.dll' }
  $entry = if ($ContractFixture) { '--mode legacyCommandEntry' } else { '--legacy-command' }
  $assemblyToken = '(?:"[^"\r\n]*[\\/]' + [regex]::Escape($assembly) + '"|[^\s"]*[\\/]' + [regex]::Escape($assembly) + ')'
  $commands = @($processes | Where-Object {
    $_.name -ieq 'dotnet.exe' -and $_.commandLine -match ('^' + $hostToken + '\s+' + $assemblyToken + '\s+' + $entry + '(?:\s|$)')
  })
  if ($commands.Count -eq 0) { throw 'INSPECTOR_TRACE_COMMAND_MISSING' }
  if ($commands.Count -ne 1) { throw 'INSPECTOR_TRACE_COMMAND_AMBIGUOUS' }
  $command = $commands[0]
  if ([double]::IsInfinity($command.start)) { throw 'INSPECTOR_TRACE_LIFETIME_INVALID' }
  $selected = [Collections.Generic.List[object]]::new()
  $command | Add-Member -NotePropertyName phase -NotePropertyValue 'command'
  $selected.Add($command)
  $budgets = Get-Content -LiteralPath (Join-Path $PSScriptRoot '../windows-process-supervisor/supervisorCommandBudgets.json') -Raw | ConvertFrom-Json
  $phases = @($budgets.legacyCommand.phases | ForEach-Object { $_[0] }) + 'publishFailure'
  $worker = if ($ContractFixture) { 'legacyCommandWorkerFixture.mjs' } else { 'legacyCommandPhase.mjs' }
  $workerToken = '(?:"[^"\r\n]*[\\/]' + [regex]::Escape($worker) + '"|[^\s"]*[\\/]' + [regex]::Escape($worker) + ')'
  foreach ($process in $processes) {
    if ($process.parent -cne $command.identifier -or $process.start -lt $command.start -or $process.start -gt $command.end) { continue }
    if ($process.name -ine 'node.exe' -or $process.commandLine -notmatch ('^(?:"[^"\r\n]*[\\/]node\.exe"|[^\s"]*node\.exe)\s+' + $workerToken + '\s+--phase-request\s+"?[^"\r\n]*[\\/]([a-zA-Z]+)[\\/]phase-input\.json"?$')) { continue }
    $phase = $Matches[1]
    if ($phase -cnotin $phases -or @($selected | Where-Object { $_.phase -ceq $phase }).Count -ne 0) { throw 'INSPECTOR_TRACE_PHASE_INVALID' }
    $process | Add-Member -NotePropertyName phase -NotePropertyValue $phase
    $selected.Add($process)
  }
  foreach ($process in $selected) {
    # A reused PID is allowed only with disjoint lifetimes. Missing lifetime
    # boundaries cannot silently bind a child or scheduling row to this command.
    if (@($processes | Where-Object {
      $_ -ne $process -and $_.identifier -ceq $process.identifier -and
      $_.start -le $process.end -and $_.end -ge $process.start
    }).Count -ne 0 -or $process.threads.Count -eq 0 -or $process.threads.Count -gt 64) { throw 'INSPECTOR_TRACE_LIFETIME_INVALID' }
    foreach ($thread in $process.threads) {
      if ($thread.start -lt $process.start -or $thread.end -gt $process.end -or $thread.thread -ceq '0' -or
          @($process.threads | Where-Object { $_ -ne $thread -and $_.thread -ceq $thread.thread -and
            $_.start -le $thread.end -and $_.end -ge $thread.start }).Count -ne 0) { throw 'INSPECTOR_TRACE_LIFETIME_INVALID' }
    }
  }
  $projection = @($selected | Sort-Object start | ForEach-Object {
    [pscustomobject]@{ phase = $_.phase; process = $_.label; start = $_.start; end = $_.end; threads = $_.threads.ToArray() }
  })
  $scheduling = @($projection | Where-Object { $_.phase -cin @('command', 'scenario') } | ForEach-Object { $_.threads })
  if ($scheduling.Count -gt 64) { throw 'INSPECTOR_TRACE_THREADS_INVALID' }
  return [pscustomobject]@{ processes = $projection; schedulingThreads = $scheduling }
}

function Get-LegacyCommandTraceSummary([object]$Projection, [object[]]$Switches, [switch]$LifetimeOnly) {
  foreach ($process in $Projection.processes) {
    $scheduling = 'notProjected'
    if (!$LifetimeOnly -and $process.phase -cin @('command', 'scenario')) {
      $scheduling = 'notObserved'
      foreach ($row in $Switches) {
        if ($row.'New Process' -cne $process.process -or $row.'Switch-In Time (s)' -ceq '') { continue }
        $end = ConvertFrom-InspectorTraceSeconds $row.'Switch-In Time (s)' 'INSPECTOR_TRACE_SWITCH_INVALID'
        $start = ConvertFrom-InspectorTraceSeconds $row.'Last Switch-Out Time (s)' 'INSPECTOR_TRACE_SWITCH_INVALID'
        if ($start -gt $end) { throw 'INSPECTOR_TRACE_SWITCH_INVALID' }
        $threads = @($process.threads | Where-Object {
          $_.thread -ceq $row.'New Thread Id' -and $start -ge $_.start -and $end -le $_.end
        })
        if ($threads.Count -gt 1) { throw 'INSPECTOR_TRACE_LIFETIME_INVALID' }
        if ($threads.Count -eq 1 -and $end -gt $start) { $scheduling = 'descheduledIntervalObserved' }
      }
    }
    [ordered]@{ schemaVersion = 1; operation = 'installerProductInspectionCapture';
      phase = $(if ($LifetimeOnly) { 'commandLifetimeAnalysis' } else { 'commandAnalysis' });
      status = 'completed'; resultCode = 'diagnosticOnly'; commandPhase = $process.phase;
      processExit = $(if ([double]::IsInfinity($process.end)) { 'notObservedBeforeTraceEnd' } else { 'observedInTrace' });
      threadExit = $(if (@($process.threads | Where-Object { [double]::IsInfinity($_.end) }).Count -gt 0) { 'notAllObservedBeforeTraceEnd' } else { 'allProjectedExitsObserved' });
      schedulingObservation = $scheduling; traceCoverage = 'boundedCaptureNotFullHistory';
      cleanup = 'notInferred'; cause = 'notEstablished' }
  }
}

function ConvertFrom-InspectorTraceSeconds([string]$Value, [string]$ErrorCode) {
  # Exported seconds are ungrouped decimals. Never treat a decimal comma as a
  # thousands separator when exporter and reader cultures differ.
  $seconds = 0.0
  if ($Value -cnotmatch '^[0-9]+(?:[.,][0-9]+)?$' -or
      ![double]::TryParse($Value.Replace(',', '.'), [Globalization.NumberStyles]::AllowDecimalPoint,
        [Globalization.CultureInfo]::InvariantCulture, [ref]$seconds) -or
      [double]::IsNaN($seconds) -or [double]::IsInfinity($seconds)) { throw $ErrorCode }
  return $seconds
}

function Get-InspectorTraceEvents([object[]]$Rows) {
  $allowed = @('scriptStarted', 'requestValidated', 'requestRejected', 'comCreationStarted',
    'comCreationCompleted', 'productStateStarted', 'productStateCompleted', 'productNameStarted',
    'productNameCompleted', 'productVersionStarted', 'productVersionCompleted',
    'localPackageQueryStarted', 'localPackageQueryCompleted', 'localPackageCheckStarted',
    'localPackageCheckCompleted', 'registryInspectionStarted', 'registryInspectionCompleted',
    'processInspectionStarted', 'processInspectionCompleted', 'resultSerializeStarted',
    'resultSerializeCompleted', 'resultWriteStarted', 'resultWriteCompleted',
    'resultPublishStarted', 'resultPublishCompleted', 'inspectionFailed',
    'comReleaseStarted', 'comReleaseCompleted', 'scriptFinished')
  $events = @($Rows | Where-Object { $_.'Event Name' -ne '' })
  if ($events.Count -eq 0 -or $events.Count -gt 2048) { throw 'INSPECTOR_TRACE_EVENTS_MISSING' }
  foreach ($event in $events) {
    if ($event.'Provider Name' -cne 'Eky-InstallerProductInspection-V1') { throw 'INSPECTOR_TRACE_PROVIDER_INVALID' }
    if ($event.'Event Name' -cnotin $allowed) { throw 'INSPECTOR_TRACE_EVENT_NAME_INVALID' }
    if ($event.ThreadId -notmatch '^[1-9][0-9]{0,9}$') { throw 'INSPECTOR_TRACE_EVENT_THREAD_INVALID' }
    if ($event.Process -notmatch '^.+ \([1-9][0-9]{0,9}\)$') {
      # Classify only the representation, never return a label or identifier.
      if ([string]::IsNullOrWhiteSpace($event.Process)) { throw 'INSPECTOR_TRACE_EVENT_PROCESS_MISSING' }
      if ($event.Process -match '^[1-9][0-9]{0,9}$') { throw 'INSPECTOR_TRACE_EVENT_PROCESS_NUMERIC' }
      if ($event.Process -match '^.+\([1-9][0-9]{0,9}\)$') { throw 'INSPECTOR_TRACE_EVENT_PROCESS_COMPACT' }
      if ($event.Process -match '^.+ \([1-9][0-9]{0,2}(?:,[0-9]{3}){1,3}\)$') { throw 'INSPECTOR_TRACE_EVENT_PROCESS_GROUPED' }
      $failure = [InvalidOperationException]::new('INSPECTOR_TRACE_EVENT_PROCESS_INVALID')
      $failure.Data['processLabelShape'] = @(Get-InspectorProcessLabelShape $event.Process)
      throw $failure
    }
    $seconds = ConvertFrom-InspectorTraceSeconds $event.'Time (s)' 'INSPECTOR_TRACE_EVENT_TIME_INVALID'
    [pscustomobject]@{ phase = $event.'Event Name'; process = $event.Process; thread = $event.ThreadId; seconds = $seconds }
  }
}

function Confirm-InspectorExternalReadOnlyEvents([object[]]$Rows) {
  $events = @(Get-InspectorTraceEvents $Rows | Sort-Object seconds)
  $expected = @('scriptStarted', 'requestValidated',
    'productStateStarted', 'productStateCompleted', 'registryInspectionStarted', 'registryInspectionCompleted',
    'processInspectionStarted', 'processInspectionCompleted', 'resultSerializeStarted', 'resultSerializeCompleted',
    'resultWriteStarted', 'resultWriteCompleted', 'resultPublishStarted', 'resultPublishCompleted',
    'scriptFinished')
  if (($events.phase -join ',') -cne ($expected -join ',') -or
      @($events.process | Select-Object -Unique).Count -ne 1 -or
      @($events.thread | Select-Object -Unique).Count -ne 1) { throw 'INSPECTOR_TRACE_BOUNDARIES_INVALID' }
  # Derive the provider's platform identity after capture; no listener is added.
  $providerId = Get-InspectorTraceProviderId
  foreach ($row in $Rows) {
    $id = [guid]::Empty
    if (![guid]::TryParse($row.'Provider Id', [ref]$id) -or $id -ne $providerId) {
      throw 'INSPECTOR_TRACE_EXTERNAL_BINDING_INVALID'
    }
  }
}

function New-InspectorTraceProfile([string]$Catalog, [string]$Destination, [string[]]$Threads = @(),
  [switch]$MinimalEvents, [object[]]$Streams = @()) {
  [xml]$document = [IO.File]::ReadAllText($Catalog)
  $ns = [Xml.XmlNamespaceManager]::new($document.NameTable)
  $ns.AddNamespace('p', $document.DocumentElement.NamespaceURI)
  $cpu = $Threads.Count -gt 0
  if ($cpu -and $MinimalEvents) { throw 'INSPECTOR_CAPTURE_PROFILE_INVALID' }
  if (!$cpu -and $Streams.Count -gt 0) { throw 'INSPECTOR_TRACE_STREAMS_INVALID' }
  $guid = if ($cpu) { 'c58f5fea-0319-4046-932d-e695ebe20b47' } else { '04f69f98-176e-4d1c-b44e-97f734996ab8' }
  $graph = $document.SelectSingleNode("//p:View/p:Graphs/p:Graph[@Guid='$guid']", $ns).CloneNode($true)
  $views = $document.SelectSingleNode('//p:Content/p:Views', $ns)
  $view = $views.FirstChild
  foreach ($other in @($views.ChildNodes)) { if ($other -ne $view) { [void]$views.RemoveChild($other) } }
  $graphs = $view.SelectSingleNode('p:Graphs', $ns)
  $graphs.RemoveAll()
  [void]$graphs.AppendChild($graph)
  foreach ($reference in @($document.SelectNodes('//p:FileReference', $ns))) { [void]$reference.ParentNode.RemoveChild($reference) }
  $preset = $graph.SelectSingleNode('p:Preset', $ns)
  $preset.SetAttribute('Name', 'Inspector')
  $preset.SetAttribute('InitialFilterShouldKeep', 'true')
  $preset.RemoveAttribute('InitialSelectionQuery')
  if ($cpu) {
    if ($Threads.Count -gt 64 -or @($Threads | Where-Object { $_ -notmatch '^[1-9][0-9]{0,9}$' }).Count -ne 0) { throw 'INSPECTOR_TRACE_THREADS_INVALID' }
    $query = ($Threads | ForEach-Object { "[New Thread Id]:=$_" }) -join ' OR '
    if ($Streams.Count -gt 0) {
      if ($Streams.Count -gt 64) { throw 'INSPECTOR_TRACE_STREAMS_INVALID' }
      foreach ($stream in $Streams) {
        if ($stream.process -cnotmatch '^[a-zA-Z0-9_.-]+ \([1-9][0-9]{0,9}\)$' -or
            $stream.thread -cnotin $Threads) { throw 'INSPECTOR_TRACE_STREAMS_INVALID' }
      }
      if (@($Threads | Where-Object { $_ -cnotin @($Streams.thread) }).Count -ne 0) { throw 'INSPECTOR_TRACE_STREAMS_INVALID' }
      # Exact process + thread identity avoids exporting a recycled thread ID
      # from an unrelated process. Lifetime matching is still required on read.
      $query = ($Streams | ForEach-Object {
        '([New Process]:="' + $_.process + '" AND [New Thread Id]:=' + $_.thread + ')'
      }) -join ' OR '
    }
    $preset.SetAttribute('InitialFilterQuery', $query)
    $preset.SetAttribute('InitialExpansionQuery', $query)
    $preset.SetAttribute('KeyColumnCount', '3')
    $columns = $preset.SelectSingleNode('p:Columns', $ns)
    foreach ($name in @('Switch-In Time', 'New Thread Id', 'New Process')) {
      $column = $columns.SelectSingleNode("p:Column[@Name='$name']", $ns)
      [void]$columns.RemoveChild($column)
      [void]$columns.PrependChild($column)
    }
    $visible = @('New Process', 'New Thread Id', 'Switch-In Time', 'Last Switch-Out Time')
  } else {
    $preset.SetAttribute('InitialFilterQuery', '[Provider Name]:="Eky-InstallerProductInspection-V1"')
    $preset.SetAttribute('InitialExpansionQuery', '[Series Name]:="Process"')
    $visible = @('Provider Name', 'Task Name', 'ThreadId', 'Event Name', 'Opcode Name')
  }
  foreach ($column in $preset.SelectNodes('p:Columns/p:Column', $ns)) {
    if ($cpu) {
      $column.SetAttribute('IsVisible', $(if ($column.GetAttribute('Name') -in $visible) { 'true' } else { 'false' }))
    } elseif ($column.GetAttribute('Name') -in $visible) { $column.SetAttribute('IsVisible', 'true') }
  }
  if ($MinimalEvents) {
    # Explicit comparison view only. It is not an automatic export fallback.
    $preset.SetAttribute('Name', 'InspectorMinimal')
    foreach ($attribute in @($preset.Attributes)) {
      if ($attribute.Name -cnotin @('Name', 'InitialFilterQuery', 'InitialFilterShouldKeep')) {
        $preset.RemoveAttribute($attribute.Name)
      }
    }
    $preset.SetAttribute('KeyColumnCount', '0')
    $preset.SetAttribute('GraphColumnCount', '0')
    $kept = @{}
    foreach ($column in @($preset.SelectNodes('p:Columns/p:Column', $ns))) {
      $name = $column.GetAttribute('Name')
      if ($name -cnotin @('Provider Name', 'Provider Id', 'Process', 'ThreadId', 'Event Name', 'Time') -or $kept.ContainsKey($name)) {
        [void]$column.ParentNode.RemoveChild($column)
      } else {
        $kept[$name] = $true
        $column.SetAttribute('IsVisible', 'true')
        $column.RemoveAttribute('SortPriority')
      }
    }
    if ($kept.Count -ne 6) { throw 'INSPECTOR_CAPTURE_PROFILE_INVALID' }
    foreach ($modified in @($document.SelectNodes('//p:ModifiedGraphs', $ns))) {
      [void]$modified.ParentNode.RemoveChild($modified)
    }
  }
  $document.Save($Destination)
}

function Get-InspectorTraceSummary([object[]]$Events, [object[]]$Switches) {
  $groups = @($Events | Group-Object -Property process, thread)
  if ($groups.Count -eq 0 -or $groups.Count -gt 64) { throw 'INSPECTOR_TRACE_STREAMS_INVALID' }
  $summaries = @()
  foreach ($group in $groups) {
    $ordered = @($group.Group | Sort-Object seconds)
    $last = $ordered[-1]
    $matched = @($Switches | Where-Object {
      $_.'New Process' -ceq $last.process -and $_.'New Thread Id' -ceq $last.thread -and $_.'Switch-In Time (s)' -ne ''
    })
    $wait = 'notObserved'
    foreach ($row in $matched) {
      $start = ConvertFrom-InspectorTraceSeconds $row.'Last Switch-Out Time (s)' 'INSPECTOR_TRACE_SWITCH_INVALID'
      $end = ConvertFrom-InspectorTraceSeconds $row.'Switch-In Time (s)' 'INSPECTOR_TRACE_SWITCH_INVALID'
      if ($start -gt $end) { throw 'INSPECTOR_TRACE_SWITCH_INVALID' }
      # Only classify a wait spanning the final uncompleted boundary. No names,
      # stacks, IDs or elapsed timings cross this publication boundary.
      if ($start -ge $last.seconds -and $end -gt $start -and $last.phase -cne 'scriptFinished') {
        $wait = 'switchIntervalAfterLastEvent'
      }
    }
    $summaries += [ordered]@{
      schemaVersion = 1; operation = 'installerProductInspectionCapture'; phase = 'analysis';
      status = 'completed'; resultCode = 'diagnosticOnly';
      firstBoundary = $ordered[0].phase; lastBoundary = $last.phase;
      scriptFinishedObserved = $last.phase -ceq 'scriptFinished';
      schedulingObservation = $wait;
      traceCoverage = 'boundedCaptureNotFullHistory';
      processExit = 'notInferred'; cause = 'notEstablished';
    }
  }
  return $summaries
}
