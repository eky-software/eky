import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  createInstallerManifest,
  writeInstallerManifest,
} from '../installerManifest.mjs';
import {
  createW6b2PackagedFaultRunFixture,
  removeW6b2PackagedFaultRunFixture,
  verifyW6b2PackagedFaultRunFixture,
  w6b2PackagedFaultScenarios,
  writeW6b2PackagedFaultPhase,
} from './w6b2PackagedFaultRunFixture.mjs';

const buildRevision = '123456789abc';

test('creates strict private controls for every fault scenario', async (context) => {
  for (const [index, faultScenario] of w6b2PackagedFaultScenarios.entries()) {
    const root = await createRoot(context, String(index));
    const run = await createW6b2PackagedFaultRunFixture({
      faultScenario,
      installerPair: await createPair(root),
      temporaryRoot: root,
      token: String(index + 1).repeat(64),
    });
    assert.deepEqual(
      JSON.parse(
        await readFile(join(run.proofRoot, 'control', 'phase.json'), 'utf8'),
      ),
      { faultScenario, formatVersion: 2, phase: 'sourceHandoff' },
    );
    await verifyW6b2PackagedFaultRunFixture({ ...run, temporaryRoot: root });
  }
});

test('allows only scenario-specific phases and exact scenario names', async (context) => {
  const root = await createRoot(context, 'strict');
  const installerPair = await createPair(root);
  const run = await createW6b2PackagedFaultRunFixture({
    faultScenario: 'activeWorkspaceFirstStartFailure',
    installerPair,
    temporaryRoot: root,
    token: 'a'.repeat(64),
  });

  await writeW6b2PackagedFaultPhase({
    faultScenario: run.faultScenario,
    phase: 'businessRollback',
    proofRoot: run.proofRoot,
  });
  await assert.rejects(
    writeW6b2PackagedFaultPhase({
      faultScenario: run.faultScenario,
      phase: 'passiveWorkspaceRecovery',
      proofRoot: run.proofRoot,
    }),
    /W6B2_FAULT_PHASE_INVALID/u,
  );
  await assert.rejects(
    createW6b2PackagedFaultRunFixture({
      faultScenario: 'unknown',
      installerPair,
      temporaryRoot: root,
      token: 'b'.repeat(64),
    }),
    /W6B2_FAULT_SCENARIO_INVALID/u,
  );

  await removeW6b2PackagedFaultRunFixture({
    proofRoot: run.proofRoot,
    temporaryRoot: root,
    token: run.token,
  });
});

test('rejects a fault control with unknown keys', async (context) => {
  const root = await createRoot(context, 'unknown-key');
  const run = await createW6b2PackagedFaultRunFixture({
    faultScenario: 'acceptanceInterruption',
    installerPair: await createPair(root),
    temporaryRoot: root,
    token: 'c'.repeat(64),
  });
  await writeFile(
    join(run.proofRoot, 'control', 'phase.json'),
    `${JSON.stringify({
      faultScenario: run.faultScenario,
      formatVersion: 2,
      phase: 'sourceHandoff',
      unexpected: true,
    })}\n`,
  );

  await assert.rejects(
    verifyW6b2PackagedFaultRunFixture({ ...run, temporaryRoot: root }),
    /W6B2_FAULT_CONTROL_INVALID/u,
  );
});

async function createRoot(context, suffix) {
  const root = await mkdtemp(join(tmpdir(), `eky-w6b2-fault-${suffix}-`));
  context.after(() => rm(root, { force: true, recursive: true }));
  return realpath(root);
}

async function createPair(root) {
  const createPackage = async (role, version, productCode) => {
    const packageRoot = join(root, 'input', role);
    await mkdir(packageRoot, { recursive: true });
    const installerPath = join(packageRoot, `Eky-${version}-x64.msi`);
    const manifestPath = join(packageRoot, `${role}-manifest.json`);
    await writeFile(installerPath, `package-${role}-${version}`);
    const manifest = await createInstallerManifest({
      buildRevision,
      installerPath,
      release: {
        appIdentity: 'Eky',
        appVersion: version,
        architecture: 'x64',
        msiProductVersion: version,
        platform: 'win32',
        releaseChannel: 'pilot',
      },
    });
    await writeInstallerManifest(manifestPath, manifest);
    return {
      appVersion: version,
      installerPath,
      manifestPath,
      packageSha256: manifest.packageSha256,
      packageSize: manifest.packageSize,
      productCode,
    };
  };
  return {
    buildRevision,
    source: await createPackage(
      'source',
      '0.2.7',
      '11111111-1111-5111-8111-111111111111',
    ),
    target: await createPackage(
      'target',
      '0.2.8',
      '22222222-2222-5222-8222-222222222222',
    ),
  };
}
