import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { link, mkdir, mkdtemp, readFile, realpath, rm, symlink, truncate, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { INSTALLER_UPGRADE_CODE } from '../../installerIdentity.mjs';
import {
  msiPolicyExpectedRole,
  readMsiPolicyDescriptor,
  readPolicyBytes,
  validateMsiPolicyDescriptor,
  verifyMsiPolicyFixture,
} from './msiFileVersionPolicyRuntime.mjs';
import { requireHostedMsiPolicyEnvironment } from './msiFileVersionPolicyWorker.mjs';

const NONCE = 'ab'.repeat(32);
const NAMES = ['older.dll', 'equal.dll', 'newer.dll'];
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const error = message => ({ name: 'Error', message });

// Fake bytes only: none of these files are compiled, installed or executed.
async function fixture(t) {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'eky-policy-runtime-unit-')));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const root = join(directory, 'fixture');
  const localAppData = join(directory, 'synthetic-app-data');
  await mkdir(root);
  const value = {
    schemaVersion: 1, root, runNonce: NONCE, productName: 'Eky MSI Policy Probe',
    upgradeCode: '{AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA}',
    installRoot: resolve(localAppData, `EkyMsiPolicy-${NONCE}`),
    registryKey: `Software\\EkyMsiPolicy\\${NONCE}`,
    source: {
      productCode: '{BBBBBBBB-BBBB-4BBB-8BBB-BBBBBBBBBBBB}', version: '1.0.0',
      installerPath: join(root, 'source', 'policy.msi'),
      installerSha256: digest('synthetic-source-msi'), payloadRoot: join(root, 'source', 'payload'),
    },
    target: {
      productCode: '{CCCCCCCC-CCCC-4CCC-8CCC-CCCCCCCCCCCC}', version: '1.0.1',
      installerPath: join(root, 'target', 'policy.msi'),
      installerSha256: digest('synthetic-target-msi'), payloadRoot: join(root, 'target', 'payload'),
    },
    files: NAMES.map((name, index) => ({
      name, sourceVersion: `${index + 1}.0.0.0`, targetVersion: '2.0.0.0',
      sourceSha256: digest(`synthetic-source-${name}`), targetSha256: digest('synthetic-target-dll'),
    })),
  };
  const contents = new Map();
  for (const role of ['source', 'target']) {
    await mkdir(value[role].payloadRoot, { recursive: true });
    contents.set(value[role].installerPath, Buffer.from(`synthetic-${role}-msi`));
    for (const name of NAMES) {
      contents.set(join(value[role].payloadRoot, name),
        Buffer.from(role === 'source' ? `synthetic-source-${name}` : 'synthetic-target-dll'));
    }
  }
  for (const [path, bytes] of contents) await writeFile(path, bytes, { flag: 'wx' });
  const path = join(root, 'descriptor.json');
  const bytes = Buffer.from(JSON.stringify(value));
  await writeFile(path, bytes, { flag: 'wx' });
  return { directory, root, localAppData, value, path, bytes, contents };
}

function setLocalAppData(t, value) {
  const previous = process.env.LOCALAPPDATA;
  process.env.LOCALAPPDATA = value;
  t.after(() => {
    if (previous === undefined) delete process.env.LOCALAPPDATA;
    else process.env.LOCALAPPDATA = previous;
  });
}

test('policy descriptor accepts only the bound synthetic pair without changing it', async t => {
  const { value, path, localAppData } = await fixture(t);
  const original = structuredClone(value);
  assert.deepEqual(validateMsiPolicyDescriptor(value, path, localAppData), original);
  assert.deepEqual(value, original);
  assert.equal(value.installRoot, resolve(localAppData, `EkyMsiPolicy-${NONCE}`));
});

test('policy descriptor requires exact keys at root, both packages and every file', async t => {
  const { value, path, localAppData } = await fixture(t);
  const select = [v => v, v => v.source, v => v.target, ...NAMES.map((_, i) => v => v.files[i])];
  for (const object of select) {
    const extra = structuredClone(value);
    object(extra).unexpected = true;
    assert.throws(() => validateMsiPolicyDescriptor(extra, path, localAppData), error('msiPolicyDescriptorInvalid'));
    for (const key of Object.keys(object(value))) {
      const missing = structuredClone(value);
      delete object(missing)[key];
      assert.throws(() => validateMsiPolicyDescriptor(missing, path, localAppData), error('msiPolicyDescriptorInvalid'), key);
    }
  }
  for (const invalid of [null, [], 'descriptor', 1]) {
    assert.throws(() => validateMsiPolicyDescriptor(invalid, path, localAppData), error('msiPolicyDescriptorInvalid'));
  }
});

