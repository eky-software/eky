import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { cleanupRunContext, createRunContext } from '../windows-process-supervisor/tests/supervisorContractTestSupport.mjs';
import { INSPECTOR_TIMEOUT_MILLISECONDS } from './installerProductOperationRuntime.mjs';

const SCRIPT = fileURLToPath(new URL('./installerProductInspectionTrace.ps1', import.meta.url));
const PROVIDER = 'Eky-InstallerProductInspection-V1';
const EVENT_HEADERS = ['Provider Name', 'Process', 'ThreadId', 'Event Name', 'Time (s)', 'Time (s)', 'Field 1'];
const SWITCH_HEADERS = ['New Process', 'New Thread Id', 'Switch-In Time (s)', 'Last Switch-Out Time (s)', 'New Thread Stack'];
const event = (phase, time, provider = PROVIDER) => [provider, 'synthetic.exe (123)', '456', phase, time, time, 'PRIVATE-FIXTURE-DATA'];
const csv = (rows) => rows.map((row) => row.map((field) => `"${String(field).replaceAll('"', '""')}"`).join(',')).join('\r\n');

for (const kind of ['completed', 'interrupted', 'invalid', 'capture']) test(
  `external inspector trace keeps ${kind} evidence closed and separate from acceptance`,
  { skip: process.platform !== 'win32', timeout: INSPECTOR_TIMEOUT_MILLISECONDS },
  async (t) => {
    const context = await createRunContext('inspector-trace');
    let passed = false;
    t.after(() => cleanupRunContext(context, { preserveEvidence: !passed || t.signal.aborted }));
    const cases = kind === 'invalid'
      ? [
          [event('unknown-private-phase', '1')],
          [event('scriptStarted', '1', 'private-provider')],
          [event('scriptStarted', 'NaN')],
          [event('scriptStarted', 'PRIVATE-TIME')],
          [[PROVIDER, 'synthetic.exe (123)', 'PRIVATE-THREAD', 'scriptStarted', '1', '1', '']],
          [[PROVIDER, 'PRIVATE-PROCESS', '456', 'scriptStarted', '1', '1', '']],
          ...['', '123', 'synthetic.exe(123)', 'synthetic.exe (1,234)'].map((processLabel) =>
            [[PROVIDER, processLabel, '456', 'scriptStarted', '1', '1', '']]),
          [],
          [['truncated']],
        ]
      : [[event('scriptStarted', '1'), event('requestValidated', '2'),
          event(kind === 'completed' ? 'scriptFinished' : 'comCreationStarted', '3')]];
    for (const [index, events] of cases.entries()) {
      await writeFile(join(context.testRoot, `events-${index}.csv`), csv([EVENT_HEADERS, ...events]));
    }
    await writeFile(join(context.testRoot, 'switches.csv'), csv([SWITCH_HEADERS,
      ['synthetic.exe (123)', '456', '30', '3.1', 'PRIVATE-STACK'],
      ['foreign.exe (789)', '456', '90', '3.1', 'PRIVATE-FOREIGN-STACK'],
    ]));
    const command = `
      $ErrorActionPreference = 'Stop'
      [Threading.Thread]::CurrentThread.CurrentCulture = [Globalization.CultureInfo]::InvariantCulture
      . $env:EKY_TRACE_TEST_SCRIPT
      if ($env:EKY_TRACE_TEST_KIND -ceq 'capture') {
        [xml]$inputProfile = '<WindowsPerformanceRecorder><Profiles>' +
          '<SystemCollector Id="System" Name="Synthetic system"><BufferSize Value="1024"/><Buffers Value="20"/></SystemCollector>' +
          '<EventCollector Id="Events" Name="Synthetic events"><BufferSize Value="1024"/><Buffers Value="20"/><StackCaching/></EventCollector>' +
          '<SystemProvider Id="Kernel"><Keywords><Keyword Value="ProcessThread"/></Keywords></SystemProvider>' +
          '<EventProvider Id="Provider" Name="Synthetic provider"/>' +
          '<Profile Id="CPU.Verbose.File" Name="CPU" LoggingMode="File" DetailLevel="Verbose"><Collectors>' +
          '<SystemCollectorId Value="System"><SystemProviderId Value="Kernel"/></SystemCollectorId>' +
          '<EventCollectorId Value="Events"><EventProviders><EventProviderId Value="Provider"/></EventProviders></EventCollectorId>' +
          '</Collectors></Profile></Profiles></WindowsPerformanceRecorder>'
        $original = $inputProfile.OuterXml
        $bounded = New-InspectorCpuCaptureProfile $inputProfile
        $limits = @($bounded.SelectNodes('//MaximumFileSize'))
        if ($limits.Count -ne 2 -or @($limits | Where-Object {
          $_.GetAttribute('Value') -cne '1024' -or $_.GetAttribute('FileMode') -cne 'Sequential'
        }).Count -ne 0) { throw 'captureLimitsInvalid' }
        if ($limits[0].PreviousSibling.Name -cne 'Buffers' -or
            $limits[1].PreviousSibling.Name -cne 'StackCaching') { throw 'captureLimitOrderInvalid' }
        foreach ($limit in $limits) { [void]$limit.ParentNode.RemoveChild($limit) }
        if ($bounded.OuterXml -cne $original -or $inputProfile.OuterXml -cne $original) { throw 'captureProvidersChanged' }
        $mutations = @(
          { param($xml) $xml.SelectSingleNode('//Profile').SetAttribute('LoggingMode', 'Memory') },
          { param($xml) $xml.SelectSingleNode('//Profile').SetAttribute('Name', 'Unknown') },
          { param($xml) $xml.SelectSingleNode('//SystemCollector').SetAttribute('Base', 'Unknown') },
          { param($xml) $xml.SelectSingleNode('//SystemCollectorId').SetAttribute('Value', 'Unknown') },
          { param($xml) [void]$xml.SelectSingleNode('//Profiles').AppendChild($xml.SelectSingleNode('//EventCollector').CloneNode($true)) },
          { param($xml) [void]$xml.SelectSingleNode('//Collectors').AppendChild($xml.CreateElement('HeapEventCollectorId')) },
          { param($xml) [void]$xml.SelectSingleNode('//EventCollector').AppendChild($xml.CreateElement('MaximumFileSize')) }
        )
        foreach ($mutation in $mutations) {
          [xml]$invalid = $original
          & $mutation $invalid
          $rejected = $false
          try { [void](New-InspectorCpuCaptureProfile $invalid) }
          catch { $rejected = $_.Exception.Message -ceq 'INSPECTOR_CAPTURE_PROFILE_INVALID' }
          if (!$rejected) { throw 'captureProfileNotRejected' }
        }
        Confirm-InspectorCaptureSpace 6GB
        $rejected = $false
        try { Confirm-InspectorCaptureSpace (6GB - 1) }
        catch { $rejected = $_.Exception.Message -ceq 'INSPECTOR_CAPTURE_SPACE_INSUFFICIENT' }
        if (!$rejected) { throw 'captureSpaceNotRejected' }
        $header = "Logging mode : File\nActively recording collectors:\n"
        $first = "Collector Name : synthetic-system\nEvents Lost : 0\n"
        $second = "Collector Name : synthetic-events\nEvents Lost : 0\n"
        $third = "Collector Name : synthetic-inspector\nEvents Lost : 0\n"
        Confirm-InspectorCaptureCollectors ($header + $first + $second + $third)
        foreach ($invalidStatus in @('WPR is not recording', ($header + $first + $second),
          ($header + $first + $first + $third),
          (($header + $first + $second + $third).Replace('File', 'Memory')))) {
          $rejected = $false
          try { Confirm-InspectorCaptureCollectors $invalidStatus }
          catch { $rejected = $_.Exception.Message -ceq 'INSPECTOR_CAPTURE_COLLECTORS_UNVERIFIED' }
          if (!$rejected) { throw 'captureStoppedCollectorNotRejected' }
        }
        $rejected = $false
        try { Confirm-InspectorCaptureCollectors ($header + $first + $second + $third.Replace('Lost : 0', 'Lost : 1')) }
        catch { $rejected = $_.Exception.Message -ceq 'INSPECTOR_CAPTURE_EVENTS_LOST' }
        if (!$rejected) { throw 'captureLostEventsNotRejected' }
        [IO.File]::WriteAllText($env:EKY_TRACE_TEST_RESULT, '{"status":"validated"}')
        exit 0
      }
      if ($env:EKY_TRACE_TEST_PROFILE -ceq 'true') {
        $names = @('New Process', 'New Thread Id', 'Switch-In Time', 'Last Switch-Out Time', 'New Thread Stack', 'Ready Thread Stack', 'Readying Process')
        $columns = ($names | ForEach-Object { '<Column Name="' + $_ + '" IsVisible="true" />' }) -join ''
        [xml]$catalog = '<Profile xmlns="urn:fixture"><Content><Views><View><Graphs><Graph Guid="c58f5fea-0319-4046-932d-e695ebe20b47"><Preset><Columns>' + $columns + '</Columns></Preset></Graph></Graphs></View></Views></Content></Profile>'
        $catalogPath = Join-Path $env:EKY_TRACE_TEST_ROOT 'catalog.xml'
        $profilePath = Join-Path $env:EKY_TRACE_TEST_ROOT 'projection.xml'
        $catalog.Save($catalogPath)
        New-InspectorTraceProfile $catalogPath $profilePath @('456', '789')
        [xml]$profile = [IO.File]::ReadAllText($profilePath)
        $ns = [Xml.XmlNamespaceManager]::new($profile.NameTable)
        $ns.AddNamespace('p', 'urn:fixture')
        $visible = @($profile.SelectNodes('//p:Column[@IsVisible="true"]', $ns) | ForEach-Object { $_.GetAttribute('Name') })
        if (($visible -join ',') -cne 'New Process,New Thread Id,Switch-In Time,Last Switch-Out Time') { throw 'projectionContractFailed' }
      }
      $results = @()
      for ($index = 0; $index -lt [int]$env:EKY_TRACE_TEST_CASES; $index++) {
        try {
          $events = @(Get-InspectorTraceEvents @(Read-InspectorTraceTable (Join-Path $env:EKY_TRACE_TEST_ROOT "events-$index.csv")))
          $switches = @(Read-InspectorTraceTable (Join-Path $env:EKY_TRACE_TEST_ROOT 'switches.csv'))
          $results += @{ status = 'read'; summaries = @(Get-InspectorTraceSummary $events $switches) }
        } catch {
          $results += @{ status = 'rejected'; errorCode = Resolve-InspectorTraceErrorCode $_.Exception.Message;
            shape = @(Get-InspectorTraceFailureShape $_.Exception) }
        }
      }
      if ((Resolve-InspectorTraceErrorCode 'PRIVATE-PATH-OR-STACK') -cne 'INSPECTOR_CAPTURE_UNEXPECTED_FAILURE' -or
          (Resolve-InspectorTraceErrorCode 'INSPECTOR_TRACE_TABLE_LIMIT') -cne 'INSPECTOR_TRACE_TABLE_LIMIT') { throw 'errorClassificationFailed' }
      $shape = @(Get-InspectorProcessLabelShape '[123] PRIVATE.exe')
      if (($shape -join ',') -cne 'squareOpen,number,squareClose,space,text,dot,text') { throw 'shapeContractFailed' }
      if ((@(Get-InspectorProcessLabelShape ('PRIVATE/123/' * 30)) -join ',') -cne 'shapeLimit') { throw 'shapeLimitContractFailed' }
      $failure = [InvalidOperationException]::new('INSPECTOR_TRACE_EVENT_PROCESS_INVALID')
      $failure.Data['processLabelShape'] = $shape
      if ((@(Get-InspectorTraceFailureShape $failure) -join ',') -cne ($shape -join ',')) { throw 'shapeDeliveryFailed' }
      $failure.Data['processLabelShape'] = @('PRIVATE-RAW-VALUE')
      if (@(Get-InspectorTraceFailureShape $failure).Count -ne 0) { throw 'shapePrivacyFailed' }
      [IO.File]::WriteAllText($env:EKY_TRACE_TEST_RESULT, (ConvertTo-Json -InputObject $results -Depth 8 -Compress))
    `;
    const commandPath = join(context.testRoot, 'trace-contract.ps1');
    await writeFile(commandPath, command);
    const child = spawn(resolve(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'),
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', commandPath],
      { stdio: 'ignore', windowsHide: true, env: { ...process.env,
        EKY_TRACE_TEST_ROOT: context.testRoot, EKY_TRACE_TEST_SCRIPT: SCRIPT,
        EKY_TRACE_TEST_CASES: String(cases.length), EKY_TRACE_TEST_RESULT: context.resultPath,
        EKY_TRACE_TEST_PROFILE: String(kind === 'completed'),
        EKY_TRACE_TEST_KIND: kind,
      } });
    context.fixtureProcesses.add(child);
    const exit = await new Promise((resolvePromise, rejectPromise) => {
      child.once('error', rejectPromise);
      child.once('close', resolvePromise);
    });
    assert.equal(exit, 0);
    const output = await readFile(context.resultPath, 'utf8');
    assert.doesNotMatch(output, /PRIVATE|synthetic\.exe|foreign\.exe|123|456|789/);
    const results = JSON.parse(output);
    if (kind === 'capture') {
      assert.deepEqual(results, { status: 'validated' });
    } else if (kind === 'invalid') {
      assert.deepEqual(results, ['INSPECTOR_TRACE_EVENT_NAME_INVALID', 'INSPECTOR_TRACE_PROVIDER_INVALID',
        'INSPECTOR_TRACE_EVENT_TIME_INVALID', 'INSPECTOR_TRACE_EVENT_TIME_INVALID',
        'INSPECTOR_TRACE_EVENT_THREAD_INVALID', 'INSPECTOR_TRACE_EVENT_PROCESS_INVALID',
        'INSPECTOR_TRACE_EVENT_PROCESS_MISSING', 'INSPECTOR_TRACE_EVENT_PROCESS_NUMERIC',
        'INSPECTOR_TRACE_EVENT_PROCESS_COMPACT', 'INSPECTOR_TRACE_EVENT_PROCESS_GROUPED',
        'INSPECTOR_TRACE_EVENTS_MISSING', 'INSPECTOR_TRACE_TABLE_INVALID']
        .map((errorCode) => ({ status: 'rejected', errorCode,
          shape: errorCode === 'INSPECTOR_TRACE_EVENT_PROCESS_INVALID' ? ['text', 'hyphen', 'text'] : [] })));
    } else {
      assert.deepEqual(results, [{ status: 'read', summaries: [{
        schemaVersion: 1, operation: 'installerProductInspectionCapture', phase: 'analysis',
        status: 'completed', resultCode: 'diagnosticOnly', firstBoundary: 'scriptStarted',
        lastBoundary: kind === 'completed' ? 'scriptFinished' : 'comCreationStarted',
        scriptFinishedObserved: kind === 'completed',
        schedulingObservation: kind === 'completed' ? 'notObserved' : 'switchIntervalAfterLastEvent',
        traceCoverage: 'boundedCaptureNotFullHistory',
        processExit: 'notInferred', cause: 'notEstablished',
      }] }]);
    }
    passed = true;
  },
);
