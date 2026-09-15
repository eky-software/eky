import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { lstat, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createClosedDirectoryInventory } from './closedDirectoryInventory.mjs';
import { validateLegacyFilesystemRequest } from './legacyUpgradeFilesystem.mjs';
import { createLegacyUpgradeFilesystemRuntime } from './legacyUpgradeFilesystemRuntime.mjs';

test('private filesystem request rejects unknown operations, keys and accessors', () => {
  for (const request of [
    { schemaVersion: 1, operation: 'uninstall', payload: { root: 'synthetic' } },
    { schemaVersion: 1, operation: 'remove', payload: { root: 'synthetic', command: 'unsafe' } },
    { schemaVersion: 2, operation: 'inventory', payload: { root: 'synthetic' } },
    { schemaVersion: 1, operation: 'inventory', payload: { get root() { throw new Error('must not execute'); } } },
  ]) assert.throws(() => validateLegacyFilesystemRequest(request), /LEGACY_FILESYSTEM_INVALID/);
});

for (const mode of ['completed', 'failed', 'missing', 'duplicate', 'unknown', 'unverified', 'throws', 'invalidAdapterResult']) {
  test(`filesystem result requires a single private reply and actual process completion: ${mode}`, async () => {
    let calls = 0;
    const runtime = createLegacyUpgradeFilesystemRuntime({
      async runProcess(options) {
        calls++;
        if (mode === 'throws') throw new Error('private platform error');
        if (mode === 'invalidAdapterResult') return null;
        const child = options.spawnProcess(options.command, options.arguments, {});
        child.emit('spawn');
        return { status: 'completed', exitCode: mode === 'failed' ? 1 : 0, directProcessAbsent: mode !== 'unverified' };
      },
      spawnProcess(_, __, options) {
        assert.deepEqual(options.stdio, ['ignore', 'ignore', 'ignore', 'ipc']);
        const child = new EventEmitter();
        child.send = (request, callback) => {
          assert.equal(request.operation, 'inventory');
          const reply = { schemaVersion: 1, operation: request.operation, status: 'completed', value: [] };
          if (mode === 'failed') {
            delete reply.value;
            reply.status = 'failed';
            reply.errorCode = 'WINDOWS_ACCEPTANCE_PROFILE_ROOT_INVALID';
          }
          if (mode === 'unknown') reply.privateData = 'not allowed';
          if (mode !== 'missing') child.emit('message', reply);
          if (mode === 'duplicate') child.emit('message', reply);
          callback(null);
        };
        return child;
      },
    });
    if (mode === 'completed') {
      assert.deepEqual(await runtime.inventoryProfile('synthetic'), []);
      assert.deepEqual(runtime.outcome(), { filesystemProcessAbsent: true, filesystemOperation: 'notFailed', filesystemErrorCode: null });
    } else {
      const unverified = ['unverified', 'throws', 'invalidAdapterResult'].includes(mode);
      const code = unverified ? 'WINDOWS_ACCEPTANCE_LEGACY_FILESYSTEM_PROCESS_REMAINS'
        : mode === 'failed' ? 'WINDOWS_ACCEPTANCE_PROFILE_ROOT_INVALID' : 'WINDOWS_ACCEPTANCE_LEGACY_FILESYSTEM_FAILED';
      await assert.rejects(runtime.inventoryProfile('synthetic'), { message: code });
      assert.deepEqual(runtime.outcome(), { filesystemProcessAbsent: !unverified, filesystemOperation: 'inventory', filesystemErrorCode: code });
      if (unverified) {
        await assert.rejects(runtime.removeRunRoot('synthetic'), { message: code });
        assert.equal(calls, 1, 'uncertain process state must prevent further filesystem work');
      }
    }
  });
}

test('filesystem leaf preserves inventory bytes and removes only the exact private run root', async (t) => {
  const temp = await realpath(tmpdir());
  const root = await mkdtemp(join(temp, 'eky-windows-acceptance-v2-legacy-'));
  const appData = join(root, 'synthetic-appdata');
  const profile = join(appData, 'Eky');
  await mkdir(profile, { recursive: true });
  await writeFile(join(profile, 'fixture.txt'), 'synthetic');
  const runtime = createLegacyUpgradeFilesystemRuntime({ spawnProcess: (command, args, options) =>
    spawn(command, args, { ...options, env: { ...process.env, APPDATA: appData } }) });
  t.after(() => runtime.outcome().filesystemProcessAbsent ? rm(root, { recursive: true, force: true }) : undefined);
  assert.deepEqual(await runtime.inventoryProfile(profile), await createClosedDirectoryInventory(profile));
  assert.equal(await readFile(join(profile, 'fixture.txt'), 'utf8'), 'synthetic');
  await assert.rejects(runtime.removeRunRoot(profile), /LEGACY_FILESYSTEM_INVALID/);
  assert.equal((await lstat(profile)).isDirectory(), true);
  await runtime.removeRunRoot(root);
  await assert.rejects(lstat(root), { code: 'ENOENT' });
  assert.equal(runtime.outcome().filesystemProcessAbsent, true);
  assert.equal(runtime.outcome().filesystemOperation, 'remove', 'later successful removal cannot erase the first failure');
});

test('filesystem leaf rejects a linked run root without removing its target', async (t) => {
  const temp = await realpath(tmpdir());
  const root = await mkdtemp(join(temp, 'eky-windows-acceptance-v2-legacy-'));
  const alias = await mkdtemp(join(temp, 'eky-windows-acceptance-v2-legacy-'));
  const runtime = createLegacyUpgradeFilesystemRuntime();
  t.after(async () => {
    if (!runtime.outcome().filesystemProcessAbsent) return;
    await rm(alias, { recursive: true, force: true });
    await rm(root, { recursive: true, force: true });
  });
  await rm(alias, { recursive: true });
  await writeFile(join(root, 'sentinel'), 'synthetic');
  await symlink(root, alias, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(runtime.removeRunRoot(alias), /LEGACY_FILESYSTEM_INVALID/);
  assert.equal(await readFile(join(root, 'sentinel'), 'utf8'), 'synthetic');
  assert.equal(runtime.outcome().filesystemProcessAbsent, true);
});
