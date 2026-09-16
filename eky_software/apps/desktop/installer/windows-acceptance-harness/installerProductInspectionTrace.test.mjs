import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { open, readFile, writeFile } from 'node:fs/promises';
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

for (const kind of ['completed', 'interrupted', 'invalid', 'capture', 'decimal', 'toolExit', 'exportOutput', 'eventStatistics', 'externalView', 'commandLifetimes', 'workspaceLifetimes', 'commandAnalysis', 'workspaceAnalysis', 'commandExportFailure', 'commandExportFailureUnreadable']) test(
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
    if (['commandLifetimes', 'workspaceLifetimes', 'commandAnalysis', 'workspaceAnalysis'].includes(kind)) {
      const header = [
        'Start Time, End Time, Process, DataPtr, Process Name ( PID), ParentPID, SessionID, UniqueKey, Command Line',
        'Start Time, End Time, Thread, DataPtr, Process Name ( PID), ThreadID, StackBase, StackLimit, UsrStkBase, UsrStkLmt, TebBase, StartAddr',
      ];
      const root = '1000000, 9000000, Process, 0x1, dotnet.exe ( 123), 10, 1, 0x123, "X:\\private, source\\dotnet.exe" "X:\\private, source\\Eky.WindowsProcessSupervisor.dll" --legacy-command --artifact-descriptor PRIVATE';
      const thread = '1100000, 8900000, Thread, 0x2, dotnet.exe ( 123), 456, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0';
      const worker = '2000000, 8000000, Process, 0x3, node.exe ( 234), 123, 1, 0x234, node.exe "X:\\private, source\\legacyCommandPhase.mjs" --phase-request "X:\\private, source\\scenario\\phase-input.json"';
      const workerThread = '2100000, 7900000, Thread, 0x4, node.exe ( 234), 567, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0';
      const fixtures = {
        completed: [root, thread, worker, workerThread],
        clipped: [root.replace('9000000', 'MAX'), thread.replace('8900000', 'MAX'), worker.replace('8000000', 'MAX'), workerThread.replace('7900000', 'MAX')],
        missing: [root.replace('--legacy-command', '--workspace-success-command'), thread],
        ambiguous: [root, thread, root.replace('0x123', '0x124'), thread],
        invalidThread: [root, thread.replace('1100000', '900000')],
        invalidPhase: [root, thread, worker.replace('scenario\\phase-input', 'PRIVATE\\phase-input'), workerThread],
        truncated: [root, thread.split(',').slice(0, 6).join(',')],
        reused: [root, thread, root.replace('1000000', '10000000').replace('9000000', '19000000').replace('--legacy-command', '--unrelated').replace('0x123', '0x124'),
          thread.replace('1100000', '10100000').replace('8900000', '18900000')],
        overlapping: [root, thread, root.replace('--legacy-command', '--unrelated').replace('0x123', '0x124'), thread],
        fixture: [root.replace('Eky.WindowsProcessSupervisor.dll', 'Eky.WindowsProcessSupervisor.ContractFixture.dll').replace('--legacy-command', '--mode legacyCommandEntry'), thread],
      };
      if (['workspaceLifetimes', 'workspaceAnalysis'].includes(kind)) {
        const workspaceRoot = root.replace('--legacy-command', '--workspace-fault-command') + ' --fault-scenario acceptanceInterruption --result-path PRIVATE';
        const workspaceWorker = worker.replace('legacyCommandPhase', 'workspaceCommandPhase');
        const probe = '3000000, 3500000, Process, 0x5, powershell.exe ( 345), 234, 1, 0x345, powershell.exe -File "X:\\private\\inspectWorkspaceSuccessMsiActivity.ps1" -ResultPath PRIVATE';
        const probeThread = '3100000, 3400000, Thread, 0x6, powershell.exe ( 345), 678, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0';
        const inspector = '4000000, 7500000, Process, 0x7, dotnet.exe ( 456), 234, 1, 0x456, dotnet.exe "X:\\private\\Eky.NativeMsiTestAdapter.dll" --inspect-product --product-code PRIVATE --result-path PRIVATE';
        const inspectorThread = '4100000, 7400000, Thread, 0x8, dotnet.exe ( 456), 789, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0';
        const msi = '3200000, 6000000, Process, 0x9, msiexec.exe ( 567), 999, 1, 0x567, msiexec.exe /i PRIVATE';
        const msiThread = '3300000, 5900000, Thread, 0x10, msiexec.exe ( 567), 890, 0x0, 0x0, 0x0, 0x0, 0x0, 0x0';
        const base = [workspaceRoot, thread, workspaceWorker, workerThread];
        Object.assign(fixtures, {
          workspace: [...base, probe, probeThread, inspector, inspectorThread, msi, msiThread],
          workspaceClipped: [...base, inspector.replace('7500000', 'MAX'), inspectorThread.replace('7400000', 'MAX')],
          workspaceForeign: [...base, probe, probeThread, inspector.replace('234, 1,', '999, 1,'), inspectorThread, msi.replace('999, 1,', '999, 2,'), msiThread],
          workspaceWrongFault: [workspaceRoot.replace('acceptanceInterruption', 'binaryRollbackFailure'), thread, workspaceWorker, workerThread],
          workspaceMissingScenario: [workspaceRoot, thread],
          workspaceOverlap: [...base, inspector, inspectorThread, inspector.replace('0x456', '0x457'), inspectorThread],
        });
      }
      for (const [name, rows] of Object.entries(fixtures)) await writeFile(join(context.testRoot, `command-${name}.txt`), [...header, ...rows].join('\r\n'));
    }
    if (kind === 'toolExit') await writeFile(join(context.testRoot, 'capture tool.mjs'),
      "if (process.argv[2] !== 'value with spaces' || process.argv[3] !== '') process.exit(8);\n" +
      "process.stdout.write('known output'); process.stderr.write('known error');\n");
    const commandExportFailure = kind.startsWith('commandExportFailure');
    if (commandExportFailure) await writeFile(join(context.testRoot, 'failed-export.mjs'),
      "process.stdout.write('PRIVATE-PROCESS-DATA'); process.stderr.write('PRIVATE-PATH time inversions'); process.exitCode = 23;\n");
    const command = `
      $ErrorActionPreference = 'Stop'
      [Threading.Thread]::CurrentThread.CurrentCulture = [Globalization.CultureInfo]::InvariantCulture
      . $env:EKY_TRACE_TEST_SCRIPT
      if ($env:EKY_TRACE_TEST_KIND -ceq 'eventStatistics') {
        # Resolve this shell's built-in module, independently of the parent shell.
        Import-Module (Join-Path $PSHOME 'Modules/Microsoft.PowerShell.Utility/Microsoft.PowerShell.Utility.psd1') -ErrorAction Stop
        $provider = [Diagnostics.Tracing.EventSource]::new('${PROVIDER}')
        $identity = $provider.Guid.ToString(); $provider.Dispose()
        $header = "TraceLogging ProviderId TotalCount TotalSize Name\n10 42 <All>"
        $foreign = '{00000000-0000-0000-0000-000000000000} 7 42 PRIVATE-PROVIDER'
        $target = '{' + $identity + '} 3 0 ${PROVIDER}'
        $statisticsPath = Join-Path $env:EKY_TRACE_TEST_ROOT 'statistics.txt'
        [IO.File]::WriteAllText($statisticsPath, "$header\n$foreign\n$target\n")
        $read = Read-InspectorTraceStatistics $statisticsPath
        if (!$read.providerPresent -or $read.eventCount -ne 3 -or $read.Count -ne 2) { throw 'statisticsProviderMissing' }
        if (($read | ConvertTo-Json) -match 'PRIVATE|${PROVIDER}|00000000') { throw 'statisticsLeaked' }
        [IO.File]::WriteAllText($statisticsPath, "$header\n$foreign\n")
        $read = Read-InspectorTraceStatistics $statisticsPath
        if ($read.providerPresent -or $read.eventCount -ne 0) { throw 'statisticsPresenceGuessed' }
        foreach ($invalid in @(
          'PRIVATE-UNKNOWN-OUTPUT', 'TraceLogging ProviderId TotalCount TotalSize Name', "$header\n$target\n$target",
          ("$header\n" + $target.Replace($identity, '00000000-0000-0000-0000-000000000000')),
          ("$header\n" + $target.Replace(' 3 0 ', ' invalid 0 ')), ("$header\n" + $target.Replace('${PROVIDER}', 'PRIVATE-WRONG-NAME')),
          ("$header\n" + $target.Replace(' 3 0 ', ' 9999999999999999 0 '))
        )) {
          [IO.File]::WriteAllText($statisticsPath, $invalid)
          $rejected = $false
          try { [void](Read-InspectorTraceStatistics $statisticsPath) }
          catch { $rejected = $_.Exception.Message -ceq 'INSPECTOR_TRACE_STATISTICS_INVALID' }
          if (!$rejected) { throw 'invalidStatisticsAccepted' }
        }
        [IO.File]::WriteAllText($statisticsPath, ('X' * (1MB + 1)))
        $rejected = $false
        try { [void](Read-InspectorTraceStatistics $statisticsPath) }
        catch { $rejected = $_.Exception.Message -ceq 'INSPECTOR_TRACE_TABLE_LIMIT' -and $_.Exception.Data['tableLimitKind'] -ceq 'bytes' }
        if (!$rejected) { throw 'statisticsReadUnbounded' }
        $tokens = $null; $errors = $null
        $ast = [Management.Automation.Language.Parser]::ParseFile(
          (Join-Path (Split-Path $env:EKY_TRACE_TEST_SCRIPT -Parent) 'captureInstallerProductInspection.ps1'), [ref]$tokens, [ref]$errors)
        $observation = $ast.Find({ param($node)
          $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq 'Get-CaptureTraceStatistics'
        }, $false)
        if ($errors.Count -ne 0 -or $null -eq $observation) { throw 'statisticsObservationMissing' }
        . ([scriptblock]::Create($observation.Extent.Text))
        $root = $env:EKY_TRACE_TEST_ROOT; $xperf = $env:EKY_TRACE_TEST_NODE
        function Invoke-CaptureTool([string]$Tool, [string[]]$Arguments, [string]$Label) {
          if ($Label -cin @('comparison-current', 'comparison-minimal')) {
            throw 'INSPECTOR_CAPTURE_TOOL_FAILED'
          }
          if ($Tool -cne $xperf -or $Label -cne 'event-statistics' -or $Arguments.Count -ne 5 -or
              $Arguments[0] -cne '-i' -or $Arguments[2] -cne '-a' -or $Arguments[3] -cne 'tracestats' -or
              $Arguments[4] -cne '-detail') { throw 'unexpectedStatisticsInvocation' }
          if ($statisticsCase -ceq 'toolFailure') {
            [IO.File]::WriteAllText((Join-Path $root 'event-statistics.private.log'), 'PRIVATE-TRACE')
            [IO.File]::WriteAllText((Join-Path $root 'event-statistics.stderr.private.log'), 'The file or directory is corrupted and unreadable.')
            $failure = [InvalidOperationException]::new('INSPECTOR_CAPTURE_TOOL_FAILED')
            $failure.Data['toolExitCode'] = 23
            throw $failure
          }
          if ($statisticsCase -cne 'missingOutput') {
            [IO.File]::WriteAllText((Join-Path $root 'event-statistics.private.log'), "$header\n$target\n")
            [IO.File]::WriteAllText((Join-Path $root 'event-statistics.stderr.private.log'), '')
          }
        }
        foreach ($statisticsCase in @('missingOutput', 'toolFailure', 'completed')) {
          $report = Get-CaptureTraceStatistics (Join-Path $root 'capture.etl')
          if ($report.phase -cne 'eventStatistics' -or $report.schemaVersion -ne 1) { throw 'statisticsReportInvalid' }
          if ($statisticsCase -ceq 'completed') {
            if ($report.status -cne 'completed' -or $report.resultCode -cne 'diagnosticOnly' -or
                !$report.providerPresent -or $report.eventCount -ne 3) { throw 'statisticsSuccessInvalid' }
            if ($report.toolOutput.logRead -cne 'completed' -or $report.toolOutput.signals.fileCorruptionMessage) {
              throw 'statisticsSuccessOutputInvalid'
            }
          } else {
            if ($report.status -cne 'failed' -or $report.resultCode -cne 'diagnosticUnverified' -or
                $null -ne $report.providerPresent -or $null -ne $report.eventCount) { throw 'statisticsFailureEscaped' }
            if ($statisticsCase -ceq 'toolFailure' -and $report.toolExitCode -ne 23) { throw 'statisticsExitLost' }
            if ($statisticsCase -ceq 'toolFailure' -and
                !$report.toolOutput.signals.fileCorruptionMessage) { throw 'statisticsToolMessageLost' }
            if ($statisticsCase -ceq 'missingOutput' -and
                $report.toolOutput.logRead -cne 'unavailable') { throw 'statisticsMissingOutputGuessed' }
          }
          if (($report | ConvertTo-Json) -match 'PRIVATE|capture.etl|tracestats') { throw 'statisticsReportLeaked' }
        }
        $branch = $ast.Find({ param($node)
          $node -is [Management.Automation.Language.IfStatementAst] -and
            @($node.Clauses | Where-Object { $_.Item1.Extent.Text -ceq "$" + "Mode -ceq 'compareEvents'" }).Count -eq 1
        }, $true)
        if ($null -eq $branch) { throw 'statisticsComparisonMissing' }
        $clause = @($branch.Clauses | Where-Object { $_.Item1.Extent.Text -ceq "$" + "Mode -ceq 'compareEvents'" })[0]
        $comparison = [scriptblock]::Create(($clause.Item2.Statements.Extent.Text -join "\n"))
        [IO.File]::WriteAllText((Join-Path $root 'stopped'), '')
        [IO.File]::WriteAllText((Join-Path $root 'capture.etl'), 'synthetic trace')
        function New-InspectorTraceProfile { }
        $exporter = $xperf; $catalog = ''; $statisticsCase = 'toolFailure'
        $observations = [Collections.Generic.List[object]]::new(); $rejected = $false
        try { . $comparison | ForEach-Object { $observations.Add(($_ | ConvertFrom-Json)) } }
        catch {
          if ($_.Exception.Message -cne 'INSPECTOR_TRACE_COMPARISON_FAILED') { throw }
          $rejected = $true
        }
        if (!$rejected -or $observations.Count -ne 4 -or $observations[0].phase -cne 'eventStatistics' -or
            $observations[0].status -cne 'failed' -or $observations[3].resultCode -cne 'sameTraceBytes' -or
            @($observations | Where-Object { $_.phase -ceq 'eventViewComparison' -and
              $_.errorCode -ceq 'INSPECTOR_CAPTURE_TOOL_FAILED' }).Count -ne 2) { throw 'statisticsMaskedExportFailure' }
        [IO.File]::WriteAllText($env:EKY_TRACE_TEST_RESULT, '{"status":"validated"}')
        exit 0
      }
      if ($env:EKY_TRACE_TEST_KIND -cin @('commandExportFailure', 'commandExportFailureUnreadable')) {
        $tokens = $null; $errors = $null
        $ast = [Management.Automation.Language.Parser]::ParseFile(
          (Join-Path (Split-Path $env:EKY_TRACE_TEST_SCRIPT -Parent) 'captureInstallerProductInspection.ps1'), [ref]$tokens, [ref]$errors)
        $invocation = $ast.Find({ param($node)
          $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq 'Invoke-CaptureTool'
        }, $false)
        $outerTry = @($ast.EndBlock.Statements | Where-Object { $_ -is [Management.Automation.Language.TryStatementAst] })
        if ($errors.Count -ne 0 -or $null -eq $invocation -or $outerTry.Count -ne 1) { throw 'captureBoundaryMissing' }
        . ([scriptblock]::Create($invocation.Extent.Text))
        $handler = [scriptblock]::Create(($outerTry[0].CatchClauses[0].Body.Statements.Extent.Text -join "\n"))
        $root = $env:EKY_TRACE_TEST_ROOT; $readerLoaded = $true; $boundary = 'commandExport'; $Mode = 'analyze'
        try {
          Invoke-CaptureTool $env:EKY_TRACE_TEST_NODE @((Join-Path $root 'failed-export.mjs')) 'command-export'
        } catch {
          if ($env:EKY_TRACE_TEST_KIND -ceq 'commandExportFailureUnreadable') {
            Remove-Item -LiteralPath (Join-Path $root 'command-export.stderr.private.log')
          }
          . $handler
        }
        throw 'expectedExportFailureMissing'
      }
      if ($env:EKY_TRACE_TEST_KIND -cin @('commandAnalysis', 'workspaceAnalysis')) {
        $tokens = $null; $errors = $null
        $ast = [Management.Automation.Language.Parser]::ParseFile(
          (Join-Path (Split-Path $env:EKY_TRACE_TEST_SCRIPT -Parent) 'captureInstallerProductInspection.ps1'), [ref]$tokens, [ref]$errors)
        $branch = $ast.Find({ param($node)
          $node -is [Management.Automation.Language.IfStatementAst] -and $null -ne $node.ElseClause -and
            $node.ElseClause.Extent.Text.Contains('$commandProjection = $null')
        }, $true)
        if ($errors.Count -ne 0 -or $null -eq $branch) { throw 'analysisBranchMissing' }
        $statisticsFunction = $ast.Find({ param($node)
          $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq 'Get-CaptureTraceStatistics'
        }, $false)
        if ($null -eq $statisticsFunction) { throw 'statisticsObservationMissing' }
        . ([scriptblock]::Create($statisticsFunction.Extent.Text))
        $analysis = [scriptblock]::Create(($branch.ElseClause.Statements.Extent.Text -join "\n"))
        $root = $env:EKY_TRACE_TEST_ROOT; $xperf = $env:EKY_TRACE_TEST_NODE
        $exporter = $xperf; $catalog = ''; $WorkspaceFaultCommand = $env:EKY_TRACE_TEST_KIND -ceq 'workspaceAnalysis'
        $LegacyCommand = !$WorkspaceFaultCommand; $boundary = 'stopVerification'
        [IO.File]::WriteAllText((Join-Path $root 'stopped'), '')
        function Invoke-CaptureTool([string]$Tool, [string[]]$Arguments, [string]$Label) {
          if ($Label -ceq 'event-statistics') { throw 'INSPECTOR_CAPTURE_TOOL_FAILED' }
          elseif ($Label -ceq 'command-export') {
            $inputName = if ($WorkspaceFaultCommand) { 'command-workspace.txt' } else { 'command-completed.txt' }
            Copy-Item -LiteralPath (Join-Path $root $inputName) -Destination (Join-Path $root 'command-export.private.log')
          } elseif ($Label -ceq 'events-export') {
            if ($analysisCase -ceq 'eventExport') { throw 'INSPECTOR_CAPTURE_TOOL_FAILED' }
            Copy-Item -LiteralPath (Join-Path $root 'events-0.csv') -Destination (Join-Path $root 'Generic_Events_Inspector.csv')
          }
          elseif ($Label -ceq 'threads-export') {
            $path = Join-Path $root 'CPU_Usage_(Precise)_Inspector.csv'
            if ($analysisCase -ceq 'bytes') {
              $file = [IO.File]::Create($path)
              try { $file.SetLength(32MB + 1) } finally { $file.Dispose() }
            } elseif ($analysisCase -ceq 'rows') {
              [IO.File]::WriteAllText($path, "Header\n" + ("value\n" * 100001))
            } else { Copy-Item -LiteralPath (Join-Path $root 'switches.csv') -Destination $path }
          } else { throw 'unexpectedAnalysisTool' }
        }
        function New-InspectorTraceProfile([string]$Catalog, [string]$Destination, [string[]]$Threads, [object[]]$Streams) {
          if (($Threads -join ',') -cne '456,567' -or
              @($Streams | Where-Object { $_.process -ceq 'dotnet.exe (123)' -and $_.thread -ceq '456' }).Count -ne 1 -or
              @($Streams | Where-Object { $_.process -ceq 'node.exe (234)' -and $_.thread -ceq '567' }).Count -ne 1) {
            throw 'commandThreadsNotProjected'
          }
        }
        foreach ($analysisCase in @('eventExport', 'bytes', 'rows')) {
          $observations = [Collections.Generic.List[object]]::new()
          $rejected = $false
          try { . $analysis | ForEach-Object { $observations.Add(($_ | ConvertFrom-Json)) } }
          catch {
            $rejected = if ($analysisCase -ceq 'eventExport') { $_.Exception.Message -ceq 'INSPECTOR_CAPTURE_TOOL_FAILED' }
              else { $_.Exception.Message -ceq 'INSPECTOR_TRACE_TABLE_LIMIT' -and $_.Exception.Data['tableLimitKind'] -ceq $analysisCase }
          }
          $expectedCount = $(if ($analysisCase -ceq 'eventExport') { 5 } else { 3 }) + $(if ($WorkspaceFaultCommand) { 3 } else { 0 })
          $expectedBoundary = if ($analysisCase -ceq 'eventExport') { 'eventExport' } else { 'schedulingRead' }
          if (!$rejected -or $boundary -cne $expectedBoundary -or $observations.Count -ne $expectedCount -or
              $observations[0].phase -cne 'eventStatistics' -or $observations[0].status -cne 'failed' -or
              @($observations | Where-Object { $_.phase -cne 'eventStatistics' -and $_.cleanup -cne 'notInferred' }).Count -ne 0 -or
              @($observations | Where-Object { $_.phase -ceq 'commandLifetimeAnalysis' -and
                $_.schedulingObservation -ceq 'notProjected' }).Count -ne 2) {
            throw 'failedSchedulingErasedCommandEvidence'
          }
          if ($WorkspaceFaultCommand -and @($observations | Where-Object {
            $_.phase -ceq 'workspaceInstallationAnalysis' -and $_.resultCode -ceq 'diagnosticOnly' -and
              $_.cause -ceq 'notEstablished' -and $_.cleanup -ceq 'notInferred'
          }).Count -ne 3) { throw 'failedExportErasedWorkspaceEvidence' }
        }
        [IO.File]::WriteAllText($env:EKY_TRACE_TEST_RESULT, '{"status":"validated"}')
        exit 0
      }
      if ($env:EKY_TRACE_TEST_KIND -ceq 'workspaceLifetimes') {
        $projection = Read-LegacyCommandTrace (Join-Path $env:EKY_TRACE_TEST_ROOT 'command-workspace.txt') -WorkspaceFaultCommand
        if (($projection.processes.phase -join ',') -cne 'command,scenario' -or
            $projection.installationProcesses.Count -ne 3) { throw 'workspaceSelectionInvalid' }
        $events = @([pscustomobject]@{ phase = 'scriptStarted'; process = 'dotnet.exe (456)'; thread = '789'; seconds = 4.2 },
          [pscustomobject]@{ phase = 'productStateStarted'; process = 'dotnet.exe (456)'; thread = '789'; seconds = 4.3 })
        $summaries = @(Get-WorkspaceInstallationTraceSummary $projection $events)
        if (($summaries.component -join ',') -cne 'msiActivityProbe,sessionMsiClient,productInspector' -or
            $summaries[2].lastInspectorBoundary -cne 'productStateStarted' -or
            $summaries[2].inspectorFinishedObserved -or $summaries[1].lastInspectorBoundary -cne 'notObserved' -or
            @($summaries | Where-Object { $_.cleanup -cne 'notInferred' -or $_.cause -cne 'notEstablished' -or
              $_.processExit -cne 'observedInTrace' -or ! $_.endedBeforeScenarioExit }).Count -ne 0) { throw 'workspaceWaitGuessed' }
        if (($summaries | ConvertTo-Json) -match 'PRIVATE|dotnet.exe|powershell.exe|msiexec.exe|456|789') { throw 'workspaceTraceLeaked' }
        $keys = @('schemaVersion', 'operation', 'phase', 'status', 'resultCode', 'observationOrder', 'component',
          'processExit', 'endedBeforeScenarioExit', 'firstInspectorBoundary', 'lastInspectorBoundary',
          'inspectorFinishedObserved', 'cleanup', 'cause')
        foreach ($summary in $summaries) {
          if (($summary.Keys -join ',') -cne ($keys -join ',')) { throw 'workspaceFieldsOpen' }
        }
        $events[1].thread = '999'
        $rejected = $false
        try { [void]@(Get-WorkspaceInstallationTraceSummary $projection $events) }
        catch { $rejected = $_.Exception.Message -ceq 'INSPECTOR_TRACE_EXTERNAL_BINDING_INVALID' }
        if (!$rejected) { throw 'workspaceThreadMisbound' }
        $events[1].thread = '789'
        $projection = Read-LegacyCommandTrace (Join-Path $env:EKY_TRACE_TEST_ROOT 'command-workspaceClipped.txt') -WorkspaceFaultCommand
        $summaries = @(Get-WorkspaceInstallationTraceSummary $projection $events)
        if ($summaries[0].processExit -cne 'notObservedBeforeTraceEnd' -or $summaries[0].endedBeforeScenarioExit) { throw 'workspaceClippedExitGuessed' }
        $projection = Read-LegacyCommandTrace (Join-Path $env:EKY_TRACE_TEST_ROOT 'command-workspaceForeign.txt') -WorkspaceFaultCommand
        if ($projection.installationProcesses.Count -ne 1 -or $projection.installationProcesses[0].phase -cne 'msiActivityProbe') { throw 'workspaceForeignProcessBound' }
        foreach ($case in @(@('workspaceWrongFault', 'INSPECTOR_TRACE_PHASE_INVALID'),
          @('workspaceMissingScenario', 'INSPECTOR_TRACE_PHASE_INVALID'),
          @('workspaceOverlap', 'INSPECTOR_TRACE_LIFETIME_INVALID'), @('completed', 'INSPECTOR_TRACE_COMMAND_MISSING'))) {
          $rejected = $false
          try { [void](Read-LegacyCommandTrace (Join-Path $env:EKY_TRACE_TEST_ROOT ('command-' + $case[0] + '.txt')) -WorkspaceFaultCommand) }
          catch { $rejected = $_.Exception.Message -ceq $case[1] }
          if (!$rejected) { throw 'workspaceInvalidBindingAccepted' }
        }
        $rejected = $false
        try { [void](Read-LegacyCommandTrace (Join-Path $env:EKY_TRACE_TEST_ROOT 'command-workspace.txt')) }
        catch { $rejected = $_.Exception.Message -ceq 'INSPECTOR_TRACE_COMMAND_MISSING' }
        if (!$rejected) { throw 'workspaceImplicitlyEnabled' }
        [IO.File]::WriteAllText($env:EKY_TRACE_TEST_RESULT, '{"status":"validated"}')
        exit 0
      }
      if ($env:EKY_TRACE_TEST_KIND -ceq 'commandLifetimes') {
        $projection = Read-LegacyCommandTrace (Join-Path $env:EKY_TRACE_TEST_ROOT 'command-completed.txt')
        if ($projection.processes.Count -ne 2 -or $projection.schedulingThreads.Count -ne 2 -or
            ($projection.processes.phase -join ',') -cne 'command,scenario') { throw 'commandSelectionInvalid' }
        $switches = @([pscustomobject]@{ 'New Process' = 'dotnet.exe (123)'; 'New Thread Id' = '456';
          'Switch-In Time (s)' = '5'; 'Last Switch-Out Time (s)' = '2' })
        $summaries = @(Get-LegacyCommandTraceSummary $projection $switches)
        if ($summaries[0].schedulingObservation -cne 'descheduledIntervalObserved' -or
            $summaries[1].schedulingObservation -cne 'notObserved' -or
            @($summaries | Where-Object { $_.processExit -cne 'observedInTrace' -or
              $_.threadExit -cne 'allProjectedExitsObserved' -or $_.cleanup -cne 'notInferred' -or
              $_.cause -cne 'notEstablished' }).Count -ne 0) { throw 'commandSummaryInvalid' }
        if (($summaries | ConvertTo-Json) -match 'PRIVATE|source|123|234|456|567|dotnet.exe|node.exe') { throw 'commandSummaryLeaked' }
        $projection = Read-LegacyCommandTrace (Join-Path $env:EKY_TRACE_TEST_ROOT 'command-clipped.txt')
        $summaries = @(Get-LegacyCommandTraceSummary $projection $switches)
        if (@($summaries | Where-Object { $_.processExit -cne 'notObservedBeforeTraceEnd' -or
            $_.threadExit -cne 'notAllObservedBeforeTraceEnd' }).Count -ne 0) { throw 'clippedExitGuessed' }
        $projection = Read-LegacyCommandTrace (Join-Path $env:EKY_TRACE_TEST_ROOT 'command-reused.txt')
        $switches[0].'Switch-In Time (s)' = '15'; $switches[0].'Last Switch-Out Time (s)' = '12'
        $summaries = @(Get-LegacyCommandTraceSummary $projection $switches)
        if ($projection.processes.Count -ne 1 -or $summaries[0].schedulingObservation -cne 'notObserved') { throw 'reusedIdentifierMisbound' }
        foreach ($case in @(
          @('missing', 'INSPECTOR_TRACE_COMMAND_MISSING'), @('ambiguous', 'INSPECTOR_TRACE_COMMAND_AMBIGUOUS'),
          @('invalidThread', 'INSPECTOR_TRACE_LIFETIME_INVALID'), @('invalidPhase', 'INSPECTOR_TRACE_PHASE_INVALID'),
          @('truncated', 'INSPECTOR_TRACE_TABLE_INVALID'), @('overlapping', 'INSPECTOR_TRACE_LIFETIME_INVALID'),
          @('fixture', 'INSPECTOR_TRACE_COMMAND_MISSING')
        )) {
          $rejected = $false
          try { [void](Read-LegacyCommandTrace (Join-Path $env:EKY_TRACE_TEST_ROOT ('command-' + $case[0] + '.txt'))) }
          catch { $rejected = (Resolve-InspectorTraceErrorCode $_.Exception.Message) -ceq $case[1] }
          if (!$rejected) { throw ('commandBoundaryNotRejected:' + $case[0]) }
        }
        $projection = Read-LegacyCommandTrace (Join-Path $env:EKY_TRACE_TEST_ROOT 'command-fixture.txt') -ContractFixture
        if ($projection.processes.Count -ne 1) { throw 'retainedFixtureNotSelected' }
        [IO.File]::WriteAllText($env:EKY_TRACE_TEST_RESULT, '{"status":"validated"}')
        exit 0
      }
      if ($env:EKY_TRACE_TEST_KIND -ceq 'exportOutput') {
        $stdout = Join-Path $env:EKY_TRACE_TEST_ROOT 'stdout.txt'
        $stderr = Join-Path $env:EKY_TRACE_TEST_ROOT 'stderr.txt'
        [IO.File]::WriteAllText($stdout, "Exporting Profile: PRIVATE-PATH\nExporting entire trace time range\n")
        [IO.File]::WriteAllText($stderr, 'PRIVATE-IDENTITY time inversions; lost events; No data; could not load profile; System.OutOfMemoryException; The file or directory is corrupted and unreadable.')
        $report = Get-InspectorExportLogObservation $stdout $stderr
        if ($report.logRead -cne 'completed' -or !$report.stdoutPresent -or !$report.stderrPresent -or
            @($report.signals.Values | Where-Object { $_ -ne $true }).Count -ne 0) { throw 'exportOutputSignalsInvalid' }
        if (($report | ConvertTo-Json -Depth 5) -match 'PRIVATE') { throw 'exportOutputLeaked' }
        [IO.File]::WriteAllText($stderr, 'unrecognized private output 0x80070570 ERROR_FILE_CORRUPT')
        $report = Get-InspectorExportLogObservation $stdout $stderr
        if ($report.signals.noDataMessage -ne $false -or $report.signals.memoryFailureMessage -ne $false -or
            $report.signals.fileCorruptionMessage -ne $false) { throw 'exportCauseGuessed' }
        [IO.File]::WriteAllText($stderr, ('X' * (1MB + 1)))
        $report = Get-InspectorExportLogObservation $stdout $stderr
        if ($report.logRead -cne 'unavailable' -or $null -ne $report.signals) { throw 'exportLogUnbounded' }
        $report = Get-InspectorExportLogObservation $stdout (Join-Path $env:EKY_TRACE_TEST_ROOT 'missing')
        if ($report.logRead -cne 'unavailable') { throw 'exportReadFailureEscaped' }
        [IO.File]::WriteAllText($env:EKY_TRACE_TEST_RESULT, '{"status":"validated"}')
        exit 0
      }
      if ($env:EKY_TRACE_TEST_KIND -ceq 'externalView') {
        $names = @('Provider Name', 'Provider Id', 'Process', 'ThreadId', 'Event Name', 'Time', 'Field 1', 'Time')
        $columns = ($names | ForEach-Object { '<Column Name="' + $_ + '" SortPriority="3" IsVisible="true" />' }) -join ''
        [xml]$catalog = '<Profile xmlns="urn:fixture"><Content><Views><View><Graphs><Graph Guid="04f69f98-176e-4d1c-b44e-97f734996ab8"><Preset KeyColumnCount="4" GraphColumnCount="35"><Columns>' + $columns + '</Columns></Preset></Graph></Graphs></View></Views><ModifiedGraphs><PrivateGraph/></ModifiedGraphs></Content></Profile>'
        $catalogPath = Join-Path $env:EKY_TRACE_TEST_ROOT 'catalog.xml'
        $profilePath = Join-Path $env:EKY_TRACE_TEST_ROOT 'minimal.xml'
        $catalog.Save($catalogPath)
        New-InspectorTraceProfile $catalogPath $profilePath -MinimalEvents
        [xml]$profile = [IO.File]::ReadAllText($profilePath)
        $ns = [Xml.XmlNamespaceManager]::new($profile.NameTable); $ns.AddNamespace('p', 'urn:fixture')
        $preset = $profile.SelectSingleNode('//p:Preset', $ns)
        if ($preset.GetAttribute('KeyColumnCount') -cne '0' -or
            $preset.GetAttribute('InitialFilterQuery') -cne '[Provider Name]:="${PROVIDER}"' -or
            $profile.SelectNodes('//p:ModifiedGraphs', $ns).Count -ne 0 -or
            $profile.SelectNodes('//p:Column', $ns).Count -ne 6 -or
            $profile.SelectNodes('//p:Column[@IsVisible="true"]', $ns).Count -ne 6) { throw 'minimalViewInvalid' }
        $provider = [Diagnostics.Tracing.EventSource]::new('${PROVIDER}')
        $providerId = $provider.Guid.ToString(); $provider.Dispose()
        $phases = @('scriptStarted', 'requestValidated',
          'productStateStarted', 'productStateCompleted', 'registryInspectionStarted', 'registryInspectionCompleted',
          'processInspectionStarted', 'processInspectionCompleted', 'resultSerializeStarted', 'resultSerializeCompleted',
          'resultWriteStarted', 'resultWriteCompleted', 'resultPublishStarted', 'resultPublishCompleted',
          'scriptFinished')
        $rows = @(for ($i = 0; $i -lt $phases.Count; $i++) {
          [pscustomobject]@{ 'Provider Name' = '${PROVIDER}'; 'Provider Id' = $providerId;
            Process = 'synthetic.exe (123)'; ThreadId = '456'; 'Time (s)' = [string]$i; 'Event Name' = $phases[$i] }
        })
        Confirm-InspectorExternalReadOnlyEvents $rows
        $rows[0].'Provider Id' = [guid]::Empty.ToString()
        $rejected = $false
        try { Confirm-InspectorExternalReadOnlyEvents $rows }
        catch { $rejected = $_.Exception.Message -ceq 'INSPECTOR_TRACE_EXTERNAL_BINDING_INVALID' }
        if (!$rejected) { throw 'externalProviderNotBound' }
        $rows[0].'Provider Id' = $providerId
        $rejected = $false
        try { Confirm-InspectorExternalReadOnlyEvents $rows[0..($rows.Count - 2)] }
        catch { $rejected = $_.Exception.Message -ceq 'INSPECTOR_TRACE_BOUNDARIES_INVALID' }
        if (!$rejected) { throw 'externalFinishNotRequired' }
        [IO.File]::WriteAllText($env:EKY_TRACE_TEST_RESULT, '{"status":"validated"}')
        exit 0
      }
      if ($env:EKY_TRACE_TEST_KIND -ceq 'toolExit') {
        $tokens = $null
        $errors = $null
        $captureScript = Join-Path (Split-Path $env:EKY_TRACE_TEST_SCRIPT -Parent) 'captureInstallerProductInspection.ps1'
        $ast = [Management.Automation.Language.Parser]::ParseFile($captureScript, [ref]$tokens, [ref]$errors)
        $function = $ast.Find({ param($node)
          $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq 'Invoke-CaptureTool'
        }, $false)
        if ($errors.Count -ne 0 -or $null -eq $function) { throw 'captureInvocationMissing' }
        . ([scriptblock]::Create($function.Extent.Text))
        $root = $env:EKY_TRACE_TEST_ROOT
        $rejected = $false
        try { Invoke-CaptureTool $env:EKY_TRACE_TEST_NODE @('-e', 'process.exit(7)') 'failed-tool' }
        catch {
          $rejected = $_.Exception.Message -ceq 'INSPECTOR_CAPTURE_TOOL_FAILED' -and
            $_.Exception.Data['toolExitCode'] -is [int] -and $_.Exception.Data['toolExitCode'] -eq 7
        }
        if (!$rejected) { throw 'nativeExitNotPreserved' }
        $global:LASTEXITCODE = 99
        Invoke-CaptureTool $env:EKY_TRACE_TEST_NODE @((Join-Path $root 'capture tool.mjs'), 'value with spaces', '') 'completed-tool'
        if ([IO.File]::ReadAllText((Join-Path $root 'completed-tool.private.log')) -cne 'known output' -or
            [IO.File]::ReadAllText((Join-Path $root 'completed-tool.stderr.private.log')) -cne 'known error') {
          throw 'nativeToolOutputInvalid'
        }
        foreach ($argument in @('embedded"quote', 'trailing\\', "line\nbreak")) {
          $rejected = $false
          try { Invoke-CaptureTool $env:EKY_TRACE_TEST_NODE @($argument) 'must-not-start' }
          catch { $rejected = $_.Exception.Message -ceq 'INSPECTOR_CAPTURE_ARGUMENTS_INVALID' }
          if (!$rejected -or (Test-Path -LiteralPath (Join-Path $root 'must-not-start.private.log'))) { throw 'toolArgumentNotRejected' }
        }
        [IO.File]::WriteAllText($env:EKY_TRACE_TEST_RESULT, '{"status":"validated"}')
        exit 0
      }
      if ($env:EKY_TRACE_TEST_KIND -ceq 'decimal') {
        foreach ($culture in @('en-US', 'fi-FI')) {
          [Threading.Thread]::CurrentThread.CurrentCulture = [Globalization.CultureInfo]::GetCultureInfo($culture)
          foreach ($separator in @('.', ',')) {
            $event = [pscustomobject]@{ 'Provider Name' = '${PROVIDER}'; Process = 'synthetic.exe (123)';
              ThreadId = '456'; 'Event Name' = 'comCreationStarted'; 'Time (s)' = ('3' + $separator + '125000000') }
            $events = @(Get-InspectorTraceEvents @($event))
            if ($events.Count -ne 1 -or $events[0].seconds -ne 3.125) { throw 'traceDecimalValueInvalid' }
            $switch = [pscustomobject]@{ 'New Process' = 'synthetic.exe (123)'; 'New Thread Id' = '456';
              'Switch-In Time (s)' = ('4' + $separator + '000000000');
              'Last Switch-Out Time (s)' = ('3' + $separator + '500000000') }
            $summary = @(Get-InspectorTraceSummary $events @($switch))
            if ($summary[0].schedulingObservation -cne 'switchIntervalAfterLastEvent') { throw 'traceDecimalWaitInvalid' }
            foreach ($invalid in @('1,234.5', '1.234,5', '1,234,567', 'NaN', 'Infinity', '-1', '1e999', '')) {
              $event.'Time (s)' = $invalid
              $rejected = $false
              try { [void](Get-InspectorTraceEvents @($event)) }
              catch { $rejected = $_.Exception.Message -ceq 'INSPECTOR_TRACE_EVENT_TIME_INVALID' }
              if (!$rejected) { throw 'traceEventTimeNotRejected' }
              if ($invalid -ceq '') { continue }
              $switch.'Switch-In Time (s)' = $invalid
              $rejected = $false
              try { [void](Get-InspectorTraceSummary $events @($switch)) }
              catch { $rejected = $_.Exception.Message -ceq 'INSPECTOR_TRACE_SWITCH_INVALID' }
              if (!$rejected) { throw 'traceSwitchTimeNotRejected' }
            }
          }
        }
        [IO.File]::WriteAllText($env:EKY_TRACE_TEST_RESULT, '{"status":"validated"}')
        exit 0
      }
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
        $streams = @([pscustomobject]@{ process = 'synthetic.exe (123)'; thread = '456' },
          [pscustomobject]@{ process = 'synthetic.exe (234)'; thread = '789' })
        New-InspectorTraceProfile $catalogPath $profilePath @('456', '789') -Streams $streams
        [xml]$bound = [IO.File]::ReadAllText($profilePath)
        $query = $bound.SelectSingleNode('//p:Preset', $ns).GetAttribute('InitialFilterQuery')
        if ($query -cne '([New Process]:="synthetic.exe (123)" AND [New Thread Id]:=456) OR ([New Process]:="synthetic.exe (234)" AND [New Thread Id]:=789)') {
          throw 'processThreadBindingMissing'
        }
        $streams[0].process = 'private" OR [New Thread Id]:>0'
        $rejected = $false
        try { New-InspectorTraceProfile $catalogPath $profilePath @('456', '789') -Streams $streams }
        catch { $rejected = $_.Exception.Message -ceq 'INSPECTOR_TRACE_STREAMS_INVALID' }
        if (!$rejected) { throw 'queryInputNotRejected' }
        $rejected = $false
        try { New-InspectorTraceProfile $catalogPath $profilePath @('456', '789') -Streams @($streams[1]) }
        catch { $rejected = $_.Exception.Message -ceq 'INSPECTOR_TRACE_STREAMS_INVALID' }
        if (!$rejected) { throw 'projectionSilentlyDroppedThread' }
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
    const errorLog = await open(join(context.testRoot, 'stderr.private.log'), 'wx+');
    const child = spawn(resolve(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'),
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', commandPath],
      { stdio: ['ignore', commandExportFailure ? 'pipe' : 'ignore', errorLog.fd], windowsHide: true, env: { ...process.env,
        EKY_TRACE_TEST_ROOT: context.testRoot, EKY_TRACE_TEST_SCRIPT: SCRIPT,
        EKY_TRACE_TEST_CASES: String(cases.length), EKY_TRACE_TEST_RESULT: context.resultPath,
        EKY_TRACE_TEST_PROFILE: String(kind === 'completed'),
        EKY_TRACE_TEST_KIND: kind,
        EKY_TRACE_TEST_NODE: process.execPath,
      } });
    context.fixtureProcesses.add(child);
    const observations = [];
    child.stdout?.on('data', (chunk) => observations.push(chunk));
    let exit;
    try {
      exit = await new Promise((resolvePromise, rejectPromise) => {
        child.once('error', rejectPromise);
        child.once('close', resolvePromise);
      });
      if (exit !== (commandExportFailure ? 1 : 0)) {
        const { buffer, bytesRead } = await errorLog.read({ buffer: Buffer.alloc(4096), position: 0 })
          .catch(() => ({ buffer: Buffer.alloc(0), bytesRead: 0 }));
        const privateText = buffer.toString('utf8', 0, bytesRead);
        const failure = [
          'statisticsProviderMissing', 'statisticsLeaked', 'statisticsPresenceGuessed',
          'invalidStatisticsAccepted', 'statisticsReadUnbounded', 'statisticsObservationMissing',
          'statisticsReportInvalid', 'statisticsSuccessInvalid', 'statisticsSuccessOutputInvalid',
          'statisticsFailureEscaped', 'statisticsExitLost', 'statisticsToolMessageLost',
          'statisticsMissingOutputGuessed', 'statisticsReportLeaked', 'statisticsComparisonMissing',
          'statisticsMaskedExportFailure',
        ].find((code) => privateText.split(/\r?\n/).includes(code));
        t.diagnostic(JSON.stringify({ errorCode: failure ?? 'traceContractFailed' }));
      }
    } finally { await errorLog.close(); }
    assert.equal(exit, commandExportFailure ? 1 : 0);
    const output = commandExportFailure ? Buffer.concat(observations).toString('utf8') : await readFile(context.resultPath, 'utf8');
    assert.doesNotMatch(output, /PRIVATE|synthetic\.exe|foreign\.exe|123|456|789/);
    const results = JSON.parse(output);
    if (commandExportFailure) {
      assert.deepEqual(results, {
        schemaVersion: 1, operation: 'installerProductInspectionCapture', phase: 'analyze',
        status: 'failed', resultCode: 'captureUnverified', failureBoundary: 'commandExport',
        errorCode: 'INSPECTOR_CAPTURE_TOOL_FAILED', toolExitCode: 23,
        exportOutput: kind === 'commandExportFailureUnreadable'
          ? { logRead: 'unavailable', stdoutPresent: null, stderrPresent: null, signals: null }
          : { logRead: 'completed', stdoutPresent: true, stderrPresent: true, signals: {
              profileSelected: false, traceRangeSelected: false, timeInversionMessage: true,
              eventLossMessage: false, noDataMessage: false, profileFailureMessage: false, memoryFailureMessage: false,
              fileCorruptionMessage: false,
            } },
      });
    } else if (['capture', 'decimal', 'toolExit', 'exportOutput', 'eventStatistics', 'externalView', 'commandLifetimes', 'workspaceLifetimes', 'commandAnalysis', 'workspaceAnalysis'].includes(kind)) {
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
