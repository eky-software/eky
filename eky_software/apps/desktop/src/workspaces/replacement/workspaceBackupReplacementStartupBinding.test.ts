import { chmod, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi, type TestContext } from 'vitest';
import { captureWorkspaceRemnantBinding, maximumWorkspaceRemnantBindingBytes,
  serializeWorkspaceRemnantBinding } from '../deletion/workspaceRemnantBindingCodec.js';
import { createWorkspaceRemnantBindingPaths } from '../deletion/workspaceRemnantBindingPaths.js';
import { WorkspaceRemnantBindingStore } from '../deletion/workspaceRemnantBindingStore.js';
import { InMemoryWorkspaceMaintenanceLease } from '../maintenance/workspaceMaintenanceLease.js';
import { createNodeCrashSafeFileSlotFileSystem } from '../persistence/crashSafeFileSlot.js';
import { captureWorkspaceBackupReplacementStartupBinding } from './workspaceBackupReplacementStartupBinding.js';
import { TEST_REPLACEMENT_OPERATION_ID as operationId, TEST_REPLACEMENT_WORKSPACE_ID as workspaceId,
  TEST_REPLACEMENT_PROFILE_ID as profileId } from './workspaceBackupReplacementTestSupport.js';

describe('workspace replacement startup binding observation', () => {
  for (const published of [false, true]) {
    it(`pins published=${published} without writing or granting cleanup`, async context => {
      const f = await fixture(context, published);
      const before = await snapshot(f.root);
      const selection = await captureWorkspaceBackupReplacementStartupBinding(f.input, f.owner);
      await selection.assertCurrent(f.owner);
      expect(Object.keys(selection)).toEqual(['assertCurrent']);
      expect(await snapshot(f.root)).toEqual(before);
      await expect(readFile(f.payload, 'utf8')).resolves.toBe('preserved payload');
    });
  }

  it('uses a fresh owner in each phase without reviving a previous lease', async context => {
    const f = await fixture(context, true);
    const selection = await captureWorkspaceBackupReplacementStartupBinding(f.input, f.owner);
    await f.held.release();
    const lease = await f.maintenance.acquire('restore');
    const assertCurrent = f.maintenance.captureCurrentOwner(['restore'], lease);
    try {
      await selection.assertCurrent({ assertAuthority: assertCurrent, assertExternalSelection: async () => { assertCurrent(); } });
    } finally { await lease.release(); }
  });

  for (const field of ['workspaceId', 'lineageIdentity', 'owner', 'operationId'] as const) {
    it(`rejects the wrong ${field} in a valid stored record without repairing it`, async context => {
      const f = await fixture(context, true);
      const wrong = captureWorkspaceRemnantBinding({ ...f.value,
        ...(field === 'workspaceId' ? { workspaceId: '99999999-9999-4999-8999-999999999999' }
          : field === 'lineageIdentity' ? { lineageIdentity: { formatVersion: 1, profileId: 'e'.repeat(64) } }
            : field === 'owner' ? { owner: 'workspaceActivationMigration' }
              : { operationId: '88888888-8888-4888-8888-888888888888' }),
      });
      await writeFile(f.paths.currentPath, serializeWorkspaceRemnantBinding(wrong), { mode: 0o600 });
      const before = await snapshot(f.root);
      await expect(captureWorkspaceBackupReplacementStartupBinding(f.input, f.owner)).rejects.toThrow(
        field === 'owner' || field === 'operationId' ? 'WORKSPACE_REMNANT_BINDING_INVALID' : 'WORKSPACE_REPLACEMENT_RECOVERY_REQUIRED',
      );
      expect(await snapshot(f.root)).toEqual(before);
    });
  }

  it('captures the expected target before callers mutate their input', async context => {
    const f = await fixture(context, true);
    const pending = captureWorkspaceBackupReplacementStartupBinding(f.input, f.owner);
    f.input.lineageIdentity.profileId = 'f'.repeat(64);
    const selection = await pending;
    await selection.assertCurrent(f.owner);
    expect(JSON.parse(await readFile(f.paths.currentPath, 'utf8')).lineageIdentity.profileId).toBe(profileId);
  });

  it('joins an in-flight observation and rejects overlapping reads', async context => {
    const f = await fixture(context, true);
    const fileSystem = createNodeCrashSafeFileSlotFileSystem(f.paths, maximumWorkspaceRemnantBindingBytes);
    const read = fileSystem.readSlot.bind(fileSystem);
    let release!: () => void;
    let entered!: () => void;
    const enteredRead = new Promise<void>(resolve => { entered = resolve; });
    const pendingRead = new Promise<void>(resolve => { release = resolve; });
    let delay = false;
    let readFinished = false;
    fileSystem.readSlot = async (...args) => {
      const bytes = await read(...args);
      if (delay) { entered(); await pendingRead; readFinished = true; }
      return bytes;
    };
    const selection = await captureWorkspaceBackupReplacementStartupBinding(f.input, f.owner, fileSystem);
    delay = true;
    const checking = selection.assertCurrent(f.owner);
    try {
      await enteredRead;
      await expect(selection.assertCurrent(f.owner)).rejects.toThrow('WORKSPACE_REPLACEMENT_RECOVERY_REQUIRED');
      expect(readFinished).toBe(false);
    } finally { release(); }
    await checking;
    expect(readFinished).toBe(true);
  });

  for (const change of ['appeared', 'disappeared', 'sameBytesNewIdentity', 'sameValueNewBytes', 'newSideSlot'] as const) {
    it(`rejects ${change} and retains all files on subsequent checks`, async context => {
      const f = await fixture(context, change !== 'appeared');
      const selection = await captureWorkspaceBackupReplacementStartupBinding(f.input, f.owner);
      if (change === 'appeared') {
        await mkdir(f.paths.directoryPath, { recursive: true, mode: 0o700 });
        await writeFile(f.paths.currentPath, serializeWorkspaceRemnantBinding(f.value), { mode: 0o600 });
      } else if (change === 'disappeared' || change === 'sameBytesNewIdentity') {
        await rename(f.paths.currentPath, `${f.paths.currentPath}.preserved`);
        if (change === 'sameBytesNewIdentity') {
          await writeFile(f.paths.currentPath, serializeWorkspaceRemnantBinding(f.value), { mode: 0o600, flag: 'wx' });
        }
      } else if (change === 'sameValueNewBytes') {
        await writeFile(f.paths.currentPath, ` ${serializeWorkspaceRemnantBinding(f.value).toString('utf8')}`, { mode: 0o600 });
      } else {
        await writeFile(f.paths.nextPath, serializeWorkspaceRemnantBinding(f.value), { mode: 0o600, flag: 'wx' });
      }
      const before = await snapshot(f.root);
      await expect(selection.assertCurrent(f.owner)).rejects.toThrow('WORKSPACE_REPLACEMENT_RECOVERY_REQUIRED');
      await expect(selection.assertCurrent(f.owner)).rejects.toThrow('WORKSPACE_REPLACEMENT_RECOVERY_REQUIRED');
      expect(await snapshot(f.root)).toEqual(before);
    });
  }

  for (const slot of ['next', 'backup'] as const) {
    it(`pins a valid current and matching ${slot} without removing either`, async context => {
      const f = await fixture(context, true);
      await writeFile(f.paths[`${slot}Path`], serializeWorkspaceRemnantBinding(f.value), { mode: 0o600, flag: 'wx' });
      const selection = await captureWorkspaceBackupReplacementStartupBinding(f.input, f.owner);
      const before = await snapshot(f.root);
      await selection.assertCurrent(f.owner);
      expect(await snapshot(f.root)).toEqual(before);
      await rename(f.paths[`${slot}Path`], `${f.paths[`${slot}Path`]}.preserved`);
      await expect(selection.assertCurrent(f.owner)).rejects.toThrow('WORKSPACE_REPLACEMENT_RECOVERY_REQUIRED');
    });

    it(`rejects ${slot}-only state without adopting it as a published record`, async context => {
      const f = await fixture(context, true);
      await rename(f.paths.currentPath, f.paths[`${slot}Path`]);
      const before = await snapshot(f.root);
      await expect(captureWorkspaceBackupReplacementStartupBinding(f.input, f.owner)).rejects.toThrow();
      expect(await snapshot(f.root)).toEqual(before);
    });
  }

  it('rejects authority loss during a read, joins its close and remains invalid', async context => {
    const f = await fixture(context, true);
    const fileSystem = createNodeCrashSafeFileSlotFileSystem(f.paths, maximumWorkspaceRemnantBindingBytes);
    const read = fileSystem.readSlot.bind(fileSystem);
    let loseOwner = false;
    fileSystem.readSlot = async (...args) => {
      const bytes = await read(...args);
      if (loseOwner) await f.held.release();
      return bytes;
    };
    const selection = await captureWorkspaceBackupReplacementStartupBinding(f.input, f.owner, fileSystem);
    loseOwner = true;
    const before = await snapshot(f.root);
    await expect(selection.assertCurrent(f.owner)).rejects.toThrow('WORKSPACE_MAINTENANCE_BUSY');
    expect(await snapshot(f.root)).toEqual(before);
    await expect(selection.assertCurrent(f.owner)).rejects.toThrow('WORKSPACE_REPLACEMENT_RECOVERY_REQUIRED');
  });

  it('does not replace a missing binding after external selection fails', async context => {
    const f = await fixture(context, false);
    const cause = new Error('SYNTHETIC_SELECTION_LOST');
    const selection = await captureWorkspaceBackupReplacementStartupBinding(f.input, f.owner);
    const before = await snapshot(f.root);
    await expect(selection.assertCurrent({ assertAuthority: f.owner.assertAuthority,
      async assertExternalSelection() { throw cause; },
    })).rejects.toBe(cause);
    expect(await snapshot(f.root)).toEqual(before);
  });

  it('rejects an async synchronous guard before reading any files', async context => {
    const f = await fixture(context, true);
    const fileSystem = createNodeCrashSafeFileSlotFileSystem(f.paths, maximumWorkspaceRemnantBindingBytes);
    const read = vi.spyOn(fileSystem, 'readSlot');
    await expect(captureWorkspaceBackupReplacementStartupBinding(f.input,
      { ...f.owner, assertAuthority: async () => {} }, fileSystem)).rejects.toThrow('WORKSPACE_REPLACEMENT_RECOVERY_REQUIRED');
    expect(read).not.toHaveBeenCalled();
  });
});

