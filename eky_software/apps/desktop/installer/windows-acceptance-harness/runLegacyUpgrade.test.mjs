import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { setImmediate } from 'node:timers/promises';
import { lstat, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  parseLegacyUpgradeArguments,
  requireLegacyUpgradeProductPrecondition,
  resolveLegacyUpgradeTemporaryRoot,
  runLegacyUpgrade,
  startLegacyUpgradeSupervisor,
} from './runLegacyUpgrade.mjs';
import { legacyUpgradeFailureDetails } from './legacyUpgradeFailureBoundary.mjs';
import { validateLegacyCallerResult } from './legacyCallerResult.mjs';
import { createLegacyUpgradeFilesystemRuntime } from './legacyUpgradeFilesystemRuntime.mjs';

const DIRECTORY = dirname(fileURLToPath(import.meta.url));

for (const mode of ['success', 'nonzero', 'spawnFailure', 'postSpawnError']) {
  test(`legacy supervisor completion retains error and waits for close: ${mode}`, async () => {
    const child = new EventEmitter();
    const phases = [];
    const execution = startLegacyUpgradeSupervisor('request', 'root', (phase) => {
      phases.push(phase);
      throw new Error('private observer failure');
    }, { spawnProcess: () => child });
    let completed = false;
    const outcome = execution.completion.then((code) => { completed = true; return code; }, (error) => {
      completed = true; return error.message;
    });
    if (mode !== 'spawnFailure') child.emit('spawn');
    if (['spawnFailure', 'postSpawnError'].includes(mode)) child.emit('error', new Error('private process error'));
    if (mode !== 'spawnFailure') child.emit('exit', mode === 'nonzero' ? 1 : 0, null);
    await setImmediate();
    assert.equal(completed, false);
    child.emit('close', mode === 'nonzero' ? 1 : 0, null);
    assert.equal(await outcome, { success: 0, nonzero: 1,
      spawnFailure: 'WINDOWS_ACCEPTANCE_SUPERVISOR_START_FAILED',
      postSpawnError: 'WINDOWS_ACCEPTANCE_SUPERVISOR_EXIT_INVALID' }[mode]);
    assert.deepEqual(phases, mode === 'spawnFailure' ? ['supervisorClose'] : ['supervisorExit', 'supervisorClose']);
  });
}

function productState(present = false) {
  return { status: 'completed', resultCode: present ? 'targetProductPresent' : 'exactProductsAbsent',
    sourcePresent: false, targetPresent: present, installerRegistryPresent: present };
}

