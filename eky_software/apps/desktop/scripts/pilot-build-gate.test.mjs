import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'node:test';
import { createHash } from 'node:crypto';
import { registerHooks } from 'node:module';
import { inspectPackagedPilotSeries, packagedSeriesManifestVariable, requirePackagedSeriesPin } from './packagedPilotSeries.mjs';
import { readPackagedPilotInfo } from './readPackagedBuildInfo.mjs';

import {
  assertPilotBuildPreconditions,
  createPilotArtifactManifest,
  readPilotArtifactManifest,
} from './pilot-build-gate.mjs';

const temporaryDirectories = [];
const buildInfo = Object.freeze({
  appVersion: '0.1.0',
  buildDirty: false,
  buildRevision: '123456789abc',
});
const inventory = Object.freeze({
  fileCount: 10,
  identity: 'a'.repeat(64),
  stage: 'packagedApp',
  totalByteSize: 1_000,
});

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { force: true, recursive: true }),
    ),
  );
});

test('rejects dirty, mismatched and invalid pilot build identities', () => {
  for (const input of [
    { buildInfo: { ...buildInfo, buildDirty: true }, currentHead: '123456789abc' },
    { buildInfo, currentHead: 'abcdef123456' },
    { buildInfo: { ...buildInfo, appVersion: 'pilot' }, currentHead: '123456789abc' },
    {
      buildInfo: { ...buildInfo, appVersion: '0.1.0-alpha.2' },
      currentHead: '123456789abc',
    },
  ]) {
    assert.throws(() => assertPilotBuildPreconditions(input), /PILOT_BUILD/);
  }
});

test('requires an exact pilot manifest matching build info and inventory', async () => {
  const root = await mkdtemp(join(tmpdir(), 'eky-pilot-manifest-'));
  temporaryDirectories.push(root);
  const path = join(root, 'pilot-manifest.json');
  const manifest = createPilotArtifactManifest({ buildInfo, inventory });
  await writeFile(path, `${JSON.stringify(manifest)}\n`, 'utf8');

  await assert.doesNotReject(
    readPilotArtifactManifest(path, { buildInfo, inventory }),
  );
  await assert.rejects(
    readPilotArtifactManifest(join(root, 'missing.json'), {
      buildInfo,
      inventory,
    }),
    /PILOT_ARTIFACT_MANIFEST_MISSING_OR_INVALID/,
  );
  await writeFile(
    path,
    JSON.stringify({ ...manifest, releaseChannel: 'stable' }),
    'utf8',
  );
  await assert.rejects(
    readPilotArtifactManifest(path, { buildInfo, inventory }),
    /PILOT_ARTIFACT_MANIFEST_MISSING_OR_INVALID/,
  );
});

function seriesFixture(controls = {}) {
  const bytes = Buffer.from(JSON.stringify(createPilotArtifactManifest({ buildInfo, inventory })));
  const pin = createHash('sha256').update(bytes).digest('hex');
  const calls = [];
  return { pin, calls, options: {
    assertCurrent() { calls.push('current'); controls.current?.(); },
    async readManifest() { calls.push('manifest'); return controls.bytes ?? bytes; },
    async readInfo() { calls.push('info'); return { buildInfo }; },
    async inspectInventory() { calls.push('inventory'); await controls.inventory?.(); return controls.observed ?? inventory; },
  } };
}

test('pilot series pins exact manifest bytes and preserves the original inventory expectation', async () => {
  const f = seriesFixture();
  const value = await inspectPackagedPilotSeries(undefined, f.options);
  assert.equal(value.pin, f.pin); assert.equal(value.manifest.inventoryIdentity, inventory.identity);
  assert.equal(Object.isFrozen(value), true); assert.equal(Object.isFrozen(value.manifest), true);
  assert.equal((await inspectPackagedPilotSeries(f.pin, f.options)).pin, f.pin);
});

for (const pin of [null, '', 'x'.repeat(64), 'a'.repeat(63), 'A'.repeat(64)]) {
  test(`pilot series rejects invalid pin ${String(pin)}`, async () => {
    const f = seriesFixture();
    assert.throws(() => requirePackagedSeriesPin({ [packagedSeriesManifestVariable]: pin }));
    await assert.rejects(inspectPackagedPilotSeries(pin, f.options));
    assert.deepEqual(f.calls, []);
  });
}

