import assert from 'node:assert/strict';
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  parseUpgradeRollbackArguments,
  requireUpgradeRollbackProductPrecondition,
  resolveUpgradeRollbackTemporaryRoot,
  runUpgradeRollback,
} from './runUpgradeRollback.mjs';
import { runCleanInstallUninstall } from './runCleanInstallUninstall.mjs';
import { upgradeRollbackFailureDetails } from './upgradeRollbackFailureBoundary.mjs';
import { cleanInstallUninstallFailureDetails } from './cleanInstallUninstallFailureBoundary.mjs';

const DIRECTORY = dirname(fileURLToPath(import.meta.url));

for (const clean of [true, false]) {
  for (const mode of ['completed', 'prepareFailed', 'supervisorMissing', 'treeUnverified',
    'cleanupUnverified', 'cleanupFailed', 'deadlineRecovered', 'scenarioAndProfileFailed', 'scenarioAndRemovalFailed',
    ...(!clean ? ['preconditionUnverified'] : [])]) {
    test(`${clean ? 'clean' : 'upgrade'} caller preserves independent failure and retention: ${mode}`,
      { skip: process.platform !== 'win32' }, async (t) => {
        let root, started = 0, removals = 0, cleanups = 0, inspections = 0, profileReads = 0;
        let productProcessAbsent = true;
        t.after(async () => { if (root) await rm(root, { force: true, recursive: true }); });
        const products = (present) => ({ status: 'completed', resultCode: present ? 'targetProductPresent' : 'exactProductsAbsent',
          sourcePresent: false, targetPresent: present, installerRegistryPresent: present });
        const verify = async () => {
          assert.equal(productProcessAbsent, true, 'No inspection after unverified cleanup');
          if (started > 0) assert.notEqual(mode, 'treeUnverified');
          if (mode === 'preconditionUnverified') {
            productProcessAbsent = false;
            return { status: 'failed', errorCode: 'productStateVerificationProcessRemains' };
          }
          const present = mode !== 'completed' && inspections++ === (clean ? 0 : 1);
          return clean ? { status: 'completed', resultCode: present ? 'exactProductPresent' : 'exactProductAbsent',
            exactProductPresent: present } : products(present);
        };
        const cleanup = async () => {
          cleanups += 1;
          if (mode === 'cleanupUnverified') productProcessAbsent = false;
          if (['cleanupUnverified', 'cleanupFailed'].includes(mode)) return { status: 'failed',
            errorCode: mode === 'cleanupUnverified' ? 'semanticCleanupProcessRemains' : 'semanticCleanupFailed' };
          return { status: 'completed', resultCode: 'semanticCleanupCompleted' };
        };
        const ports = {
          inventoryProfile: async () => {
            if (++profileReads === 2 && mode === 'scenarioAndProfileFailed') throw new Error('PRIVATE profile');
            return [];
          },
          materializeFixture: async (_, destination) => {
            root = clean ? destination : dirname(destination);
            if (!clean) await mkdir(destination);
            await writeFile(resolve(root, 'evidence'), 'synthetic');
            if (mode === 'prepareFailed') throw new Error('SYNTHETIC_PREPARATION_FAILED');
            return clean ? { artifactDescriptorSha256: 'a'.repeat(64), fixtureRoot: root,
              manifest: { appVersion: '0.2.7', msiProductVersion: '0.2.7' }, packageSha256: 'b'.repeat(64) }
              : { descriptorSha256: 'a'.repeat(64), artifactRoot: destination,
                roles: { source: { appVersion: '0.2.7', packageSha256: 'b'.repeat(64) },
                  target: { appVersion: '0.2.8', packageSha256: 'c'.repeat(64) }, windowsRollback: { packageSha256: 'd'.repeat(64) } } };
          },
          verifyArtifact: async () => {},
          createProductRuntime: () => ({ outcome: () => ({ productProcessAbsent }),
            ...(clean ? { verifyExactProductState: verify, cleanupExactProduct: cleanup }
              : { verifyExactProductStates: verify, cleanupExactProducts: cleanup }) }),
          launchSupervisor: () => {
            started += 1;
            return { child: { exitCode: 0, signalCode: null }, completion: Promise.resolve(0) };
          },
          readSupervisorResult: async () => {
            if (mode === 'supervisorMissing') throw new Error('WINDOWS_ACCEPTANCE_SUPERVISOR_TERMINAL_RESULT_MISSING');
            return { status: mode === 'completed' ? 'completed' : 'failed',
              processResultCode: mode === 'completed' ? 'processCompleted' : 'deadlineExceeded',
              workerResultCode: mode === 'completed' ? 'workerResultValidated' : 'notChecked',
              cleanupResultCode: mode === 'treeUnverified' ? 'cleanupUnverified' : 'processTreeAbsent',
              processTreeAbsent: mode !== 'treeUnverified' };
          },
          readScenarioResult: async () => ({ status: 'completed',
            resultCode: clean ? 'cleanInstallUninstallCompleted' : 'upgradeRollbackCompleted' }),
          removeRunRoot: async (path) => {
            removals += 1;
            if (mode === 'scenarioAndRemovalFailed') throw new Error('PRIVATE removal');
            await rm(path, { recursive: true, force: true });
          },
        };
        const run = () => clean ? runCleanInstallUninstall(['--artifact-descriptor', resolve('clean-install-artifact.json')], ports)
          : runUpgradeRollback(['--artifact-descriptor', resolve('upgrade-rollback-artifact.json')], ports);
        let result;
        if (mode === 'completed') await assert.doesNotReject(async () => { result = await run(); });
        else await assert.rejects(run, (error) => {
          result = (clean ? cleanInstallUninstallFailureDetails : upgradeRollbackFailureDetails)(error);
          assert.ok(result);
          const expected = mode === 'prepareFailed' ? 'SYNTHETIC_PREPARATION_FAILED'
            : mode === 'preconditionUnverified' ? 'WINDOWS_ACCEPTANCE_UPGRADE_PRECONDITION_FAILED'
              : mode === 'supervisorMissing' ? 'WINDOWS_ACCEPTANCE_SUPERVISOR_TERMINAL_RESULT_MISSING'
                : 'WINDOWS_ACCEPTANCE_SUPERVISOR_DEADLINE_EXCEEDED';
          assert.equal(result.errorCode, expected);
          assert.doesNotMatch(JSON.stringify(result), /PRIVATE/);
          return true;
        });
        const removed = ['completed', 'prepareFailed', 'deadlineRecovered'].includes(mode);
        assert.equal(result.fixtureRemoved, removed);
        assert.equal(result.fixtureCleanupResultCode, removed ? 'fixtureRemoved'
          : mode === 'scenarioAndRemovalFailed' ? 'fixtureCleanupFailed' : 'retainedUnverified');
        assert.equal(result.productProcessAbsent, productProcessAbsent);
        assert.equal(removals, removed || mode === 'scenarioAndRemovalFailed' ? 1 : 0);
        assert.equal(started, ['prepareFailed', 'preconditionUnverified'].includes(mode) ? 0 : 1);
        assert.equal(cleanups, ['cleanupUnverified', 'cleanupFailed', 'deadlineRecovered',
          'scenarioAndProfileFailed', 'scenarioAndRemovalFailed'].includes(mode) ? 1 : 0);
        if (mode === 'scenarioAndProfileFailed') assert.equal(result.safetyErrorCode, 'WINDOWS_ACCEPTANCE_NORMAL_PROFILE_CHANGED');
        if (!productProcessAbsent) {
          assert.equal(profileReads, 1);
          assert.equal(result.safetyErrorCode, clean ? 'WINDOWS_ACCEPTANCE_CLEAN_PRODUCT_PROCESS_UNVERIFIED'
            : 'WINDOWS_ACCEPTANCE_UPGRADE_PRODUCT_PROCESS_UNVERIFIED');
        }
        if (removed) await assert.rejects(lstat(root), { code: 'ENOENT' });
        else assert.equal(await readFile(resolve(root, 'evidence'), 'utf8'), 'synthetic');
      });
  }
}

