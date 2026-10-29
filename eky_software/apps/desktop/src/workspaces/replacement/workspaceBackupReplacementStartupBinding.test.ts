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
import { captureWorkspaceBackupReplacementStartupBinding, captureWorkspaceBackupReplacementStartupSelection } from './workspaceBackupReplacementStartupBinding.js';
import { WorkspaceRegistryStore } from '../registry/workspaceRegistryStore.js';
import { WORKSPACE_REGISTRY_FILE_NAME } from '../registry/workspaceRegistryPaths.js';
import { serializeWorkspaceRegistry } from '../registry/workspaceRegistrySerializer.js';
import { WorkspaceSwitchJournalStore, createWorkspaceSwitchJournalPaths, serializeVersionedWorkspaceSwitchJournal } from '../switch/workspaceSwitchJournal.js';
import { createWorkspaceSelectorSwitchJournal } from '../switch/workspaceSelectorSwitchState.js';
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

describe('workspace replacement startup metadata selection', () => {
  it('brackets each readonly binding observation with fresh metadata without caching across calls', async context => {
    const f = await selectionFixture(context, true);
    const registryRead = vi.spyOn(f.registry, 'inspectSlots');
    const switchRead = vi.spyOn(f.sources.switchJournal, 'inspectSlots');
    const before = await snapshot(f.root);
    const selected = await f.capture();
    expect(registryRead).toHaveBeenCalledTimes(2);
    expect(switchRead).toHaveBeenCalledTimes(2);
    for (const count of [4, 6]) {
      await selected.assertCurrent(f.owner.assertAuthority);
      expect(registryRead).toHaveBeenCalledTimes(count);
      expect(switchRead).toHaveBeenCalledTimes(count);
    }
    expect(await snapshot(f.root)).toEqual(before);
  });

  for (const initial of [true, false]) {
    for (const kind of ['registry', 'switch'] as const) {
      for (const bindingRead of [1, 2]) {
        it(`rejects ${kind} changed during binding read ${bindingRead}, initial=${initial}`, async context => {
          const f = await selectionFixture(context, true);
          const selected = initial ? undefined : await f.capture();
          const inspect = WorkspaceRemnantBindingStore.prototype.inspect;
          let reads = 0;
          let changedFiles: readonly unknown[] | undefined;
          const spy = vi.spyOn(WorkspaceRemnantBindingStore.prototype, 'inspect')
            .mockImplementation(async function (this: WorkspaceRemnantBindingStore, authority) {
              const value = await inspect.call(this, authority);
              if (++reads === bindingRead) {
                if (kind === 'registry') {
                  await writeFile(join(f.root, WORKSPACE_REGISTRY_FILE_NAME),
                    serializeWorkspaceRegistry({ ...f.registryValue, workspaces: f.registryValue.workspaces.map(entry =>
                      ({ ...entry, workspaceLabel: 'Changed synthetic company' })) }));
                } else {
                  const paths = createWorkspaceSwitchJournalPaths(f.root);
                  await mkdir(paths.directoryPath, { recursive: true });
                  await writeFile(paths.currentPath, serializeVersionedWorkspaceSwitchJournal({ formatVersion: 1, operationId,
                    sourceWorkspaceId: '99999999-9999-4999-8999-999999999999', targetWorkspaceId: workspaceId,
                    state: 'targetSelected', createdAt: '2026-10-29T00:00:00.000Z' }), { flag: 'wx' });
                }
                changedFiles = await snapshot(f.root);
              }
              return value;
            });
          try {
            await expect(selected === undefined ? f.capture() : selected.assertCurrent(f.owner.assertAuthority))
              .rejects.toThrow('WORKSPACE_REPLACEMENT_RECOVERY_REQUIRED');
            expect(changedFiles).toBeDefined();
            expect(await snapshot(f.root)).toEqual(changedFiles);
            if (selected !== undefined) {
              await expect(selected.assertCurrent(f.owner.assertAuthority)).rejects.toThrow('WORKSPACE_REPLACEMENT_RECOVERY_REQUIRED');
            }
          } finally { spy.mockRestore(); }
        });
      }
    }
  }

  for (const failingRead of [1, 2]) {
    it(`keeps the first failure of metadata bracket ${failingRead} terminal after the source recovers`, async context => {
      const f = await selectionFixture(context, true);
      const inspect = f.registry.inspectSlots.bind(f.registry);
      const cause = new Error('SYNTHETIC_METADATA_READ_FAILED');
      let reads = 0;
      let fail = false;
      const spy = vi.spyOn(f.registry, 'inspectSlots').mockImplementation(async authority => {
        if (fail && ++reads === failingRead) throw cause;
        return inspect(authority);
      });
      const selected = await f.capture();
      const before = await snapshot(f.root);
      fail = true;
      await expect(selected.assertCurrent(f.owner.assertAuthority)).rejects.toBe(cause);
      fail = false;
      const calls = spy.mock.calls.length;
      await expect(selected.assertCurrent(f.owner.assertAuthority)).rejects.toThrow('WORKSPACE_REPLACEMENT_RECOVERY_REQUIRED');
      expect(spy).toHaveBeenCalledTimes(calls);
      expect(await snapshot(f.root)).toEqual(before);
    });
  }

  for (const interruption of ['overlap', 'close', 'phaseLoss'] as const) {
    it(`joins the final metadata read on ${interruption} before returning`, async context => {
      const f = await selectionFixture(context, true);
      const entered = gate();
      const finish = gate();
      const inspect = f.registry.inspectSlots.bind(f.registry);
      let reads = 0;
      let delay = false;
      let current = true;
      let settled = false;
      const cause = new Error('SYNTHETIC_PHASE_LOST');
      vi.spyOn(f.registry, 'inspectSlots').mockImplementation(async authority => {
        const value = await inspect(authority);
        if (delay && ++reads === 2) { entered.resolve(); await finish.promise; }
        return value;
      });
      const selected = await f.capture();
      const before = await snapshot(f.root);
      const guard = () => { f.owner.assertAuthority(); if (!current) throw cause; };
      delay = true;
      const pending = selected.assertCurrent(guard);
      const outcome = pending.then(() => { settled = true; return undefined; }, error => { settled = true; return error; });
      try {
        await entered.promise;
        await expect(selected.assertCurrent(guard)).rejects.toThrow('WORKSPACE_REPLACEMENT_RECOVERY_REQUIRED');
        expect(reads).toBe(2);
        if (interruption === 'close') selected.close();
        if (interruption === 'phaseLoss') current = false;
        expect(settled).toBe(false);
      } finally { finish.resolve(); }
      const result = await outcome;
      if (interruption === 'overlap') {
        expect(result).toBeUndefined();
        await selected.assertCurrent(guard);
      } else {
        if (interruption === 'phaseLoss') expect(result).toBe(cause);
        else expect(result).toMatchObject({ message: 'WORKSPACE_REPLACEMENT_RECOVERY_REQUIRED' });
        current = true;
        await expect(selected.assertCurrent(guard)).rejects.toThrow('WORKSPACE_REPLACEMENT_RECOVERY_REQUIRED');
      }
      expect(await snapshot(f.root)).toEqual(before);
    });
  }

  it.for([false, true])('pins the selected registry and absent switch with binding published=%s', async (published, context) => {
    const f = await selectionFixture(context, published);
    const before = await snapshot(f.root);
    const selected = await f.capture();
    await selected.assertCurrent(f.owner.assertAuthority);
    expect(selected.mode).toBe(published ? 'workspaceReplacement' : 'legacyUnbound');
    expect(await snapshot(f.root)).toEqual(before);
    selected.close();
    await expect(selected.assertCurrent(f.owner.assertAuthority)).rejects.toThrow();
  });

  it('accepts a new phase owner without retaining the capture lease', async context => {
    const f = await selectionFixture(context, true);
    const selected = await f.capture();
    await f.held.release();
    const next = await f.maintenance.acquire('restore');
    try {
      await selected.assertCurrent(f.maintenance.captureCurrentOwner(['restore'], next));
    } finally { await next.release(); }
    await expect(selected.assertCurrent(f.owner.assertAuthority)).rejects.toThrow();
  });

  it.for(['active', 'lineage', 'notReady'] as const)('rejects a changed initial registered %s before granting a selection', async (change, context) => {
    const f = await selectionFixture(context, true);
    await f.registry.write({ ...f.registryValue,
      ...(change === 'active' ? { formatVersion: 2, activeWorkspaceId: null } : {}),
      workspaces: f.registryValue.workspaces.map(entry => ({ ...entry,
        ...(change === 'lineage' ? { lineageIdentity: { formatVersion: 1, profileId: 'e'.repeat(64) } }
          : change === 'notReady' ? { lifecycleState: 'recoveryRequired' } : {}),
      })),
      ...(change === 'notReady' ? { formatVersion: 2, activeWorkspaceId: null } : {}),
    });
    const before = await snapshot(f.root);
    await expect(f.capture()).rejects.toThrow('WORKSPACE_REPLACEMENT_RECOVERY_REQUIRED');
    expect(await snapshot(f.root)).toEqual(before);
  });

  for (const kind of ['registry', 'switch'] as const) {
    for (const slot of ['current', 'next', 'backup'] as const) {
      it(`rejects ${kind} ${slot} changes and keeps all bytes`, async context => {
        const f = await selectionFixture(context, true);
        const selected = await f.capture();
        const switchPaths = createWorkspaceSwitchJournalPaths(f.root);
        const registryPath = join(f.root, `${WORKSPACE_REGISTRY_FILE_NAME}${slot === 'current' ? '' : `.${slot}`}`);
        const path = kind === 'registry' ? registryPath : switchPaths[`${slot}Path`];
        if (kind === 'switch') await mkdir(switchPaths.directoryPath, { recursive: true });
        if (kind === 'registry' && slot === 'current') await rename(path, `${path}.preserved`);
        const bytes = kind === 'registry' ? serializeWorkspaceRegistry(f.registryValue)
          : serializeVersionedWorkspaceSwitchJournal({ formatVersion: 1, operationId,
            sourceWorkspaceId: '99999999-9999-4999-8999-999999999999', targetWorkspaceId: workspaceId,
            state: 'targetSelected', createdAt: '2026-10-29T00:00:00.000Z' });
        await writeFile(path, bytes, { flag: 'wx' });
        const before = await snapshot(f.root);
        await expect(selected.assertCurrent(f.owner.assertAuthority)).rejects.toThrow();
        await expect(selected.assertCurrent(f.owner.assertAuthority)).rejects.toThrow();
        expect(await snapshot(f.root)).toEqual(before);
      });
    }
  }

  it('uses the captured source-null migration context without changing switch or registry', async context => {
    const f = await selectionFixture(context, false);
    await publishMigration(f);
    const journal = createWorkspaceSelectorSwitchJournal({ ...f.registryValue, formatVersion: 2, activeWorkspaceId: null },
      workspaceId, operationId, '2026-10-29T00:00:00.000Z');
    await f.registry.write({ ...f.registryValue, formatVersion: 2 });
    const paths = createWorkspaceSwitchJournalPaths(f.root);
    await mkdir(paths.directoryPath, { recursive: true });
    await writeFile(paths.currentPath, serializeVersionedWorkspaceSwitchJournal({ ...journal, state: 'targetSelected' }));
    const switchContext: { operationId: string; sourceWorkspaceId: null; targetWorkspaceId: string } =
      { operationId, sourceWorkspaceId: null, targetWorkspaceId: workspaceId };
    const before = await snapshot(f.root);
    const pending = captureWorkspaceBackupReplacementStartupSelection({ ...f.input, mode: 'targetValidation', switchContext },
      f.owner.assertAuthority, f.sources);
    switchContext.operationId = '77777777-7777-4777-8777-777777777777';
    const selected = await pending;
    expect(selected.mode).toBe('workspaceActivationMigration');
    await selected.assertCurrent(f.owner.assertAuthority);
    expect(await snapshot(f.root)).toEqual(before);
  });

  it('keeps an original registry observation joined after phase cancellation', async context => {
    const f = await selectionFixture(context, true);
    const entered = gate();
    const finish = gate();
    const inspect = f.registry.inspectSlots.bind(f.registry);
    vi.spyOn(f.registry, 'inspectSlots').mockImplementationOnce(async assertCurrent => {
      const value = await inspect(assertCurrent);
      entered.resolve();
      await finish.promise;
      return value;
    });
    const switchRead = vi.spyOn(f.sources.switchJournal, 'inspectSlots');
    let current = true;
    let settled = false;
    const original = captureWorkspaceBackupReplacementStartupSelection({ ...f.input, mode: 'normal' },
      () => { if (!current) throw new Error('synthetic cancelled phase'); }, f.sources);
    const result = original.then(() => { settled = true; return 'completed'; }, () => { settled = true; return 'failed'; });
    await entered.promise;
    current = false;
    try { expect(settled).toBe(false); expect(switchRead).not.toHaveBeenCalled(); }
    finally { finish.resolve(); }
    expect(await result).toBe('failed');
    expect(switchRead).not.toHaveBeenCalled();
  });
});

function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>(yes => { resolve = yes; });
  return { promise, resolve };
}

async function selectionFixture(context: TestContext, published: boolean) {
  const f = await fixture(context, published);
  const registry = new WorkspaceRegistryStore({ installationRoot: f.root, filePath: join(f.root, WORKSPACE_REGISTRY_FILE_NAME) });
  const registryValue = { formatVersion: 1 as const, activeWorkspaceId: workspaceId, workspaces: [{
    workspaceId, workspaceLabel: 'Synthetic company', lineageIdentity: { formatVersion: 1 as const, profileId },
    layoutVersion: 1 as const, lifecycleState: 'ready' as const, createdAt: '2026-10-29T00:00:00.000Z',
  }] };
  await registry.write(registryValue);
  const sources = { registry, switchJournal: new WorkspaceSwitchJournalStore(f.root) };
  return { ...f, registry, registryValue, sources,
    capture: () => captureWorkspaceBackupReplacementStartupSelection({ ...f.input, mode: 'normal' }, f.owner.assertAuthority, sources),
  };
}

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
