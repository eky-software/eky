import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import {
  buildW6b2PackagedSuccessInstallers,
  requireCanonicalW6b2Baseline,
  requireInstallerPair,
  requirePackagedApplicationPair,
} from './buildW6b2PackagedSuccessInstallers.mjs';

const canonicalRelease = Object.freeze({
  appIdentity: 'Eky',
  appVersion: '0.2.6',
  architecture: 'x64',
  msiProductVersion: '0.2.6',
  platform: 'win32',
  releaseChannel: 'pilot',
});
const buildRevision = '1'.repeat(40);

test('builds the private fixture pair serially without changing canonical versions', async (context) => {
  const root = await createTemporaryRoot(context);
  const canonicalPackagePath = join(root, 'canonical-package.json');
  const canonicalReleasePath = join(root, 'canonical-release.json');
  await writeFile(
    canonicalPackagePath,
    `${JSON.stringify({ version: '0.2.6' })}\n`,
  );
  await writeFile(
    canonicalReleasePath,
    `${JSON.stringify(canonicalRelease)}\n`,
  );
  const paths = createPaths(root);
  const events = [];
  let activeBuilds = 0;
  const dependencies = createDependencies({
    onPackage() {
      events.push('package');
    },
    async buildInstaller(input) {
      activeBuilds += 1;
      assert.equal(activeBuilds, 1);
      const version = JSON.parse(
        await readFile(input.desktopPackagePath, 'utf8'),
      ).version;
      events.push(`build:${version}`);
      await mkdir(input.artifactsRoot, { recursive: true });
      const artifact = join(input.artifactsRoot, `Eky-${version}-x64.msi`);
      await writeFile(artifact, `msi-${version}`);
      activeBuilds -= 1;
      return {
        artifact,
        inventory: { stage: 'packagedApp' },
        productCode: version === '0.2.7' ? 'source-code' : 'target-code',
        release: {
          ...canonicalRelease,
          appVersion: version,
          msiProductVersion: version,
        },
      };
    },
  });

  const result = await buildW6b2PackagedSuccessInstallers({
    canonicalPackagePath,
    canonicalReleasePath,
    dependencies,
    paths,
  });

  assert.deepEqual(events, ['package', 'build:0.2.7', 'build:0.2.8']);
  assert.equal(result.source.appVersion, '0.2.7');
  assert.equal(result.target.appVersion, '0.2.8');
  assert.equal(result.source.buildRevision, buildRevision);
  assert.notEqual(result.source.productCode, result.target.productCode);
  assert.equal(
    JSON.parse(await readFile(canonicalPackagePath, 'utf8')).version,
    '0.2.6',
  );
  assert.equal(
    JSON.parse(await readFile(canonicalReleasePath, 'utf8')).appVersion,
    '0.2.6',
  );
});

test('rejects canonical, packaged and installer identity mismatches', () => {
  assert.throws(
    () =>
      requireCanonicalW6b2Baseline(
        { version: '0.2.7' },
        canonicalRelease,
      ),
    /W6B2_CANONICAL_RELEASE_INVALID/u,
  );
  assert.throws(
    () =>
      requirePackagedApplicationPair({
        packaged: packagedPair({ targetRevision: '2'.repeat(40) }),
        releases: releasePair(),
      }),
    /W6B2_PACKAGED_APPLICATION_PAIR_INVALID/u,
  );
  assert.throws(
    () =>
      requireInstallerPair({
        source: installerResult('0.2.7', 'same-code'),
        target: installerResult('0.2.8', 'same-code'),
      }),
    /W6B2_INSTALLER_PAIR_INVALID/u,
  );
});

function createDependencies(overrides = {}) {
  const manifests = new Map();
  return {
    async buildInstaller() {
      throw new Error('unexpected');
    },
    async createManifest(input) {
      const version = input.release.appVersion;
      const manifest = {
        packageSha256: version === '0.2.7' ? 'a'.repeat(64) : 'b'.repeat(64),
        packageSize: 10,
      };
      manifests.set(input.installerPath, manifest);
      return manifest;
    },
    async packageApplications() {
      overrides.onPackage?.();
      return { ...packagedPair(), releases: releasePair() };
    },
    async verifyManifest(input) {
      assert.deepEqual(manifests.get(input.installerPath), input.manifest);
    },
    async writeManifest(path, manifest) {
      await writeFile(path, JSON.stringify(manifest));
    },
    ...(overrides.buildInstaller === undefined
      ? {}
      : { buildInstaller: overrides.buildInstaller }),
  };
}

function packagedPair({ targetRevision = buildRevision } = {}) {
  return {
    source: {
      appVersion: '0.2.7',
      buildInfo: {
        appVersion: '0.2.7',
        buildDirty: false,
        buildRevision,
      },
      installerRelease: releasePair().source,
      packagedPath: 'source-package',
    },
    target: {
      appVersion: '0.2.8',
      buildInfo: {
        appVersion: '0.2.8',
        buildDirty: false,
        buildRevision: targetRevision,
      },
      installerRelease: releasePair().target,
      packagedPath: 'target-package',
    },
  };
}

function releasePair() {
  return {
    source: {
      ...canonicalRelease,
      appVersion: '0.2.7',
      msiProductVersion: '0.2.7',
    },
    target: {
      ...canonicalRelease,
      appVersion: '0.2.8',
      msiProductVersion: '0.2.8',
    },
  };
}

function installerResult(appVersion, productCode) {
  return {
    appVersion,
    buildRevision,
    installerPath: `${appVersion}.msi`,
    manifestPath: `${appVersion}.json`,
    packageSha256: appVersion === '0.2.7' ? 'a'.repeat(64) : 'b'.repeat(64),
    productCode,
  };
}

async function createTemporaryRoot(context) {
  const { mkdtemp, rm } = await import('node:fs/promises');
  const root = await mkdtemp(join(tmpdir(), 'eky-w6b2-builder-'));
  context.after(() => rm(root, { force: true, recursive: true }));
  return root;
}

function createPaths(root) {
  const createRole = (role) => ({
    artifactsRoot: join(root, role, 'artifacts'),
    inputRoot: join(root, role, 'input'),
  });
  return {
    fixtureRoot: join(root, 'fixture'),
    source: createRole('source'),
    target: createRole('target'),
  };
}