for (const [mode, expectedErrorCode] of Object.entries({
  completed: null,
  artifactBindingMismatch: 'WINDOWS_ACCEPTANCE_LEGACY_ARTIFACT_VERIFICATION_FAILED',
  preflightFailed: 'WINDOWS_ACCEPTANCE_LEGACY_PRECONDITION_FAILED',
  preflightUnverified: 'WINDOWS_ACCEPTANCE_LEGACY_PRECONDITION_FAILED',
  cleanupUnverified: 'WINDOWS_ACCEPTANCE_LEGACY_FINAL_CLEANUP_FAILED',
  scenarioAndCleanupUnverified: 'WINDOWS_ACCEPTANCE_LEGACY_SCENARIO_RESULT_INVALID',
  launchFailed: 'WINDOWS_ACCEPTANCE_SUPERVISOR_START_FAILED',
  missingSupervisor: 'WINDOWS_ACCEPTANCE_SUPERVISOR_TERMINAL_RESULT_MISSING',
  processTreeUnverified: 'WINDOWS_ACCEPTANCE_SUPERVISOR_DEADLINE_EXCEEDED',
  scenarioUnreadable: 'WINDOWS_ACCEPTANCE_LEGACY_SCENARIO_RESULT_INVALID',
  semanticCleanupFailed: 'WINDOWS_ACCEPTANCE_LEGACY_FINAL_CLEANUP_FAILED',
  fixtureCleanupFailed: 'WINDOWS_ACCEPTANCE_LEGACY_SCENARIO_RESULT_INVALID',
  filesystemUnverified: 'WINDOWS_ACCEPTANCE_LEGACY_SCENARIO_RESULT_INVALID',
})) {
  test(`legacy command retains evidence only when needed: ${mode}`, { skip: process.platform !== 'win32' }, async (t) => {
    let root;
    let launched = false;
    let inspections = 0;
    let cleanups = 0;
    let removals = 0;
    let productProcessAbsent = true;
    t.after(async () => { if (root) await rm(root, { force: true, recursive: true }); });
    const supervisor = {
      status: 'completed', processResultCode: 'processCompleted',
      workerResultCode: 'workerResultValidated', cleanupResultCode: 'notRequired',
      processTreeAbsent: true,
    };
    const ports = {
      expectedArtifact: { buildRevision: 'b'.repeat(40), artifactDescriptorSha256: 'a'.repeat(64) },
      inventoryProfile: async () => [],
      materializeFixture: async (_, destination) => {
        root = dirname(destination);
        await mkdir(destination);
        await writeFile(resolve(destination, 'private-evidence'), 'synthetic evidence');
        return { descriptorSha256: 'a'.repeat(64), artifactRoot: destination,
          buildRevision: (mode === 'artifactBindingMismatch' ? 'c' : 'b').repeat(40),
          source: { artifactClass: 'historical-source-rebuild', appVersion: '0.2.6', packageSha256: 'c'.repeat(64) },
          target: { appVersion: '0.2.7', packageSha256: 'd'.repeat(64) } };
      },
      verifyArtifact: async () => undefined,
      createProductRuntime: () => ({
        outcome: () => ({ productProcessAbsent }),
        verifyExactProductStates: async () => {
          assert.equal(productProcessAbsent, true);
          if (mode === 'preflightUnverified') {
            productProcessAbsent = false;
            return { status: 'failed', errorCode: 'productStateVerificationProcessRemains' };
          }
          if (mode === 'preflightFailed') return productState(true);
          return productState(inspections++ === 1);
        },
        cleanupExactProducts: async () => {
          cleanups += 1;
          if (['cleanupUnverified', 'scenarioAndCleanupUnverified'].includes(mode)) {
            productProcessAbsent = false;
            return { status: 'failed', errorCode: 'semanticCleanupProcessRemains' };
          }
          if (mode === 'semanticCleanupFailed') throw new Error('private cleanup');
          return { status: 'completed', resultCode: 'semanticCleanupCompleted' };
        },
      }),
      launchSupervisor: () => {
        launched = true;
        if (mode === 'launchFailed') throw new Error('WINDOWS_ACCEPTANCE_SUPERVISOR_START_FAILED');
        return { child: { exitCode: 0, signalCode: null }, completion: Promise.resolve(0) };
      },
      readScenarioResult: async () => {
        if (['scenarioUnreadable', 'fixtureCleanupFailed', 'filesystemUnverified', 'scenarioAndCleanupUnverified'].includes(mode)) throw new Error('private result');
        return { status: 'completed', resultCode: 'historicalLegacyUpgradeCompleted' };
      },
      verifySemanticPostcondition: async () => ({ status: 'completed', resultCode: 'legacySemanticProofValidated',
        businessDataPreserved: true, adoptedWorkspaceCount: 1, idempotentSecondStartup: true }),
      removeRunRoot: async (path) => {
        removals += 1;
        if (mode === 'fixtureCleanupFailed') throw new Error('private filesystem');
        await rm(path, { recursive: true, force: true });
      },
    };
    if (mode === 'filesystemUnverified') {
      ports.filesystem = createLegacyUpgradeFilesystemRuntime({ runProcess: async () => ({ directProcessAbsent: false }) });
      ports.verifyArtifact = ports.filesystem.verifyArtifact;
    }
    // The missing-supervisor case uses the actual strict filesystem reader.
    if (mode !== 'missingSupervisor') ports.readSupervisorResult = async () => mode === 'processTreeUnverified'
      ? { ...supervisor, status: 'failed', processResultCode: 'deadlineExceeded',
        workerResultCode: 'notChecked', cleanupResultCode: 'cleanupUnverified', processTreeAbsent: false }
      : supervisor;
    let failure;
    const execute = () => runLegacyUpgrade(['--artifact-descriptor',
      resolve(DIRECTORY, 'legacy-upgrade-artifact.json')], ports);
    if (mode === 'completed') {
      let result;
      await assert.doesNotReject(async () => { result = await execute(); });
      assert.equal(result.status, 'completed');
      assert.equal(result.resultCode, 'historicalLegacyUpgradeCompleted');
      assert.equal(result.fixtureRemoved, true);
      const binding = { schemaVersion: 1, invocationId: 'a'.repeat(32), scenario: 'historicalLegacyUpgrade', ...ports.expectedArtifact };
      assert.doesNotThrow(() => validateLegacyCallerResult({ binding, outcome: result }, binding));
    } else {
      await assert.rejects(execute, (error) => {
        failure = legacyUpgradeFailureDetails(error);
        assert.ok(failure);
        assert.equal(failure.errorCode, expectedErrorCode);
        assert.doesNotMatch(JSON.stringify(failure), /private|\\\\|\.msi/);
        return true;
      });
    }
    const removed = ['completed', 'artifactBindingMismatch', 'preflightFailed', 'scenarioUnreadable'].includes(mode);
    if (removed) await assert.rejects(lstat(root), { code: 'ENOENT' });
    else assert.equal(await readFile(resolve(root, 'fixture', 'private-evidence'), 'utf8'), 'synthetic evidence');
    assert.equal(removals, removed || mode === 'fixtureCleanupFailed' ? 1 : 0);
    assert.equal(launched, !['preflightFailed', 'preflightUnverified', 'artifactBindingMismatch'].includes(mode));
    assert.equal(cleanups, ['completed', 'scenarioUnreadable', 'semanticCleanupFailed', 'fixtureCleanupFailed', 'filesystemUnverified',
      'cleanupUnverified', 'scenarioAndCleanupUnverified'].includes(mode) ? 1 : 0);
    if (failure) {
      assert.equal(failure.productProcessAbsent, productProcessAbsent);
      if (!productProcessAbsent) assert.equal(failure.safetyErrorCode, 'WINDOWS_ACCEPTANCE_LEGACY_PRODUCT_PROCESS_UNVERIFIED');
      if (mode === 'scenarioAndCleanupUnverified') {
        assert.equal(failure.semanticCleanupResultCode, 'semanticCleanupProcessRemains');
        assert.equal(failure.postconditionResultCode, 'productStateVerificationProcessRemains');
      }
      assert.equal(failure.fixtureRemoved, removed);
      assert.equal(failure.fixtureCleanupResultCode, removed ? 'fixtureRemoved'
        : mode === 'fixtureCleanupFailed' ? 'fixtureCleanupFailed' : 'retainedUnverified');
      if (['scenarioUnreadable', 'fixtureCleanupFailed'].includes(mode)) {
        assert.equal(failure.errorCode, 'WINDOWS_ACCEPTANCE_LEGACY_SCENARIO_RESULT_INVALID');
      }
      if (mode === 'semanticCleanupFailed') assert.equal(failure.semanticCleanupResultCode, 'semanticCleanupFailed');
      if (mode === 'processTreeUnverified') assert.equal(failure.processTreeAbsent, false);
      if (mode === 'missingSupervisor') assert.equal(failure.processTreeAbsent, false);
      if (mode === 'filesystemUnverified') {
        assert.equal(failure.filesystemProcessAbsent, false);
        assert.equal(failure.filesystemErrorCode, 'WINDOWS_ACCEPTANCE_LEGACY_FILESYSTEM_PROCESS_REMAINS');
        assert.equal(failure.fixtureCleanupResultCode, 'retainedUnverified');
      }
    }
  });
}