test('upgrade runner accepts only the canonical descriptor path', () => {
  assert.deepEqual(
    parseUpgradeRollbackArguments([
      '--artifact-descriptor',
      'C:\\temp\\artifact\\upgrade-rollback-artifact.json',
    ]),
    {
      descriptorPath:
        'C:\\temp\\artifact\\upgrade-rollback-artifact.json',
    },
  );
  assert.throws(
    () =>
      parseUpgradeRollbackArguments([
        '--artifact-descriptor',
        'C:\\temp\\artifact\\renamed.json',
      ]),
    /WINDOWS_ACCEPTANCE_UPGRADE_ARGUMENTS_INVALID/,
  );
  assert.throws(
    () => parseUpgradeRollbackArguments(['--artifact-descriptor', 'relative']),
    /WINDOWS_ACCEPTANCE_UPGRADE_ARGUMENTS_INVALID/,
  );
});

test('upgrade runner resolves the temporary root before creating fixtures', async (testContext) => {
  const root = await mkdtemp(join(tmpdir(), 'eky-v2-upgrade-temp-root-'));
  testContext.after(() => rm(root, { force: true, recursive: true }));
  const canonicalRoot = resolve(root, 'canonical');
  const aliasRoot = resolve(root, 'alias');
  await mkdir(canonicalRoot);
  await symlink(
    canonicalRoot,
    aliasRoot,
    process.platform === 'win32' ? 'junction' : 'dir',
  );

  assert.equal(
    await resolveUpgradeRollbackTemporaryRoot(aliasRoot),
    await realpath(canonicalRoot),
  );
});