test('policy descriptor rejects identity, path, version and file inventory substitutions', async t => {
  const { value, path, localAppData, directory } = await fixture(t);
  const mutations = [
    v => { v.schemaVersion = 2; },
    v => { v.runNonce = 'ab'.repeat(31); },
    v => { v.runNonce = NONCE.toUpperCase(); },
    v => { v.root = directory; },
    v => { v.productName = 'Eky'; },
    v => { v.upgradeCode = `{${INSTALLER_UPGRADE_CODE}}`; },
    v => { v.upgradeCode = v.upgradeCode.toLowerCase(); },
    v => { v.upgradeCode = v.upgradeCode.replace('-4AAA-', '-5AAA-'); },
    v => { v.installRoot = resolve(localAppData, 'Programs', `EkyMsiPolicy-${NONCE}`); },
    v => { v.installRoot = resolve(localAppData, 'Eky'); },
    v => { v.registryKey = 'HKCU\\' + v.registryKey; },
    v => { v.registryKey = 'Software\\Eky'; },
    v => { v.target.productCode = v.source.productCode; },
    v => { v.files.reverse(); },
    v => { v.files.pop(); },
    v => { v.files.push(structuredClone(v.files[0])); },
    v => { v.files[1] = structuredClone(v.files[0]); },
    v => { v.files = {}; },
  ];
  for (const role of ['source', 'target']) mutations.push(
    v => { v[role] = []; },
    v => { v[role].productCode = v.upgradeCode; },
    v => { v[role].productCode = v[role].productCode.slice(1, -1); },
    v => { v[role].version = '1.0.2'; },
    v => { v[role].installerSha256 = 'AB'.repeat(32); },
    v => { v[role].installerPath = join(directory, 'policy.msi'); },
    v => { v[role].payloadRoot = v[role === 'source' ? 'target' : 'source'].payloadRoot; },
  );
  for (let i = 0; i < NAMES.length; i += 1) mutations.push(
    v => { v.files[i].name = '../outside.dll'; },
    v => { v.files[i].sourceVersion = '4.0.0.0'; },
    v => { v.files[i].targetVersion = '3.0.0.0'; },
    v => { v.files[i].sourceSha256 = 'invalid'; },
    v => { v.files[i].targetSha256 = v.files[i].sourceSha256; },
  );
  for (const mutate of mutations) {
    const invalid = structuredClone(value);
    mutate(invalid);
    assert.throws(() => validateMsiPolicyDescriptor(invalid, path, localAppData), error('msiPolicyDescriptorInvalid'));
  }
  assert.throws(() => validateMsiPolicyDescriptor(value, 'descriptor.json', localAppData), error('msiPolicyDescriptorInvalid'));
  assert.throws(() => validateMsiPolicyDescriptor(value, path, 'relative'), error('msiPolicyDescriptorInvalid'));
});

test('policy byte reader enforces inclusive size limits and leaves original bytes intact', async t => {
  const { root } = await fixture(t);
  const path = join(root, 'bounded.bin');
  const bytes = Buffer.alloc(64 * 1024, 42);
  await writeFile(path, bytes);
  assert.deepEqual(await readPolicyBytes(path), bytes);
  await assert.rejects(readPolicyBytes(path, bytes.length - 1), error('msiPolicyFileInvalid'));
  await writeFile(path, Buffer.alloc(bytes.length + 1, 42));
  await assert.rejects(readPolicyBytes(path), error('msiPolicyFileInvalid'));
  await writeFile(path, 'abc');
  assert.deepEqual(await readPolicyBytes(path, 3), Buffer.from('abc'));
  assert.equal(await readFile(path, 'utf8'), 'abc');
});

test('policy byte reader rejects directories, hardlinks and aliased parent paths', async t => {
  const { root, directory } = await fixture(t);
  await assert.rejects(readPolicyBytes(root), error('msiPolicyFileInvalid'));
  const path = join(root, 'linked.bin');
  await writeFile(path, 'synthetic');
  await link(path, join(root, 'hardlink.bin'));
  await assert.rejects(readPolicyBytes(path), error('msiPolicyFileInvalid'));
  await assert.rejects(readPolicyBytes(join(root, 'hardlink.bin')), error('msiPolicyFileInvalid'));
  const alias = join(directory, 'alias');
  await symlink(root, alias, 'junction');
  await assert.rejects(readPolicyBytes(join(alias, 'descriptor.json')), error('msiPolicyFileInvalid'));
  await assert.rejects(readPolicyBytes(join(root, 'absent.bin')), { code: 'ENOENT' });
});

