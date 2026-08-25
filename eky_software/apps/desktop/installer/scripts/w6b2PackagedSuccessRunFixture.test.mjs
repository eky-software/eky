import assert from 'node:assert/strict';
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, win32 } from 'node:path';
import test from 'node:test';

import {
  createInstallerManifest,
  writeInstallerManifest,
} from '../installerManifest.mjs';
import {
  createW6b2PackagedSuccessRunFixture,
  removeW6b2PackagedSuccessRunFixture,
  verifyW6b2PackagedSuccessRunFixture,
  w6b2PackagedProofDirectoryName,
  writeW6b2PackagedSuccessPhase,
} from './w6b2PackagedSuccessRunFixture.mjs';

const buildRevision = '123456789abc';

test('keeps the representative Windows snapshot path below the legacy path limit', () => {
  const representativeSnapshotPath = win32.join(
    'C:\\Users\\runneradmin\\AppData\\Local\\Temp',
    w6b2PackagedProofDirectoryName,
    'a'.repeat(64),
    'user-data',
    'workspaces',
    '11111111-1111-4111-8111-111111111111',
    'runtime',
    'private-backup-staging',
    '22222222-2222-4222-8222-222222222222',
    'profile.sqlite',
  );

  assert.equal(w6b2PackagedProofDirectoryName, 'eky-w6b2');
  assert.ok(representativeSnapshotPath.length < 260);
});

test('stages exact package bytes and private control data', async (context) => {
  const root = await createRoot(context);
  const pair = await createPair(root);
  const token = 'a'.repeat(64);
  const run = await createW6b2PackagedSuccessRunFixture({
    installerPair: pair,
    temporaryRoot: root,
    token,
  });

  await verifyW6b2PackagedSuccessRunFixture({
    ...run,
    temporaryRoot: root,
  });
  assert.deepEqual(
    await readFile(run.source.installerPath),
    await readFile(pair.source.installerPath),
  );
  assert.deepEqual(
    await readFile(run.target.manifestPath),
    await readFile(pair.target.manifestPath),
  );
  assert.deepEqual(
    JSON.parse(
      await readFile(
        join(run.proofRoot, 'control', 'w6b2-profile-input-v1.json'),
        'utf8',
      ),
    ),
    { formatVersion: 1, sourceBuildRevision: buildRevision },
  );
  assert.deepEqual(
    JSON.parse(
      await readFile(join(run.proofRoot, 'control', 'phase.json'), 'utf8'),
    ),
    { formatVersion: 1, phase: 'sourceHandoff' },
  );
  const userData = await lstat(join(run.proofRoot, 'user-data'));
  assert.equal(userData.isDirectory(), true);
  assert.equal(userData.isSymbolicLink(), false);
});

test('updates only the closed phase control and rejects aliases', async (context) => {
  const root = await createRoot(context);
  const pair = await createPair(root);
  const token = 'b'.repeat(64);
  const run = await createW6b2PackagedSuccessRunFixture({
    installerPair: pair,
    temporaryRoot: root,
    token,
  });

  await writeW6b2PackagedSuccessPhase(run.proofRoot, 'switchToB');
  await assert.rejects(
    writeW6b2PackagedSuccessPhase(run.proofRoot, 'unknown'),
    /W6B2_SUCCESS_PHASE_INVALID/u,
  );
  await assert.rejects(
    removeW6b2PackagedSuccessRunFixture({
      proofRoot: join(root, 'foreign'),
      temporaryRoot: root,
      token,
    }),
    /W6B2_SUCCESS_PROOF_ROOT_INVALID/u,
  );

  await removeW6b2PackagedSuccessRunFixture({
    proofRoot: run.proofRoot,
    temporaryRoot: root,
    token,
  });
  await assert.rejects(lstat(run.proofRoot), { code: 'ENOENT' });
});

test('rejects changed staged package bytes', async (context) => {
  const root = await createRoot(context);
  const pair = await createPair(root);
  const run = await createW6b2PackagedSuccessRunFixture({
    installerPair: pair,
    temporaryRoot: root,
    token: 'c'.repeat(64),
  });
  await writeFile(run.source.installerPath, 'changed');

  await assert.rejects(
    verifyW6b2PackagedSuccessRunFixture({
      ...run,
      temporaryRoot: root,
    }),
    /INSTALLER_PACKAGE_DOES_NOT_MATCH_MANIFEST/u,
  );
});

test('rejects an imprecise installer ProductCode identity', async (context) => {
  const root = await createRoot(context);
  const pair = await createPair(root);

  await assert.rejects(
    createW6b2PackagedSuccessRunFixture({
      installerPair: {
        ...pair,
        source: { ...pair.source, productCode: 'source-product-code' },
      },
      temporaryRoot: root,
      token: 'd'.repeat(64),
    }),
    /W6B2_SUCCESS_PACKAGE_IDENTITY_INVALID/u,
  );
});

test('accepts release revisions and rejects revisions outside the shared bounds', async (context) => {
  const root = await createRoot(context);
  const pair = await createPair(root);

  for (const invalidBuildRevision of [
    '1'.repeat(6),
    '1'.repeat(41),
    'ABCDEF123456',
  ]) {
    await assert.rejects(
      createW6b2PackagedSuccessRunFixture({
        installerPair: { ...pair, buildRevision: invalidBuildRevision },
        temporaryRoot: root,
        token: 'e'.repeat(64),
      }),
      /W6B2_SUCCESS_PACKAGE_IDENTITY_INVALID/u,
    );
  }
});

async function createRoot(context) {
  const root = await mkdtemp(join(tmpdir(), 'eky-w6b2-run-fixture-'));
  context.after(() => rm(root, { force: true, recursive: true }));
  return root;
}

async function createPair(root) {
  const createPackage = async (role, version, productCode) => {
    const packageRoot = join(root, 'input', role);
    await mkdir(packageRoot, { recursive: true });
    const installerPath = join(packageRoot, `Eky-${version}-x64.msi`);
    const manifestPath = join(packageRoot, 'manifest.json');
    await writeFile(installerPath, `package-${role}-${version}`);
    const release = {
      appIdentity: 'Eky',
      appVersion: version,
      architecture: 'x64',
      msiProductVersion: version,
      platform: 'win32',
      releaseChannel: 'pilot',
    };
    const manifest = await createInstallerManifest({
      buildRevision,
      installerPath,
      release,
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
