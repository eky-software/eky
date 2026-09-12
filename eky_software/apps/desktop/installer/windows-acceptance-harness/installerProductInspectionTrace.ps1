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
    'INSPECTOR_TRACE_STREAMS_INVALID', 'INSPECTOR_TRACE_SWITCH_INVALID')
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

# This diagnostic reader never controls the test or infers Job membership.
function Read-InspectorTraceTable([string]$Path) {
  if ((Get-Item -LiteralPath $Path).Length -gt 32MB) { throw 'INSPECTOR_TRACE_TABLE_LIMIT' }
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
      if (++$count -gt 100000) { throw 'INSPECTOR_TRACE_TABLE_LIMIT' }
      $fields = $parser.ReadFields()
      if ($fields.Length -ne $headers.Length) { throw 'INSPECTOR_TRACE_TABLE_INVALID' }
      $row = [ordered]@{}
      for ($index = 0; $index -lt $headers.Length; $index++) { $row[$headers[$index]] = $fields[$index] }
      [pscustomobject]$row
    }
  } finally { $parser.Dispose() }
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

function New-InspectorTraceProfile([string]$Catalog, [string]$Destination, [string[]]$Threads = @()) {
  [xml]$document = [IO.File]::ReadAllText($Catalog)
  $ns = [Xml.XmlNamespaceManager]::new($document.NameTable)
  $ns.AddNamespace('p', $document.DocumentElement.NamespaceURI)
  $cpu = $Threads.Count -gt 0
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
