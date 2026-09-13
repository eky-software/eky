import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { lstat, mkdir, mkdtemp, open, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { cleanupRunContext, createRunContext, createRequest, startSupervisor }
  from '../windows-process-supervisor/tests/supervisorContractTestSupport.mjs';
import { validateWindowsAcceptanceSupervisorResult } from '../windows-process-supervisor/windowsAcceptanceSupervisorResult.mjs';
import { readCommandPhaseJson } from './acceptanceCommandPhaseInput.mjs';
import { legacyCallerResultIdentity, parseLegacyCallerResult } from './legacyCallerResult.mjs';
import { workspaceCallerResultIdentity, parseWorkspaceCallerResult } from './workspaceCallerResult.mjs';
import { legacyCallerResultFile } from './legacyCallerResultFile.mjs';
import { workspaceCallerResultFile } from './workspaceCallerResultFile.mjs';
import { cleanCallerResultIdentity, parseCleanCallerResult } from './cleanCallerResult.mjs';
import { cleanCallerResultFile } from './cleanCallerResultFile.mjs';
import { upgradeCallerResultIdentity, parseUpgradeCallerResult } from './upgradeCallerResult.mjs';
import { upgradeCallerResultFile } from './upgradeCallerResultFile.mjs';

const commandBudgets = JSON.parse(await readFile(new URL('../windows-process-supervisor/supervisorCommandBudgets.json', import.meta.url)));
const contractAssembly = fileURLToPath(new URL('../bin/windows-process-supervisor-contract-fixture/Release/net10.0/Eky.WindowsProcessSupervisor.ContractFixture.dll', import.meta.url));

// Exercise the checked-in CI step with its real pnpm and result verifier.
// Only the installed-package worker is replaced by the existing synthetic fixture.
async function startCiCommand(context, kind, descriptor, resultPath, signal) {
  const workflow = await readFile(new URL(kind === 'legacy'
    ? '../../../../../.github/workflows/windows-acceptance-v2-legacy-diagnostic.yml'
    : kind === 'clean' ? '../../../../../.github/workflows/ci.yml'
    : kind === 'upgrade' ? '../../../../../.github/workflows/windows-acceptance-v2-upgrade.yml'
    : '../../../../../.github/workflows/windows-acceptance-v2-workspace.yml', import.meta.url), 'utf8');
  const lines = workflow.split(/\r?\n/u);
  const commandIndex = lines.findIndex((line) => line.trim().startsWith('pnpm --filter @eky/desktop exec dotnet ')
    && line.includes(` --${kind}-command `)
    && (kind !== 'workspace-fault' || line.includes('--fault-scenario acceptanceInterruption')));
  assert.ok(commandIndex >= 0);
  const following = lines.slice(commandIndex);
  const boundary = following.findIndex((line) => line.trim() !== '' && !line.startsWith('          '));
  assert.ok(boundary >= 4);
  const [command, returned, verifier, ...outcomeLines] = following.slice(0, boundary).map((line) => line.slice(10));
  const outcome = outcomeLines.join('\n');
  if (kind === 'clean') {
    // Release and artifact consumers use the identical command/result boundary.
    const consumer = await readFile(new URL('../../../../../.github/workflows/windows-acceptance-v2-clean.yml', import.meta.url), 'utf8');
    assert.ok(consumer.replaceAll('\r\n', '\n').includes(following.slice(0, boundary).join('\n')));
  }
  assert.equal(returned, '$commandExit = $LASTEXITCODE');
  assert.ok(verifier.startsWith('pnpm --filter @eky/desktop exec node '));
  assert.ok(verifier.includes('--command-exit $commandExit'));
  assert.ok(outcome.startsWith('if ($commandExit -ne 0 -or $LASTEXITCODE -ne 0)'));
  const script = join(context.testRoot, 'ci-step.ps1');
  await writeFile(script, [
    "$ErrorActionPreference = 'Stop'",
    '$PSNativeCommandUseErrorActionPreference = $false',
    '$descriptorPath = $env:TEST_DESCRIPTOR', '$resultPath = $env:TEST_RESULT',
    command.slice(0, command.indexOf(' dotnet ') + ' dotnet '.length)
      + '$env:TEST_COMMAND_ASSEMBLY --mode legacyCommandEntry --request $env:TEST_REQUEST',
    returned,
    '[IO.File]::WriteAllText($env:TEST_COMMAND_RETURN, [string]$commandExit)',
    verifier,
    '[IO.File]::WriteAllText($env:TEST_VERIFIER_RETURN, [string]$LASTEXITCODE)',
    outcome,
  ].join('\n'));
  const output = await open(join(context.testRoot, 'ci-step.stdout.private'), 'wx');
  let errors;
  try {
    errors = await open(join(context.testRoot, 'ci-step.stderr.private'), 'wx');
    const child = spawn('pwsh.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script], {
      cwd: fileURLToPath(new URL('../../../..', import.meta.url)),
      stdio: ['ignore', output.fd, errors.fd], windowsHide: true, signal,
      env: { ...process.env, TEST_DESCRIPTOR: descriptor, TEST_RESULT: resultPath,
        TEST_COMMAND_ASSEMBLY: contractAssembly, TEST_REQUEST: context.requestPath,
        TEST_COMMAND_RETURN: join(context.testRoot, 'command-return.txt'),
        TEST_VERIFIER_RETURN: join(context.testRoot, 'verifier-return.txt'),
        EXPECTED_DESCRIPTOR_SHA256: 'a'.repeat(64), EXPECTED_BUILD_REVISION: 'b'.repeat(40) },
    });
    const events = [];
    context.fixtureProcesses.add(child);
    child.once('exit', () => events.push('exit'));
    child.once('close', () => { events.push('close'); context.fixtureProcesses.delete(child); });
    const completion = new Promise((resolvePromise, rejectPromise) => {
      child.once('error', rejectPromise);
      child.once('close', (exitCode, terminationSignal) => resolvePromise({ exitCode, signal: terminationSignal }));
    });
    // Keep spawn errors observed while the parent's capture handles close.
    completion.catch(() => undefined);
    return { child, completion, events };
  } finally {
    await output.close();
    if (errors) await errors.close();
  }
}

