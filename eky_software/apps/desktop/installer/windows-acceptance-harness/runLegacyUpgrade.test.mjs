import assert from 'node:assert/strict';
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
} from './runLegacyUpgrade.mjs';
import { legacyUpgradeFailureDetails } from './legacyUpgradeFailureBoundary.mjs';

const DIRECTORY = dirname(fileURLToPath(import.meta.url));

function productState(present = false) {
  return { status: 'completed', resultCode: present ? 'targetProductPresent' : 'exactProductsAbsent',
    sourcePresent: false, targetPresent: present, installerRegistryPresent: present };
}

for (const mode of ['completed', 'preflightFailed', 'launchFailed', 'missingSupervisor',
  'processTreeUnverified', 'scenarioUnreadable', 'semanticCleanupFailed', 'fixtureCleanupFailed']) {
  test(`legacy command retains evidence only when needed: ${mode}`, { skip: process.platform !== 'win32' }, async (t) => {
    let root;
    let launched = false;
    let inspections = 0;
    let cleanups = 0;
    let removals = 0;
    t.after(async () => { if (root) await rm(root, { force: true, recursive: true }); });
    const supervisor = {
      status: 'completed', processResultCode: 'processCompleted',
      workerResultCode: 'workerResultValidated', cleanupResultCode: 'notRequired',
      processTreeAbsent: true,
    };
    const ports = {
      inventoryProfile: async () => [],
      materializeFixture: async (_, destination) => {
        root = dirname(destination);
        await mkdir(destination);
        await writeFile(resolve(destination, 'private-evidence'), 'synthetic evidence');
        return { descriptorSha256: 'a'.repeat(64), artifactRoot: destination,
          source: { artifactClass: 'historical-source-rebuild', appVersion: '0.2.6' },
          target: { appVersion: '0.2.7' } };
      },
      verifyArtifact: async () => undefined,
      createProductRuntime: () => ({
        verifyExactProductStates: async () => {
          if (mode === 'preflightFailed') return productState(true);
          return productState(inspections++ === 1);
        },
        cleanupExactProducts: async () => {
          cleanups += 1;
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
        if (['scenarioUnreadable', 'fixtureCleanupFailed'].includes(mode)) throw new Error('private result');
        return { status: 'completed', resultCode: 'historicalLegacyUpgradeCompleted' };
      },
      verifySemanticPostcondition: async () => ({ status: 'completed', resultCode: 'legacySemanticProofValidated' }),
      removeRunRoot: async (path) => {
        removals += 1;
        if (mode === 'fixtureCleanupFailed') throw new Error('private filesystem');
        await rm(path, { recursive: true, force: true });
      },
    };
    // The missing-supervisor case uses the actual strict filesystem reader.
    if (mode !== 'missingSupervisor') ports.readSupervisorResult = async () => mode === 'processTreeUnverified'
      ? { ...supervisor, status: 'failed', processResultCode: 'deadlineExceeded',
        workerResultCode: 'notChecked', cleanupResultCode: 'cleanupUnverified', processTreeAbsent: false }
      : supervisor;
    let failure;
    try {
      const result = await runLegacyUpgrade(['--artifact-descriptor',
        resolve(DIRECTORY, 'legacy-upgrade-artifact.json')], ports);
      assert.equal(mode, 'completed');
      assert.equal(result.fixtureRemoved, true);
    } catch (error) {
      failure = legacyUpgradeFailureDetails(error);
      assert.ok(failure);
      assert.doesNotMatch(JSON.stringify(failure), /private|\\\\|\.msi/);
    }
    const removed = ['completed', 'preflightFailed', 'scenarioUnreadable'].includes(mode);
    if (removed) await assert.rejects(lstat(root), { code: 'ENOENT' });
    else assert.equal(await readFile(resolve(root, 'fixture', 'private-evidence'), 'utf8'), 'synthetic evidence');
    assert.equal(removals, removed || mode === 'fixtureCleanupFailed' ? 1 : 0);
    assert.equal(launched, mode !== 'preflightFailed');
    assert.equal(cleanups, ['completed', 'scenarioUnreadable', 'semanticCleanupFailed', 'fixtureCleanupFailed'].includes(mode) ? 1 : 0);
    if (failure) {
      assert.equal(failure.fixtureRemoved, removed);
      assert.equal(failure.fixtureCleanupResultCode, removed ? 'fixtureRemoved'
        : mode === 'fixtureCleanupFailed' ? 'fixtureCleanupFailed' : 'retainedUnverified');
      if (['scenarioUnreadable', 'fixtureCleanupFailed'].includes(mode)) {
        assert.equal(failure.errorCode, 'WINDOWS_ACCEPTANCE_LEGACY_SCENARIO_RESULT_INVALID');
      }
      if (mode === 'semanticCleanupFailed') assert.equal(failure.semanticCleanupResultCode, 'semanticCleanupFailed');
      if (mode === 'processTreeUnverified') assert.equal(failure.processTreeAbsent, false);
      if (mode === 'missingSupervisor') assert.equal(failure.processTreeAbsent, false);
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