test('pilot series rejects changed manifest before reading the package', async () => {
  const f = seriesFixture();
  await assert.rejects(inspectPackagedPilotSeries('b'.repeat(64), f.options));
  assert.equal(f.calls.includes('info'), false);
});

test('pilot series rejects newly observed inventory instead of adopting it', async () => {
  const f = seriesFixture({ observed: { ...inventory, identity: 'b'.repeat(64) } });
  await assert.rejects(inspectPackagedPilotSeries(f.pin, f.options));
});

test('pilot series rejects manifest mutation during inspection', async () => {
  const f = seriesFixture(); let reads = 0;
  const read = f.options.readManifest;
  f.options.readManifest = async () => Buffer.concat([await read(), Buffer.from(++reads === 1 ? '' : '\n')]);
  await assert.rejects(inspectPackagedPilotSeries(f.pin, f.options));
});

test('pilot series preserves cancellation after active inspection ends', async () => {
  const controller = new AbortController(), first = new Error('SYNTHETIC_PILOT_CANCEL_FIRST');
  const f = seriesFixture({ current: () => controller.signal.throwIfAborted(), inventory() { controller.abort(first); } });
  await assert.rejects(inspectPackagedPilotSeries(f.pin, f.options), error => error === first);
});

for (const variant of ['valid', 'development', 'dirty', 'missingRelease', 'mismatchedRevision', 'mismatchedVersion']) {
  test(`pilot inspection reads the real ASAR metadata: ${variant}`, async t => {
    const sourceRoot = new URL('../src/', import.meta.url).href;
    const hooks = registerHooks({ resolve(specifier, context, nextResolve) {
      if (context.parentURL === new URL('./readPackagedBuildInfo.mjs', import.meta.url).href &&
          specifier === '../dist/release/desktopReleaseInfo.js') {
        return nextResolve(new URL('../src/release/desktopReleaseInfo.ts', import.meta.url).href, context);
      }
      if (context.parentURL?.startsWith(sourceRoot) && specifier.startsWith('.') && specifier.endsWith('.js')) {
        return nextResolve(new URL(specifier.replace(/\.js$/u, '.ts'), context.parentURL).href, context);
      }
      if (specifier.includes('/dist/')) throw new Error('PILOT_CONTROL_MUST_NOT_REQUIRE_BUILD');
      return nextResolve(specifier, context);
    } });
    t.after(() => hooks.deregister());
    const asar = await import('@electron/asar');
    const root = await mkdtemp(join(tmpdir(), 'eky-pilot-asar-'));
    temporaryDirectories.push(root);
    const source = join(root, 'source'), resources = join(root, 'resources');
    await mkdir(join(source, 'dist'), { recursive: true }); await mkdir(resources);
    const build = { ...buildInfo, buildCreatedAt: '2026-11-05T00:00:00.000Z', schemaVersion: 1,
      buildDirty: variant === 'dirty' };
    const release = { appIdentity: 'Eky', appVersion: variant === 'mismatchedVersion' ? '0.2.0' : build.appVersion,
      architecture: 'x64', buildRevision: variant === 'mismatchedRevision' ? 'b'.repeat(12) : build.buildRevision,
      msiProductVersion: '0.1.0', platform: 'win32', releaseChannel: 'pilot', schemaVersion: 1,
      upgradeCode: '00000000-0000-4000-8000-000000000001' };
    await writeFile(join(source, 'dist', 'build-info.json'), JSON.stringify(build));
    await writeFile(join(source, 'dist', 'package-mode.json'), JSON.stringify({ schemaVersion: 1,
      mode: variant === 'development' ? 'localDevelopment' : 'pilot' }));
    if (variant !== 'missingRelease') await writeFile(join(source, 'dist', 'release-info.json'), JSON.stringify(release));
    await asar.createPackage(source, join(resources, 'app.asar'));
    if (variant === 'valid') {
      const actual = await readPackagedPilotInfo(root);
      assert.deepEqual(actual.buildInfo, build); assert.deepEqual(actual.releaseInfo, release);
    } else await assert.rejects(readPackagedPilotInfo(root));
  });
}