test('policy descriptor reader binds exact bytes, strict JSON and the local application root', async t => {
  const { value, path, bytes, localAppData } = await fixture(t);
  setLocalAppData(t, localAppData);
  assert.deepEqual(await readMsiPolicyDescriptor(path, digest(bytes)), value);
  for (const invalidHash of ['0'.repeat(64), 'AB'.repeat(32), '', undefined]) {
    await assert.rejects(readMsiPolicyDescriptor(path, invalidHash), error('msiPolicyDescriptorChanged'));
  }
  await writeFile(path, Buffer.concat([bytes, Buffer.from('\n')]));
  await assert.rejects(readMsiPolicyDescriptor(path, digest(bytes)), error('msiPolicyDescriptorChanged'));
  const source = bytes.toString('utf8');
  for (const invalid of [
    Buffer.from('{'), Buffer.from('[]'), Buffer.from('{}'), Buffer.from([0xff, 0xff]),
    Buffer.from(source.replace('"schemaVersion":1', '"schemaVersion":1,"schemaVersion":1')),
    Buffer.from(source.replace('"version":"1.0.0"', '"version":"1.0.0","version":"1.0.0"')),
    Buffer.from(source.replace('"schemaVersion":1', '"schemaVersion":1,"unexpected":true')),
  ]) {
    await writeFile(path, invalid);
    await assert.rejects(readMsiPolicyDescriptor(path, digest(invalid)), error('msiPolicyDescriptorInvalid'));
  }
  await writeFile(path, bytes);
  process.env.LOCALAPPDATA = join(localAppData, 'other');
  await assert.rejects(readMsiPolicyDescriptor(path, digest(bytes)), error('msiPolicyDescriptorInvalid'));
});

test('fixture verification reads both MSI files and all six payload files without mutations', async t => {
  const { value, contents } = await fixture(t);
  const original = structuredClone(value);
  await verifyMsiPolicyFixture(value);
  assert.deepEqual(value, original);
  for (const [path, bytes] of contents) assert.deepEqual(await readFile(path), bytes);
});

for (const role of ['source', 'target']) {
  test(`fixture verification rejects changed ${role} installer and each payload`, async t => {
    const { value, contents } = await fixture(t);
    const installer = value[role].installerPath;
    await writeFile(installer, 'changed-synthetic-msi');
    await assert.rejects(verifyMsiPolicyFixture(value), error('msiPolicyInstallerChanged'));
    await writeFile(installer, contents.get(installer));
    for (const name of NAMES) {
      const path = join(value[role].payloadRoot, name);
      await writeFile(path, 'changed-synthetic-dll');
      await assert.rejects(verifyMsiPolicyFixture(value), error('msiPolicyPayloadChanged'));
      await writeFile(path, contents.get(path));
    }
  });
}

test('fixture verification preserves file-type, single-link and maximum-size rejection', async t => {
  const { value, contents } = await fixture(t);
  const installer = value.source.installerPath;
  const linked = installer + '.link';
  await link(installer, linked);
  await assert.rejects(verifyMsiPolicyFixture(value), error('msiPolicyFileInvalid'));
  await rm(linked);
  await truncate(installer, 16 * 1024 * 1024 + 1);
  await assert.rejects(verifyMsiPolicyFixture(value), error('msiPolicyFileInvalid'));
  await writeFile(installer, contents.get(installer));
  const payload = join(value.target.payloadRoot, 'newer.dll');
  await rm(payload);
  await assert.rejects(verifyMsiPolicyFixture(value), { code: 'ENOENT' });
  await mkdir(payload);
  await assert.rejects(verifyMsiPolicyFixture(value), error('msiPolicyFileInvalid'));
});

test('expected file policy distinguishes equal-version override from newer-file protection', () => {
  assert.deepEqual(NAMES.map(name => msiPolicyExpectedRole(name, 'uiDefault')), ['target', 'target', 'source']);
  assert.deepEqual(NAMES.map(name => msiPolicyExpectedRole(name, 'uiOverride')), ['target', 'source', 'source']);
  for (const name of ['', 'source', 'target', 'unknown.dll', '../older.dll', null, undefined]) {
    assert.throws(() => msiPolicyExpectedRole(name, 'uiDefault'), error('msiPolicyVariantInvalid'));
  }
  for (const variant of ['', 'prepare', 'uiUnknown', null, undefined]) {
    assert.throws(() => msiPolicyExpectedRole('older.dll', variant), error('msiPolicyVariantInvalid'));
  }
});

test('installation admission requires all hosted Windows runner signals', () => {
  const hosted = { GITHUB_ACTIONS: 'true', RUNNER_ENVIRONMENT: 'github-hosted', RUNNER_OS: 'Windows' };
  assert.doesNotThrow(() => requireHostedMsiPolicyEnvironment(hosted, 'win32'));
  for (const platform of ['linux', 'darwin', 'windows', null]) {
    assert.throws(() => requireHostedMsiPolicyEnvironment(hosted, platform), error('msiPolicyHostedRunnerRequired'));
  }
  for (const key of Object.keys(hosted)) {
    const missing = { ...hosted };
    delete missing[key];
    assert.throws(() => requireHostedMsiPolicyEnvironment(missing, 'win32'), error('msiPolicyHostedRunnerRequired'));
    for (const value of ['', false, true, 'TRUE', 'self-hosted']) {
      assert.throws(() => requireHostedMsiPolicyEnvironment({ ...hosted, [key]: value }, 'win32'), error('msiPolicyHostedRunnerRequired'));
    }
  }
  assert.throws(() => requireHostedMsiPolicyEnvironment({}, 'win32'), error('msiPolicyHostedRunnerRequired'));
  assert.deepEqual(hosted, { GITHUB_ACTIONS: 'true', RUNNER_ENVIRONMENT: 'github-hosted', RUNNER_OS: 'Windows' });
});