test('upgrade runner rejects an unavailable temporary root', async () => {
  await assert.rejects(
    resolveUpgradeRollbackTemporaryRoot(
      resolve(tmpdir(), 'eky-v2-upgrade-missing-temp-root'),
    ),
    /WINDOWS_ACCEPTANCE_UPGRADE_TEMP_ROOT_INVALID/,
  );
});

test('upgrade worker has no build, nested supervisor, W6, or emergency cleanup ownership', async () => {
  const worker = await readFile(
    resolve(DIRECTORY, 'runUpgradeRollbackWorker.mjs'),
    'utf8',
  );
  const runtime = await readFile(
    resolve(DIRECTORY, 'upgradeRollbackWindowsRuntime.mjs'),
    'utf8',
  );
  assert.doesNotMatch(worker, /buildWindows|packageWindows|w6b/iu);
  assert.doesNotMatch(worker, /WindowsProcessSupervisor|taskkill|Get-CimInstance/iu);
  assert.doesNotMatch(runtime, /WindowsProcessSupervisor|taskkill|Get-CimInstance/iu);
  assert.match(runtime, /rollbackWindowsInstaller\.ps1/u);
});

test('outer product preflight accepts only exact source and target absence', () => {
  assert.doesNotThrow(() =>
    requireUpgradeRollbackProductPrecondition({
      status: 'completed',
      resultCode: 'exactProductsAbsent',
      sourcePresent: false,
      targetPresent: false,
      installerRegistryPresent: false,
    }),
  );
  assert.throws(
    () =>
      requireUpgradeRollbackProductPrecondition({
        status: 'completed',
        resultCode: 'sourceProductPresent',
        sourcePresent: true,
        targetPresent: false,
        installerRegistryPresent: true,
      }),
    /WINDOWS_ACCEPTANCE_UPGRADE_PRECONDITION_FAILED/,
  );
  assert.throws(
    () =>
      requireUpgradeRollbackProductPrecondition({
        status: 'completed',
        resultCode: 'installerRegistryPresent',
        sourcePresent: false,
        targetPresent: false,
        installerRegistryPresent: true,
      }),
    /WINDOWS_ACCEPTANCE_UPGRADE_PRECONDITION_FAILED/,
  );
  assert.throws(
    () =>
      requireUpgradeRollbackProductPrecondition({
        status: 'failed',
        errorCode: 'productStateVerificationFailed',
      }),
    /WINDOWS_ACCEPTANCE_UPGRADE_PRECONDITION_FAILED/,
  );
});
