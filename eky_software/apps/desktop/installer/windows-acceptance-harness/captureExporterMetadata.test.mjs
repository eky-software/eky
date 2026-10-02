import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { open, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { cleanupRunContext, createRunContext } from '../windows-process-supervisor/tests/supervisorContractTestSupport.mjs';
import { INSPECTOR_TIMEOUT_MILLISECONDS } from './installerProductOperationRuntime.mjs';

const SCRIPT = fileURLToPath(new URL('./captureInstallerProductInspection.ps1', import.meta.url));
const LABELS = ['event-statistics', 'command-export'];
const unknown = (invocationStarted = false) => ({ invocationStarted, exitObserved: false, nativeExitCode: null });
const exited = (nativeExitCode) => ({ invocationStarted: true, exitObserved: true, nativeExitCode });
const metadata = (statistics = unknown(), command = unknown(), writesComplete = true) => ({
  schemaVersion: 1, writesComplete,
  exports: { 'event-statistics': statistics, 'command-export': command },
});

const FIXTURE = String.raw`
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
try {
  $tokens = $null; $errors = $null
  $ast = [Management.Automation.Language.Parser]::ParseFile($env:EKY_EXPORT_TEST_SCRIPT, [ref]$tokens, [ref]$errors)
  $function = $ast.Find({ param($node)
    $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq 'Invoke-CaptureTool'
  }, $false)
  if ($errors.Count -ne 0 -or $null -eq $function) { throw 'captureInvocationMissing' }
  # Evaluate only the existing invocation function, never the CI/WPR entrypoint.
  . ([scriptblock]::Create($function.Extent.Text))
  . (Join-Path (Split-Path $env:EKY_EXPORT_TEST_SCRIPT -Parent) 'installerProductInspectionTrace.ps1')
  $root = $env:EKY_EXPORT_TEST_ROOT
  $kind = $env:EKY_EXPORT_TEST_KIND
  $label = $env:EKY_EXPORT_TEST_LABEL
  $metadataPath = Join-Path $root 'export-metadata.private.json'
  $arguments = @((Join-Path $root 'native-tool.mjs'), '0')
  $failure = $null
  $parserCode = $null
  $warnings = @()
  $global:LASTEXITCODE = 99

  if ($kind -ceq 'nativeExits') {
    Invoke-CaptureTool $env:EKY_EXPORT_TEST_NODE $arguments 'event-statistics'
    [IO.File]::Copy($metadataPath, (Join-Path $root 'before-parser.json'))
    try { [void](Read-InspectorTraceStatistics (Join-Path $root 'event-statistics.private.log')) }
    catch { $parserCode = Resolve-InspectorTraceErrorCode $_.Exception.Message }
    if ($parserCode -cne 'INSPECTOR_TRACE_STATISTICS_INVALID') { throw 'parserMustRejectFixture' }
    if ([IO.File]::ReadAllText($metadataPath) -cne [IO.File]::ReadAllText((Join-Path $root 'before-parser.json'))) {
      throw 'parserOverwroteExit'
    }
    try { Invoke-CaptureTool $env:EKY_EXPORT_TEST_NODE @($arguments[0], '-2147023504') 'command-export' }
    catch { $failure = $_.Exception }
    if ($null -eq $failure -or $failure.Message -cne 'INSPECTOR_CAPTURE_TOOL_FAILED' -or
        $failure.Data['toolExitCode'] -ne -2147023504) { throw 'nativeFailureLost' }
  } elseif ($kind -ceq 'commandParserFailure') {
    Invoke-CaptureTool $env:EKY_EXPORT_TEST_NODE $arguments 'command-export'
    [IO.File]::Copy($metadataPath, (Join-Path $root 'before-parser.json'))
    $parserRejected = $false
    try { [void](Read-LegacyCommandTrace (Join-Path $root 'command-export.private.log')) }
    catch { $parserRejected = $_.Exception.Message -ceq 'INSPECTOR_TRACE_TABLE_INVALID' }
    if (!$parserRejected -or [IO.File]::ReadAllText($metadataPath) -cne
        [IO.File]::ReadAllText((Join-Path $root 'before-parser.json'))) { throw 'commandParserOverwroteExit' }
  } elseif ($kind -ceq 'unrelated') {
    foreach ($otherLabel in @('events-export', 'threads-export', 'start', 'stop', 'EVENT-STATISTICS', 'command-export-extra')) {
      Invoke-CaptureTool $env:EKY_EXPORT_TEST_NODE $arguments $otherLabel
    }
    if (Test-Path -LiteralPath $metadataPath) { throw 'unrelatedMetadataWritten' }
  } elseif ($kind -ceq 'invalidArguments') {
    try { Invoke-CaptureTool $env:EKY_EXPORT_TEST_NODE @('embedded"quote') $label }
    catch { $failure = $_.Exception }
    if ($null -eq $failure -or $failure.Message -cne 'INSPECTOR_CAPTURE_ARGUMENTS_INVALID' -or
        (Test-Path -LiteralPath $metadataPath)) { throw 'invalidInvocationStarted' }
  } elseif ($kind -ceq 'launchFailure') {
    try { Invoke-CaptureTool (Join-Path $root 'missing-tool.exe') $arguments $label }
    catch { $failure = $_.Exception }
    if ($null -eq $failure) { throw 'missingToolAccepted' }
  } elseif ($kind -ceq 'interrupted') {
    function Start-Process {
      $started = [IO.File]::ReadAllText($metadataPath) | ConvertFrom-Json
      if (!$started.exports.$label.invocationStarted -or $started.exports.$label.exitObserved -or
          $null -ne $started.exports.$label.nativeExitCode) { throw 'startObservationMissing' }
      # End this fixture host before returning a process handle; no child is created.
      [Environment]::Exit(19)
    }
    Invoke-CaptureTool $env:EKY_EXPORT_TEST_NODE $arguments $label
    throw 'interruptionDidNotExit'
  } elseif ($kind -ceq 'unobservedExit') {
    $script:disposed = $false
    function Start-Process {
      $value = [pscustomobject]@{ HasExited = $false; ExitCode = 0 }
      $value | Add-Member -MemberType ScriptMethod -Name Dispose -Value { $script:disposed = $true }
      return $value
    }
    try { Invoke-CaptureTool $env:EKY_EXPORT_TEST_NODE $arguments $label }
    catch { $failure = $_.Exception }
    if ($null -eq $failure -or $failure.Message -cne 'INSPECTOR_CAPTURE_TOOL_EXIT_UNVERIFIED' -or
        !$script:disposed) { throw 'unobservedExitAccepted' }
  } elseif ($kind -cin @('writeFailure', 'writeRecovery', 'writeSuccessFailure', 'warningFailure', 'completionWriteFailure')) {
    if ($kind -cne 'completionWriteFailure') { [void][IO.Directory]::CreateDirectory($metadataPath) }
    $script:metadataLock = $null
    if ($kind -ceq 'warningFailure') {
      function Write-Warning { throw 'PRIVATE-WARNING-SINK-FAILURE' }
    }
    if ($kind -ceq 'writeRecovery') {
      function Start-Process {
        param($FilePath, $ArgumentList, [switch]$Wait, [switch]$PassThru, [switch]$NoNewWindow,
          $RedirectStandardOutput, $RedirectStandardError)
        [IO.Directory]::Delete($metadataPath)
        Microsoft.PowerShell.Management\Start-Process @PSBoundParameters
      }
    }
    if ($kind -ceq 'completionWriteFailure') {
      function Start-Process {
        param($FilePath, $ArgumentList, [switch]$Wait, [switch]$PassThru, [switch]$NoNewWindow,
          $RedirectStandardOutput, $RedirectStandardError)
        $native = Microsoft.PowerShell.Management\Start-Process @PSBoundParameters
        $script:metadataLock = [IO.File]::Open($metadataPath, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
        return $native
      }
    }
    $exitCode = if ($kind -ceq 'writeSuccessFailure') { '0' } else { '23' }
    try { Invoke-CaptureTool $env:EKY_EXPORT_TEST_NODE @($arguments[0], $exitCode) $label 3>&1 | ForEach-Object {
      $warnings += $_
    } } catch { $failure = $_.Exception }
    finally { if ($null -ne $script:metadataLock) { $script:metadataLock.Dispose() } }
    if ($kind -ceq 'writeSuccessFailure') {
      if ($null -ne $failure) { throw 'metadataOverwroteSuccess' }
    } elseif ($null -eq $failure -or $failure.Message -cne 'INSPECTOR_CAPTURE_TOOL_FAILED' -or
        $failure.Data['toolExitCode'] -ne 23) { throw 'metadataOverwroteFailure' }
    $expectedWarnings = if ($kind -ceq 'warningFailure') { 0 }
      elseif ($kind -cin @('writeRecovery', 'completionWriteFailure')) { 1 } else { 2 }
    if ($warnings.Count -ne $expectedWarnings -or @($warnings | Where-Object {
      $_ -isnot [Management.Automation.WarningRecord] -or
      $_.Message -cne 'INSPECTOR_CAPTURE_EXPORT_METADATA_UNAVAILABLE'
    }).Count -ne 0) { throw 'metadataFailureNotClosed' }
  } else { throw 'unknownFixture' }
  [IO.File]::WriteAllText($env:EKY_EXPORT_TEST_RESULT, '{"status":"validated"}')
  exit 0
} catch {
  # Raw fixture errors remain private, never in TAP or public diagnostics.
  [Console]::Error.WriteLine($_.ToString())
  exit 1
}
`;

for (const kind of ['nativeExits', 'commandParserFailure', 'unrelated', 'invalidArguments', 'launchFailure', 'interrupted',
  'unobservedExit', 'writeFailure', 'writeRecovery', 'writeSuccessFailure', 'warningFailure', 'completionWriteFailure']) {
  const labels = kind === 'commandParserFailure' ? ['command-export']
    : ['nativeExits', 'unrelated'].includes(kind) ? ['event-statistics'] : LABELS;
  for (const label of labels) {
    test(`export metadata: ${kind} / ${label}`, {
      skip: process.platform !== 'win32', timeout: INSPECTOR_TIMEOUT_MILLISECONDS,
    }, async (t) => {
      const context = await createRunContext('capture-export-metadata');
      let passed = false;
      t.after(() => cleanupRunContext(context, { preserveEvidence: !passed || t.signal.aborted }));
      const command = join(context.testRoot, 'export-metadata-fixture.ps1');
      await writeFile(command, FIXTURE);
      await writeFile(join(context.testRoot, 'native-tool.mjs'), `
        process.stdout.write('PRIVATE-EXPORT-OUTPUT');
        process.stderr.write('PRIVATE-EXPORT-ERROR');
        process.exitCode = Number(process.argv[2]);
      `);
      const output = await open(join(context.testRoot, 'stdout.private.log'), 'wx+');
      const errors = await open(join(context.testRoot, 'stderr.private.log'), 'wx');
      let closed = false;
      let processFailed = false;
      try {
        t.signal.throwIfAborted();
        const child = spawn('pwsh.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', command], {
          stdio: ['ignore', output.fd, errors.fd], windowsHide: true,
          env: { ...process.env, EKY_EXPORT_TEST_ROOT: context.testRoot,
            EKY_EXPORT_TEST_SCRIPT: SCRIPT, EKY_EXPORT_TEST_KIND: kind,
            EKY_EXPORT_TEST_LABEL: label, EKY_EXPORT_TEST_NODE: process.execPath,
            EKY_EXPORT_TEST_RESULT: context.resultPath },
        });
        context.fixtureProcesses.add(child);
        const exit = await new Promise((resolve) => {
          child.once('error', () => { processFailed = true; });
          child.once('close', (code) => { closed = true; resolve(code); });
        });
        assert.equal(processFailed, false, 'EXPORT_METADATA_FIXTURE_START_FAILED');
        assert.equal(closed, true);
        assert.equal(exit, kind === 'interrupted' ? 19 : 0, 'EXPORT_METADATA_FIXTURE_FAILED');
        t.signal.throwIfAborted();
        const stdout = await output.readFile('utf8');
        assert.equal(stdout, '', 'EXPORT_METADATA_OUTPUT_NOT_PRIVATE');
        if (kind !== 'interrupted') {
          assert.equal(await readFile(context.resultPath, 'utf8'), '{"status":"validated"}');
        }
        const path = join(context.testRoot, 'export-metadata.private.json');
        if (['unrelated', 'invalidArguments'].includes(kind)) {
          await assert.rejects(readFile(path), (error) => error.code === 'ENOENT');
        } else if (!['writeFailure', 'writeSuccessFailure', 'warningFailure'].includes(kind)) {
          const raw = await readFile(path, 'utf8');
          assert.equal(/PRIVATE|\.exe|testRoot|companyId|stack|arguments|runNonce/iu.test(raw), false);
          const actual = JSON.parse(raw);
          let expected = metadata();
          if (kind === 'nativeExits') expected = metadata(exited(0), exited(-2147023504));
          else if (kind === 'commandParserFailure') expected = metadata(unknown(), exited(0));
          else {
            expected.exports[label] = kind === 'writeRecovery' ? exited(23) : unknown(true);
            expected.writesComplete = kind !== 'writeRecovery';
          }
          assert.deepEqual(actual, expected);
        }
        passed = true;
      } finally {
        await output.close();
        await errors.close();
      }
    });
  }
}
