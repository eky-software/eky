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
      expect(Object.keys(selection)).toEqual(['mode', 'assertCurrent']);
      expect(selection.mode).toBe(published ? 'workspaceReplacement' : 'legacyUnbound');
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
    const selection = await captureWorkspaceBackupReplacementStartupBinding(f.input, f.owner, { workspaceReplacement: fileSystem });
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
    const selection = await captureWorkspaceBackupReplacementStartupBinding(f.input, f.owner, { workspaceReplacement: fileSystem });
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
      { ...f.owner, assertAuthority: async () => {} }, { workspaceReplacement: fileSystem })).rejects.toThrow('WORKSPACE_REPLACEMENT_RECOVERY_REQUIRED');
    expect(read).not.toHaveBeenCalled();
  });

  for (const sourceWorkspaceId of [null, '77777777-7777-4777-8777-777777777777']) {
    it(`pins the migration owner with source=${sourceWorkspaceId}`, async context => {
      const f = await fixture(context, false);
      await publishMigration(f);
      const before = await snapshot(f.root);
      const selection = await captureWorkspaceBackupReplacementStartupBinding({ ...f.input,
        switchContext: { operationId, sourceWorkspaceId, targetWorkspaceId: workspaceId },
      }, f.owner);
      expect(selection.mode).toBe('workspaceActivationMigration');
      await selection.assertCurrent(f.owner);
      expect(await snapshot(f.root)).toEqual(before);
    });
  }

  for (const mismatch of ['missingSwitch', 'foreignOperation', 'foreignTarget', 'sameSource', 'foreignLineage', 'foreignWorkspace'] as const) {
    it(`rejects a migration with ${mismatch} without changing evidence`, async context => {
      const f = await fixture(context, false);
      await publishMigration(f);
      const foreignId = '77777777-7777-4777-8777-777777777777';
      const before = await snapshot(f.root);
      await expect(captureWorkspaceBackupReplacementStartupBinding({ ...f.input,
        ...(mismatch === 'foreignLineage' ? { lineageIdentity: { formatVersion: 1, profileId: 'd'.repeat(64) } } : {}),
        ...(mismatch === 'foreignWorkspace' ? { workspaceId: foreignId } : {}),
        ...(mismatch === 'missingSwitch' ? {} : { switchContext: {
          operationId: mismatch === 'foreignOperation' ? foreignId : operationId,
          sourceWorkspaceId: mismatch === 'sameSource' ? workspaceId : null,
          targetWorkspaceId: mismatch === 'foreignTarget' ? foreignId : workspaceId,
        } }),
      }, f.owner)).rejects.toThrow('WORKSPACE_REPLACEMENT_RECOVERY_REQUIRED');
      expect(await snapshot(f.root)).toEqual(before);
    });
  }

  it('rejects both published owners instead of choosing the first', async context => {
    const f = await fixture(context, true);
    await publishMigration(f);
    const before = await snapshot(f.root);
    await expect(captureWorkspaceBackupReplacementStartupBinding({ ...f.input,
      switchContext: { operationId, sourceWorkspaceId: null, targetWorkspaceId: workspaceId },
    }, f.owner)).rejects.toThrow('WORKSPACE_REPLACEMENT_RECOVERY_REQUIRED');
    expect(await snapshot(f.root)).toEqual(before);
  });

  for (const published of [false, true]) {
    it(`rejects a later migration owner after replacement published=${published}`, async context => {
      const f = await fixture(context, published);
      const selection = await captureWorkspaceBackupReplacementStartupBinding(f.input, f.owner);
      await publishMigration(f);
      const before = await snapshot(f.root);
      await expect(selection.assertCurrent(f.owner)).rejects.toThrow('WORKSPACE_REPLACEMENT_RECOVERY_REQUIRED');
      expect(await snapshot(f.root)).toEqual(before);
    });
  }

  for (const slot of ['current', 'next', 'backup'] as const) {
    it(`rejects an invalid migration ${slot} even when replacement is valid`, async context => {
      const f = await fixture(context, true);
      const paths = createWorkspaceRemnantBindingPaths(f.root, { owner: 'workspaceActivationMigration', operationId });
      await mkdir(paths.directoryPath, { recursive: true, mode: 0o700 });
      await writeFile(paths[`${slot}Path`], 'invalid\n', { mode: 0o600, flag: 'wx' });
      const before = await snapshot(f.root);
      await expect(captureWorkspaceBackupReplacementStartupBinding(f.input, f.owner)).rejects.toThrow();
      expect(await snapshot(f.root)).toEqual(before);
    });
  }

  for (const slot of ['next', 'backup'] as const) {
    it(`rejects migration ${slot}-only without repair or legacy fallback`, async context => {
      const f = await fixture(context, false);
      const paths = await publishMigration(f);
      await rename(paths.currentPath, paths[`${slot}Path`]);
      const before = await snapshot(f.root);
      await expect(captureWorkspaceBackupReplacementStartupBinding({ ...f.input,
        switchContext: { operationId, sourceWorkspaceId: null, targetWorkspaceId: workspaceId },
      }, f.owner)).rejects.toThrow();
      expect(await snapshot(f.root)).toEqual(before);
    });
  }

  it('allows an unregistered legacy selection only when both bindings are absent', async context => {
    const f = await fixture(context, false);
    const selection = await captureWorkspaceBackupReplacementStartupBinding({ ...f.input, lineageIdentity: undefined }, f.owner);
    expect(selection.mode).toBe('legacyUnbound');
    await selection.assertCurrent(f.owner);
    await f.store.publish(f.value, f.owner);
    const before = await snapshot(f.root);
    await expect(selection.assertCurrent(f.owner)).rejects.toThrow('WORKSPACE_REPLACEMENT_RECOVERY_REQUIRED');
    await expect(captureWorkspaceBackupReplacementStartupBinding({ ...f.input, lineageIdentity: undefined }, f.owner))
      .rejects.toThrow('WORKSPACE_REPLACEMENT_RECOVERY_REQUIRED');
    expect(await snapshot(f.root)).toEqual(before);
  });

  it('captures migration switch selection before caller mutation', async context => {
    const f = await fixture(context, false);
    await publishMigration(f);
    const switchContext: { operationId: string; sourceWorkspaceId: string | null; targetWorkspaceId: string } =
      { operationId, sourceWorkspaceId: null, targetWorkspaceId: workspaceId };
    const pending = captureWorkspaceBackupReplacementStartupBinding({ ...f.input, switchContext }, f.owner);
    switchContext.operationId = '77777777-7777-4777-8777-777777777777';
    switchContext.targetWorkspaceId = switchContext.operationId;
    const selection = await pending;
    await selection.assertCurrent(f.owner);
    expect(selection.mode).toBe('workspaceActivationMigration');
  });

  for (const change of ['disappeared', 'sameBytesNewIdentity', 'sameValueNewBytes', 'newSideSlot', 'replacementAppeared'] as const) {
    it(`rejects migration ${change} and keeps evidence`, async context => {
      const f = await fixture(context, false);
      const paths = await publishMigration(f);
      const selection = await captureWorkspaceBackupReplacementStartupBinding({ ...f.input,
        switchContext: { operationId, sourceWorkspaceId: null, targetWorkspaceId: workspaceId },
      }, f.owner);
      if (change === 'replacementAppeared') await f.store.publish(f.value, f.owner);
      else if (change === 'disappeared' || change === 'sameBytesNewIdentity') {
        await rename(paths.currentPath, `${paths.currentPath}.preserved`);
        if (change === 'sameBytesNewIdentity') {
          await writeFile(paths.currentPath, serializeWorkspaceRemnantBinding({ ...f.value, owner: 'workspaceActivationMigration' }),
            { mode: 0o600, flag: 'wx' });
        }
      } else if (change === 'sameValueNewBytes') {
        await writeFile(paths.currentPath, ` ${await readFile(paths.currentPath, 'utf8')}`, { mode: 0o600 });
      } else {
        await writeFile(paths.backupPath, await readFile(paths.currentPath), { mode: 0o600, flag: 'wx' });
      }
      const before = await snapshot(f.root);
      await expect(selection.assertCurrent(f.owner)).rejects.toThrow('WORKSPACE_REPLACEMENT_RECOVERY_REQUIRED');
      expect(await snapshot(f.root)).toEqual(before);
    });
  }
});

async function publishMigration(f: Awaited<ReturnType<typeof fixture>>) {
  const value = captureWorkspaceRemnantBinding({ ...f.value, owner: 'workspaceActivationMigration' });
  const store = new WorkspaceRemnantBindingStore(f.root, { owner: value.owner, operationId });
  await store.publish(value, f.owner);
  return createWorkspaceRemnantBindingPaths(f.root, { owner: value.owner, operationId });
}

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