export async function describeCommandPhases(commandRoot, kind, read = readCommandPhaseJson) {
  const phases = commandBudgets[kind.startsWith('workspace-') ? 'workspaceCommand' : `${kind}Command`].phases;
  const evidence = [];
  for (const phase of [...phases.map(([name]) => name), 'publishFailure']) {
    let request;
    try { request = await read(join(commandRoot, phase, 'request.json')); }
    catch (error) {
      if (error?.code !== 'ENOENT') evidence.push({ phase, result: 'requestUnreadable' });
      continue;
    }
    try {
      const value = await read(join(commandRoot, phase, 'result.json'));
      const result = validateWindowsAcceptanceSupervisorResult(value, {
        runNonce: request.runNonce, scenario: request.scenario, artifactDescriptorSha256: 'a'.repeat(64),
        supervisorExitCode: value.status === 'completed' ? 0 : 1,
      });
      evidence.push({ phase, result: 'validated', process: result.processResultCode,
        worker: result.workerResultCode, cleanup: result.cleanupResultCode, processTreeAbsent: result.processTreeAbsent });
    } catch (error) { evidence.push({ phase, result: error?.code === 'ENOENT' ? 'missing' : 'invalidOrUnreadable' }); }
  }
  return evidence;
}

export function reportCommandFailure(t, evidence, original) {
  try { t.diagnostic(JSON.stringify({ commandPhases: evidence })); } catch { /* Preserve the assertion. */ }
  throw original;
}

