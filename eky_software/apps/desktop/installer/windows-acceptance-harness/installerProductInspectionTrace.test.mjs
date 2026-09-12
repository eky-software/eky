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

for (const kind of ['completed', 'interrupted', 'invalid']) test(
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
        } catch { $results += @{ status = 'rejected'; errorCode = Resolve-InspectorTraceErrorCode $_.Exception.Message } }
      }
      if ((Resolve-InspectorTraceErrorCode 'PRIVATE-PATH-OR-STACK') -cne 'INSPECTOR_CAPTURE_UNEXPECTED_FAILURE' -or
          (Resolve-InspectorTraceErrorCode 'INSPECTOR_TRACE_TABLE_LIMIT') -cne 'INSPECTOR_TRACE_TABLE_LIMIT') { throw 'errorClassificationFailed' }
      [IO.File]::WriteAllText($env:EKY_TRACE_TEST_RESULT, (ConvertTo-Json -InputObject $results -Depth 8 -Compress))
    `;
    const child = spawn(resolve(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'),
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(command, 'utf16le').toString('base64')],
      { stdio: 'ignore', windowsHide: true, env: { ...process.env,
        EKY_TRACE_TEST_ROOT: context.testRoot, EKY_TRACE_TEST_SCRIPT: SCRIPT,
        EKY_TRACE_TEST_CASES: String(cases.length), EKY_TRACE_TEST_RESULT: context.resultPath,
        EKY_TRACE_TEST_PROFILE: String(kind === 'completed'),
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
    if (kind === 'invalid') {
      assert.deepEqual(results, ['INSPECTOR_TRACE_EVENT_NAME_INVALID', 'INSPECTOR_TRACE_PROVIDER_INVALID',
        'INSPECTOR_TRACE_EVENT_TIME_INVALID', 'INSPECTOR_TRACE_EVENT_TIME_INVALID',
        'INSPECTOR_TRACE_EVENT_THREAD_INVALID', 'INSPECTOR_TRACE_EVENT_PROCESS_INVALID',
        'INSPECTOR_TRACE_EVENTS_MISSING', 'INSPECTOR_TRACE_TABLE_INVALID']
        .map((errorCode) => ({ status: 'rejected', errorCode })));
    } else {
      assert.deepEqual(results, [{ status: 'read', summaries: [{
        schemaVersion: 1, operation: 'installerProductInspectionCapture', phase: 'analysis',
        status: 'completed', resultCode: 'diagnosticOnly', firstBoundary: 'scriptStarted',
        lastBoundary: kind === 'completed' ? 'scriptFinished' : 'comCreationStarted',
        scriptFinishedObserved: kind === 'completed',
        schedulingObservation: kind === 'completed' ? 'notObserved' : 'switchIntervalAfterLastEvent',
        traceCoverage: 'boundedRingNotFullHistory',
        processExit: 'notInferred', cause: 'notEstablished',
      }] }]);
    }
    passed = true;
  },
);