async function fixture(context: TestContext, published: boolean) {
  const root = await mkdtemp(join(tmpdir(), 'eky-replacement-startup-binding-'));
  await chmod(root, 0o700);
  context.onTestFinished(async () => { if (context.task.result?.state === 'pass') await rm(root, { recursive: true, force: true }); });
  const payload = join(root, 'payload');
  await writeFile(payload, 'preserved payload');
  const maintenance = new InMemoryWorkspaceMaintenanceLease();
  const publishingLease = await maintenance.acquire('replace');
  const assertPublisher = maintenance.captureCurrentOwner(['replace'], publishingLease);
  const value = captureWorkspaceRemnantBinding({ formatVersion: 1, owner: 'workspaceReplacement', operationId,
    workspaceId, lineageIdentity: { formatVersion: 1, profileId } });
  const store = new WorkspaceRemnantBindingStore(root, { owner: 'workspaceReplacement', operationId });
  try {
    if (published) await store.publish(value, { assertAuthority: assertPublisher,
      async assertExternalSelection() { assertPublisher(); } });
  } finally { await publishingLease.release(); }
  const held = await maintenance.acquire('restore');
  const assertOwner = maintenance.captureCurrentOwner(['restore'], held);
  context.onTestFinished(() => held.release());
  const owner = { assertAuthority: assertOwner, async assertExternalSelection() { assertOwner(); } };
  const paths = createWorkspaceRemnantBindingPaths(root, { owner: 'workspaceReplacement', operationId });
  const input = { userDataRoot: root, operationId, workspaceId, lineageIdentity: { formatVersion: 1, profileId } };
  return { root, payload, value, store, paths, maintenance, held, owner, input };
}

async function snapshot(root: string): Promise<readonly unknown[]> {
  const entries = await readdir(root, { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name));
  const result: unknown[] = [];
  for (const entry of entries) result.push([entry.name, entry.isDirectory()
    ? await snapshot(join(root, entry.name)) : await readFile(join(root, entry.name))]);
  return result;
}