// Registers the same command contract for each fixed entrypoint; it does not
// execute or supervise processes until the existing test callback runs.
export function registerAcceptanceCommandEntrypointContracts(kind, register = test) {
  assert.ok(['legacy', 'clean', 'upgrade', 'workspace-success', 'workspace-fault'].includes(kind));
  const clean = kind === 'clean';
  const upgrade = kind === 'upgrade';
  const workspace = kind.startsWith('workspace-');
  const family = workspace ? 'workspace' : kind;
  const descriptorName = clean ? 'clean-install-artifact.json' : upgrade ? 'upgrade-rollback-artifact.json'
    : workspace ? 'workspace-success-artifact.json' : 'legacy-upgrade-artifact.json';
  const uninstallPhase = clean ? 'uninstallSource' : 'uninstallTarget';
  const followingCleanupPhase = clean ? 'inspectSourceFinal' : 'uninstallSource';
  const parseResult = clean ? parseCleanCallerResult : upgrade ? parseUpgradeCallerResult : workspace ? parseWorkspaceCallerResult : parseLegacyCallerResult;
  const resultFile = clean ? cleanCallerResultFile : upgrade ? upgradeCallerResultFile : workspace ? workspaceCallerResultFile : legacyCallerResultFile;
  const scenarioFailureCode = clean ? 'WINDOWS_ACCEPTANCE_CLEAN_INSTALL_FAILED' : upgrade ? 'WINDOWS_ACCEPTANCE_UPGRADE_SOURCE_INSTALL_FAILED'
    : workspace ? 'sourceInstallFailed' : 'WINDOWS_ACCEPTANCE_LEGACY_SOURCE_SMOKE_FAILED';
  register(`${kind} public command resolves the real worker and rejects an invalid artifact before installation`, {
    skip: process.platform !== 'win32', timeout: 60_000,
  }, async (t) => {
    const context = await createRunContext(kind + '-public-entry');
    let verified = false;
    t.after(() => cleanupRunContext(context, { preserveEvidence: !verified }));
    const temp = join(context.testRoot, 'temporary');
    const profile = join(context.testRoot, 'synthetic-appdata');
    await mkdir(temp);
    await mkdir(profile);
    const resultPath = join(temp, `eky-${family}-caller-` + randomBytes(16).toString('hex'), 'result.json');
    const descriptor = join(context.testRoot, descriptorName);
    await writeFile(descriptor, '{}');
    const environment = { ...process.env, TEMP: temp, TMP: temp, APPDATA: profile, LOCALAPPDATA: profile };
    delete environment.npm_node_execpath;
    const execution = startSupervisor(context, { captureOutput: false, environment, dotnetArguments: [
      `--${kind}-command`, '--artifact-descriptor', descriptor, '--expected-descriptor-sha256', 'a'.repeat(64),
      '--expected-build-revision', 'b'.repeat(40), ...(kind === 'workspace-fault' ? ['--fault-scenario', 'acceptanceInterruption'] : []),
      '--result-path', resultPath,
    ] });
    const receipts = [];
    execution.child.once('exit', () => receipts.push('exit'));
    execution.child.once('close', () => receipts.push('close'));
    const completion = await execution.completion;
    assert.deepEqual(receipts, ['exit', 'close']);
    assert.equal(completion.signal, null);
    assert.equal(completion.exitCode, 1);
    const roots = (await readdir(temp)).filter((name) => /^eky-acceptance-command-[0-9a-f]{32}$/.test(name));
    assert.equal(roots.length, 1);
    const commandRoot = join(temp, roots[0]);
    const report = JSON.parse(await readFile(join(commandRoot, 'materialize', 'result.json'), 'utf8'));
    assert.equal(report.processResultCode, 'processExitFailed');
    assert.equal(report.processTreeAbsent, true);
    await assert.rejects(lstat(join(commandRoot, 'inspectSourceBefore')), { code: 'ENOENT' });
    const result = JSON.parse(await readFile(resultPath, 'utf8'));
    assert.equal(result.outcome.status, 'failed');
    assert.equal(result.outcome.fixtureRemoved, false);
    assert.deepEqual(await readdir(profile), []);
    verified = true;
  });
  const directCases = ['completed', 'blockedEvidence', 'preparationHold', 'productInspectionHold', 'scenarioHold', 'uninstallHold', 'resultBeforeExit', 'cleanupFailed', 'scenarioAndCleanupFailed', 'removalHold',
    'publicationBeforeExit', 'productMissingResult', 'preconditionFailed', 'scenarioMissing', 'businessFailed', 'profileChanged', 'artifactChanged',
    ...(kind === 'legacy' ? ['productInspectionNativeHold', 'productInspectionReadOnly'] : workspace ? ['footprintFailed']
      : ['temporaryRootAlias', 'scenarioAndProfileFailed', 'scenarioAndRemovalFailed']), ...(kind === 'workspace-fault' ? ['sessionFailed'] : []),
    ...(upgrade ? ['applicationCleanupUnverified', 'postconditionFailed'] : [])];
  const ciCases = kind === 'legacy' || clean || upgrade
    ? ['completed', 'blockedEvidence', 'productMissingResult', 'uninstallHold', 'scenarioAndCleanupFailed'] : ['completed'];
  for (const [testCase, ciChain] of [...directCases.map((name) => [name, false]), ...ciCases.map((name) => [name, true])]) {
    const blocked = testCase === 'blockedEvidence';
    const succeeded = testCase === 'completed' || blocked || ['productInspectionReadOnly', 'temporaryRootAlias'].includes(testCase);
    const faultScenario = kind === 'workspace-fault' ? 'acceptanceInterruption' : undefined;
    register(`${kind} ${ciChain ? 'CI launch chain' : 'fixed command entrypoint'} completes the real phase chain: ${testCase}`, {
      skip: process.platform !== 'win32', timeout: 90_000,
    }, async (t) => {
      const context = await createRunContext(kind + '-entry-' + testCase);
      let commandTemp = await realpath(tmpdir());
      let environment = process.env;
      if (testCase === 'temporaryRootAlias') {
        // Keep this alias contract independent of PowerShell's path-length
        // boundary; do not add the fixture's nested root to every result path.
        commandTemp = await mkdtemp(join(commandTemp, 'eky-t-'));
        const alias = join(context.testRoot, 'alias');
        await symlink(commandTemp, alias, 'junction');
        environment = { ...process.env, TEMP: alias, TMP: alias };
      }
      const callerRoot = join(commandTemp, `eky-${family}-caller-` + randomBytes(16).toString('hex'));
      const resultPath = join(callerRoot, 'result.json');
      const descriptor = join(context.testRoot, descriptorName);
      let verified = false;
      t.after(async () => {
        const removePassed = ['completed', 'productInspectionReadOnly', 'temporaryRootAlias'].includes(testCase);
        if (verified && removePassed) await rm(callerRoot, { recursive: true });
        await cleanupRunContext(context, { preserveEvidence: !verified || !removePassed });
        if (verified && testCase === 'temporaryRootAlias') await rm(commandTemp, { recursive: true });
      });
      await writeFile(descriptor, JSON.stringify({ testCase }));
      const evidenceRequestPath = join(context.testRoot, 'evidence-request.json');
      if (blocked) await writeFile(evidenceRequestPath, JSON.stringify(createRequest(context, 'exitZero')));
      await writeFile(context.requestPath, JSON.stringify({ node: process.execPath,
        ...(blocked ? { evidenceRequestPath } : {}),
        ...(['productInspectionNativeHold', 'productInspectionReadOnly', 'temporaryRootAlias'].includes(testCase) ? { useCanonicalBudgets: true } : {}),
        worker: fileURLToPath(new URL('./legacyCommandWorkerFixture.mjs', import.meta.url)),
        arguments: [`--${kind}-command`, '--artifact-descriptor', descriptor, '--expected-descriptor-sha256', 'a'.repeat(64),
          '--expected-build-revision', 'b'.repeat(40), ...(faultScenario ? ['--fault-scenario', faultScenario] : []), '--result-path', resultPath] }));
      const execution = ciChain ? await startCiCommand(context, kind, descriptor, resultPath, t.signal)
        : startSupervisor(context, { captureOutput: false, environment,
        dotnetAssembly: contractAssembly,
        dotnetArguments: ['--mode', 'legacyCommandEntry', '--request', context.requestPath] });
      const events = execution.events ?? [];
      if (!ciChain) {
        execution.child.once('exit', () => events.push('exit'));
        execution.child.once('close', () => events.push('close'));
      }
      const completion = await execution.completion;
      let phaseEvidence;
      try {
        const root = await readFile(join(context.testRoot, 'command-root.txt'), 'utf8');
        assert.equal(await realpath(dirname(root)), await realpath(commandTemp));
        assert.match(basename(root), /^eky-acceptance-command-[0-9a-f]{32}$/);
        phaseEvidence = await describeCommandPhases(root, kind);
      } catch { phaseEvidence = 'unavailable'; }
      try {
        assert.deepEqual(events, ['exit', 'close']);
        assert.equal(completion.signal, null);
        if (ciChain) {
          assert.ok(Array.isArray(phaseEvidence) && phaseEvidence.length > 0, 'Required phase results must be readable');
          for (const phase of phaseEvidence) {
            assert.equal(phase.result, 'validated');
            assert.equal(phase.processTreeAbsent, true);
          }
          if (succeeded) assert.deepEqual(phaseEvidence.map(({ phase }) => phase),
            commandBudgets[workspace ? 'workspaceCommand' : `${kind}Command`].phases.map(([phase]) => phase));
          const receipt = (name) => readFile(join(context.testRoot, name + '-return.txt'), 'utf8')
            .catch(() => 'receiptMissingOrUnreadable');
          assert.equal(await receipt('command'), succeeded ? '0' : '1');
          assert.equal(await receipt('verifier'), succeeded ? '0' : '1');
        }
        if (blocked) {
          const marker = JSON.parse(await readFile(join(context.runRoot, 'output.ready.json'), 'utf8'));
          assert.equal(marker.schemaVersion, 1);
          assert.equal(marker.runNonce, context.runNonce);
          if (!ciChain) assert.equal(marker.processId, execution.child.pid);
          else assert.ok(Number.isSafeInteger(marker.processId) && marker.processId > 0);
          assert.equal(marker.writerBlocked, true);
        }
        assert.equal(completion.exitCode, succeeded ? 0 : 1);
        const commandRoot = await readFile(join(context.testRoot, 'command-root.txt'), 'utf8');
        const phase = { preparationHold: 'prepare', productInspectionHold: 'inspectSourceBefore', productInspectionNativeHold: 'inspectSourceBefore', scenarioHold: 'scenario', uninstallHold: uninstallPhase,
          resultBeforeExit: uninstallPhase, removalHold: 'fixtureCleanup', publicationBeforeExit: 'publish' }[testCase];
        if (phase) {
          const outcome = JSON.parse(await readFile(join(commandRoot, phase, 'result.json'), 'utf8'));
          assert.equal(outcome.processResultCode, 'deadlineExceeded');
          assert.equal(outcome.processTreeAbsent, true);
          assert.equal(outcome.cleanupResultCode, 'processTreeAbsent');
        }
        if (testCase === 'productInspectionNativeHold') {
          const observation = JSON.parse(await readFile(join(commandRoot, phase, 'inspector-observation.json'), 'utf8'));
          assert.deepEqual(observation, { schemaVersion: 1, events:
            ['scriptStarted', 'requestValidated', 'comCreationStarted'].map((name) => ({ phase: name, payloadCount: 0 })) });
          await assert.rejects(lstat(join(commandRoot, phase, 'worker-result.json')), { code: 'ENOENT' });
        }
        if (testCase === 'productInspectionReadOnly') {
          const outcome = JSON.parse(await readFile(join(commandRoot, 'inspectSourceBefore', 'result.json'), 'utf8'));
          assert.equal(outcome.processResultCode, 'processCompleted');
          assert.equal(outcome.workerResultCode, 'workerResultValidated');
          assert.equal(outcome.processTreeAbsent, true);
          await assert.rejects(lstat(join(commandRoot, 'inspectSourceBefore', 'inspector-observation.json')), { code: 'ENOENT' });
        }
        if (testCase === 'productMissingResult') {
          const report = JSON.parse(await readFile(join(commandRoot, uninstallPhase, 'result.json'), 'utf8'));
          assert.equal(report.processResultCode, 'processCompleted');
          assert.equal(report.workerResultCode, 'workerResultMissing');
          assert.equal(report.processTreeAbsent, true);
          await assert.rejects(lstat(join(commandRoot, followingCleanupPhase)), { code: 'ENOENT' });
        }
        if (testCase === 'preparationHold') await assert.rejects(lstat(resultPath), { code: 'ENOENT' });
        else {
          const binding = workspace ? workspaceCallerResultIdentity(resultPath, { expectedBuildRevision: 'b'.repeat(40),
            expectedDescriptorSha256: 'a'.repeat(64), faultScenario })
            : (clean ? cleanCallerResultIdentity : upgrade ? upgradeCallerResultIdentity : legacyCallerResultIdentity)(resultPath, { buildRevision: 'b'.repeat(40), artifactDescriptorSha256: 'a'.repeat(64) });
          const callerRead = await readFile(resultPath).then((bytes) => ({ status: 'read', bytes }),
            (error) => ({ status: error.code === 'ENOENT' ? 'missing' : 'unreadable' }));
          assert.equal(callerRead.status, 'read', 'Mandatory caller result is independent of worker-result absence');
          const result = parseResult(callerRead.bytes, binding);
          assert.equal(result.outcome.status, succeeded || testCase === 'publicationBeforeExit' ? 'completed' : 'failed');
          if (!succeeded) await assert.rejects(resultFile(
            'verify', resultPath, binding, completion.exitCode));
          if (succeeded) assert.equal(result.outcome.fixtureRemoved, true);
          if (testCase === 'scenarioAndCleanupFailed') {
            assert.equal(result.outcome.errorCode, scenarioFailureCode);
            assert.equal(result.outcome.semanticCleanupResultCode, 'semanticCleanupFailed');
            assert.equal(result.outcome.fixtureRemoved, false);
          }
          if (['cleanupFailed', 'scenarioAndCleanupFailed'].includes(testCase)) {
            await assert.rejects(lstat(join(commandRoot, followingCleanupPhase)), { code: 'ENOENT' });
            assert.equal(result.outcome.fixtureRemoved, false);
          }
          if (['uninstallHold', 'resultBeforeExit'].includes(testCase)) {
            assert.equal(result.outcome.errorCode, clean || upgrade ? scenarioFailureCode : workspace ? 'supervisorDeadlineExceeded' : 'WINDOWS_ACCEPTANCE_SUPERVISOR_DEADLINE_EXCEEDED');
            assert.equal(result.outcome.fixtureRemoved, false);
            await assert.rejects(lstat(join(commandRoot, followingCleanupPhase)), { code: 'ENOENT' });
          }
          if (testCase === 'preconditionFailed') {
            assert.equal(result.outcome.errorCode, workspace ? 'preconditionFailed' : clean ? 'WINDOWS_ACCEPTANCE_CLEAN_PRECONDITION_FAILED'
              : upgrade ? 'WINDOWS_ACCEPTANCE_UPGRADE_PRECONDITION_FAILED' : 'WINDOWS_ACCEPTANCE_LEGACY_PRECONDITION_FAILED');
            await assert.rejects(lstat(join(commandRoot, 'scenario')), { code: 'ENOENT' });
            await assert.rejects(lstat(join(commandRoot, uninstallPhase)), { code: 'ENOENT' });
          }
          if (['productInspectionHold', 'productInspectionNativeHold'].includes(testCase)) {
            assert.equal(result.outcome.errorCode, workspace ? 'supervisorDeadlineExceeded' : 'WINDOWS_ACCEPTANCE_SUPERVISOR_DEADLINE_EXCEEDED');
            assert.equal(result.outcome.fixtureRemoved, false);
            await assert.rejects(lstat(join(commandRoot, 'scenario')), { code: 'ENOENT' });
            await assert.rejects(lstat(join(commandRoot, uninstallPhase)), { code: 'ENOENT' });
            const { state } = JSON.parse(await readFile(join(commandRoot, 'materialize', 'phase-state.json'), 'utf8'));
            assert.equal((await lstat(state.runRoot)).isDirectory(), true);
          }
          if (['scenarioMissing', 'businessFailed', 'sessionFailed'].includes(testCase)) {
            assert.equal(result.outcome.semanticCleanupResultCode, clean && testCase === 'businessFailed' ? 'notRequired' : 'semanticCleanupCompleted');
            assert.equal(result.outcome.fixtureRemoved, true);
          }
          if (testCase === 'sessionFailed') assert.equal(result.outcome.errorCode, 'sessionProofInvalid');
          if (['scenarioAndProfileFailed', 'scenarioAndRemovalFailed'].includes(testCase)) {
            assert.equal(result.outcome.errorCode, scenarioFailureCode);
            assert.equal(result.outcome.fixtureRemoved, false);
            if (testCase === 'scenarioAndProfileFailed') assert.equal(result.outcome.safetyErrorCode, 'WINDOWS_ACCEPTANCE_NORMAL_PROFILE_CHANGED');
            else assert.equal(result.outcome.fixtureCleanupResultCode, 'fixtureCleanupFailed');
          }
          if (testCase === 'applicationCleanupUnverified') {
            assert.equal(result.outcome.errorCode, scenarioFailureCode);
            assert.equal(result.outcome.applicationCleanupResultCode, 'cleanupUnverified');
            assert.equal(result.outcome.fixtureRemoved, false);
          }
          if (testCase === 'postconditionFailed') {
            assert.equal(result.outcome.errorCode, 'WINDOWS_ACCEPTANCE_UPGRADE_POSTCONDITION_FAILED');
            assert.equal(result.outcome.postconditionResultCode, 'exactProductsAbsentAfterCleanup');
            assert.equal(result.outcome.fixtureRemoved, true);
          }
          if (['profileChanged', 'artifactChanged', 'footprintFailed', 'preconditionFailed', 'productMissingResult', 'applicationCleanupUnverified'].includes(testCase)) {
            assert.equal(result.outcome.fixtureRemoved, false);
            const { state } = JSON.parse(await readFile(join(commandRoot, 'prepare', 'phase-state.json'), 'utf8'));
            assert.equal((await lstat(state.runRoot)).isDirectory(), true);
          }
        }
        verified = true;
      } catch (error) { reportCommandFailure(t, phaseEvidence, error); }
    });
  }
}
