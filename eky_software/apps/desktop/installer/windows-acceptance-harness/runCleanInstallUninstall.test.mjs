import assert from 'node:assert/strict';
import { lstat, mkdir, mkdtemp, realpath, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

import {
  parseCleanInstallUninstallArguments,
  runCleanInstallUninstall,
} from './runCleanInstallUninstall.mjs';
import { createCleanInstallUninstallPostSupervisorWindowsRuntime } from './cleanInstallUninstallPostSupervisorWindowsRuntime.mjs';
import {
  runCleanInstallUninstallWorker,
} from './runCleanInstallUninstallWorker.mjs';

test('command line accepts exactly one explicit clean artifact descriptor', () => {
  assert.equal(
    parseCleanInstallUninstallArguments([
      '--artifact-descriptor',
      join(process.cwd(), 'fixture.manifest.json'),
    ]).descriptorPath,
    join(process.cwd(), 'fixture.manifest.json'),
  );
  assert.throws(
    () => parseCleanInstallUninstallArguments([]),
    /WINDOWS_ACCEPTANCE_CLEAN_ARGUMENTS_INVALID/,
  );
  assert.throws(
    () =>
      parseCleanInstallUninstallArguments([
        '--artifact-descriptor',
        'manifest.json',
        '--extra',
      ]),
    /WINDOWS_ACCEPTANCE_CLEAN_ARGUMENTS_INVALID/,
  );
  assert.throws(
    () =>
      parseCleanInstallUninstallArguments([
        '--',
        '--artifact-descriptor',
        'manifest.json',
      ]),
    /WINDOWS_ACCEPTANCE_CLEAN_ARGUMENTS_INVALID/,
  );
});

test('worker rejects malformed invocation before reading the filesystem', async () => {
  assert.equal(await runCleanInstallUninstallWorker([]), 64);
  assert.equal(
    await runCleanInstallUninstallWorker(['--request', null]),
    64,
  );
});

test('clean caller resolves a temporary-root alias before the real read-only product preflight',
  { skip: process.platform !== 'win32', timeout: 40_000 }, async (context) => {
    const root = await mkdtemp(join(await realpath(tmpdir()), 'eky-clean-temp-contract-'));
    const canonical = resolve(root, 'canonical');
    const alias = resolve(root, 'alias');
    await mkdir(canonical);
    await symlink(canonical, alias, 'junction');
    const previous = { TEMP: process.env.TEMP, TMP: process.env.TMP };
    let runtime, scenarioRoot, supervisorReached = false;
    context.after(async () => {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      if (!runtime || runtime.outcome().productProcessAbsent) {
        await rm(root, { recursive: true, force: true });
        await assert.rejects(lstat(root), { code: 'ENOENT' });
      } else assert.fail('read-only product process cleanup is unverified');
    });
    process.env.TEMP = alias;
    process.env.TMP = alias;
    await assert.rejects(runCleanInstallUninstall(['--artifact-descriptor', resolve(root, 'unused.json')], {
      inventoryProfile: async () => [],
      materializeFixture: async (_descriptor, fixtureRoot) => ({
        artifactDescriptorSha256: 'a'.repeat(64), fixtureRoot,
        manifest: { appVersion: '255.255.65535', msiProductVersion: '255.255.65535' },
        packageSha256: 'b'.repeat(64),
      }),
      verifyArtifact: async () => undefined,
      createProductRuntime: (options) => {
        scenarioRoot = options.scenarioRoot;
        runtime = createCleanInstallUninstallPostSupervisorWindowsRuntime(options);
        return runtime;
      },
      // The real exact-product query must pass, but no installer worker may start.
      launchSupervisor: () => { supervisorReached = true; throw new Error('TEST_STOP_BEFORE_MSI'); },
    }), /TEST_STOP_BEFORE_MSI/);
    assert.equal(supervisorReached, true);
    assert.equal(scenarioRoot, await realpath(scenarioRoot));
    assert.equal(runtime.outcome().productProcessAbsent, true);
  });

test('clean caller rejects an unavailable temporary root before fixture work',
  { skip: process.platform !== 'win32' }, async (context) => {
    const root = await mkdtemp(join(await realpath(tmpdir()), 'eky-clean-missing-temp-'));
    const previous = { TEMP: process.env.TEMP, TMP: process.env.TMP };
    context.after(async () => {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      await rm(root, { recursive: true, force: true });
    });
    process.env.TEMP = resolve(root, 'missing');
    process.env.TMP = process.env.TEMP;
    let fixtureWorkStarted = false;
    await assert.rejects(runCleanInstallUninstall(['--artifact-descriptor', resolve(root, 'unused.json')], {
      inventoryProfile: async () => { fixtureWorkStarted = true; return []; },
    }), /WINDOWS_ACCEPTANCE_CLEAN_TEMP_ROOT_INVALID/);
    assert.equal(fixtureWorkStarted, false);
  });