test('legacy runner accepts only the canonical descriptor path', () => {
  assert.deepEqual(
    parseLegacyUpgradeArguments([
      '--artifact-descriptor',
      'C:\\temp\\legacy\\legacy-upgrade-artifact.json',
    ]),
    { descriptorPath: 'C:\\temp\\legacy\\legacy-upgrade-artifact.json' },
  );
  assert.throws(
    () =>
      parseLegacyUpgradeArguments([
        '--artifact-descriptor',
        'C:\\temp\\legacy\\renamed.json',
      ]),
    /WINDOWS_ACCEPTANCE_LEGACY_ARGUMENTS_INVALID/,
  );
});

test('legacy runner canonicalizes the temporary root before fixture creation', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'eky-v2-legacy-root-'));
  t.after(() => rm(root, { force: true, recursive: true }));
  const canonical = resolve(root, 'canonical');
  const alias = resolve(root, 'alias');
  await mkdir(canonical);
  await symlink(canonical, alias, process.platform === 'win32' ? 'junction' : 'dir');
  assert.equal(await resolveLegacyUpgradeTemporaryRoot(alias), await realpath(canonical));
});

test('legacy outer precondition accepts only exact product absence', () => {
  assert.doesNotThrow(() =>
    requireLegacyUpgradeProductPrecondition({
      status: 'completed',
      resultCode: 'exactProductsAbsent',
      sourcePresent: false,
      targetPresent: false,
      installerRegistryPresent: false,
    }),
  );
  assert.throws(
    () =>
      requireLegacyUpgradeProductPrecondition({
        status: 'completed',
        resultCode: 'sourceProductPresent',
        sourcePresent: true,
        targetPresent: false,
        installerRegistryPresent: true,
      }),
    /WINDOWS_ACCEPTANCE_LEGACY_PRECONDITION_FAILED/,
  );
});

test('legacy worker has one supervisor owner and no build, W6, retry, or emergency cleanup', async () => {
  const runner = await readFile(resolve(DIRECTORY, 'runLegacyUpgrade.mjs'), 'utf8');
  const worker = await readFile(resolve(DIRECTORY, 'runLegacyUpgradeWorker.mjs'), 'utf8');
  assert.match(runner, /Eky\.WindowsProcessSupervisor\.dll/u);
  assert.match(runner, /runtimeRoot: dirname\(artifact\.artifactRoot\)/u);
  assert.match(worker, /process\.exit\(await runLegacyUpgradeWorker/u);
  assert.doesNotMatch(worker, /WindowsProcessSupervisor|taskkill|Get-CimInstance|packageWindows|buildWindows|w6b/iu);
  assert.doesNotMatch(`${runner}\n${worker}`, /retry|setTimeout|Start-Sleep/iu);
});
