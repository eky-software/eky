import { expect, it, vi } from 'vitest';
import { importBindingGate as gate } from './workspaceBackupImportBindingTestSupport.js';
import { createWorkspaceBackupImportCoordinatorFixture as fixture,
  TEST_IMPORT_CONTAINER_PATH, TEST_IMPORT_PASSWORD } from './workspaceBackupImportTestSupport.js';
import type { WorkspaceBackupImportOwner } from './workspaceBackupImportOwner.js';
import { WorkspaceBackupImportError } from './workspaceBackupImportError.js';

const input = { workspaceLabel: 'Imported synthetic', containerPath: TEST_IMPORT_CONTAINER_PATH, password: TEST_IMPORT_PASSWORD };

it('captures generation before journal I/O and checks physical ownership only after the runtime stops', async () => {
  const f: ReturnType<typeof fixture> = fixture({ decorateOwner(owner) {
    return { ...owner, assertMainCurrent() {
      expect(f.lifecycle.runningRuntimeOwners).toBe(0);
      expect(f.lifecycle.openDatabaseHandleOwners).toBe(0);
      owner.assertMainCurrent();
    } };
  } });
  await f.coordinator.import(input);
  expect(f.events.slice(0, 3)).toEqual(['lease.acquire.import', 'owner.capture', 'journal.inspect']);
  expect(f.events.indexOf('binding.publish')).toBeLessThan(f.events.indexOf('root.createCandidate'));
  expect(f.events.indexOf('binding.clear')).toBeLessThan(f.events.indexOf('journal.remove'));
  expect(f.events.indexOf('journal.remove')).toBeLessThan(f.events.indexOf('lease.release'));
  expect(f.events.indexOf('lease.release')).toBeLessThan(f.events.indexOf('owner.terminal'));
});

it('captures callbacks before the first journal read rather than following mutable owner methods', async () => {
  let captured!: WorkspaceBackupImportOwner;
  const f = fixture({ decorateOwner(owner) { captured = { ...owner }; return captured; } });
  const inspect = f.journal.inspectSlots.bind(f.journal);
  vi.spyOn(f.journal, 'inspectSlots').mockImplementationOnce(async (...args) => {
    captured.assertCurrent = () => { throw new Error('REPLACED_OWNER_METHOD'); };
    return inspect(...args);
  });
  await expect(f.coordinator.import(input)).resolves.toHaveProperty('workspaceId');
  expect(f.events).not.toContain('owner.uncertain');
});

it('does not poison a known preflight failure or block the next clean attempt', async () => {
  const f = fixture(); f.container.failInspect = true;
  await expect(f.coordinator.import(input)).rejects.toMatchObject({ code: 'WORKSPACE_IMPORT_BACKUP_FAILED', stage: 'backupPreflight' });
  expect(f.events).not.toContain('owner.uncertain');
  expect(f.events).not.toContain('lifecycle.quiesce');
  expect(f.lease.held).toBe(false);
  f.container.failInspect = false;
  await expect(f.coordinator.import(input)).resolves.toHaveProperty('workspaceId');
});

it('rejects a journal receipt replaced before readback without creating payload or adopting the new identity', async () => {
  const f = fixture();
  const write = f.journal.writeSelected.bind(f.journal);
  vi.spyOn(f.journal, 'writeSelected').mockImplementationOnce(async (...args) => {
    const receipt = await write(...args); f.journal.revision++; return receipt;
  });
  await expect(f.coordinator.import(input)).rejects.toMatchObject({ code: 'WORKSPACE_IMPORT_JOURNAL_FAILED', stage: 'journal' });
  expect(f.journal.current?.state).toBe('prepared');
  expect(f.events).not.toContain('binding.publish');
  expect(f.events).not.toContain('root.createCandidate');
  expect(f.events).not.toContain('journal.discard');
  expect(f.events).toContain('owner.uncertain');
  expect(f.lifecycle.runningRuntimeOwners).toBe(0);
});

it('joins started backup work before release and refuses cleanup after its owner expires', async () => {
  let current = true;
  const f = fixture({ decorateOwner(owner) { return { ...owner, assertCurrent() {
    owner.assertCurrent(); if (!current) throw new Error('SYNTHETIC_IMPORT_GENERATION_EXPIRED');
  } }; } });
  const entered = gate(); const finish = gate();
  const stage = f.container.stage.bind(f.container);
  vi.spyOn(f.container, 'stage').mockImplementationOnce(async value => {
    const result = await stage(value); entered.resolve(); await finish.promise; return result;
  });
  let settled = false;
  const pending = f.coordinator.import(input).then(() => undefined, error => error as unknown).finally(() => { settled = true; });
  let result: unknown;
  try {
    await Promise.race([entered.promise, pending.then(() => { throw new Error('STAGE_NOT_ENTERED'); })]);
    current = false;
    expect(f.lease.held).toBe(true); expect(settled).toBe(false);
  } finally { finish.resolve(); result = await pending; }
  expect(result).toMatchObject({ code: 'WORKSPACE_IMPORT_RECOVERY_REQUIRED', cause: { message: 'SYNTHETIC_IMPORT_GENERATION_EXPIRED' } });
  expect(f.lease.held).toBe(false);
  expect(f.journal.current?.state).toBe('candidateRootCreated');
  expect(f.root.candidateExists).toBe(true);
  expect(f.events).not.toContain('root.discardCandidate');
  expect(f.events).not.toContain('owner.terminal');
  expect(f.lifecycle.ensureCalls).toBe(0);
});

it('does not complete a queued return after a lost release acknowledgement', async () => {
  const f = fixture(); f.lease.failRelease = true;
  await expect(f.coordinator.import(input)).rejects.toMatchObject({ code: 'WORKSPACE_IMPORT_LIFECYCLE_FAILED', stage: 'lease' });
  expect(f.journal.current).toBeUndefined();
  expect(f.registry.value?.workspaces).toHaveLength(2);
  expect(f.lifecycle.ensureCalls).toBe(1);
  expect(f.lifecycle.runningRuntimeOwners).toBe(0);
  expect(f.events).not.toContain('owner.terminal');
  expect(f.events).toContain('owner.uncertain');
});

it('preserves evidence and blocks return when plaintext cleanup has an uncertain outcome', async () => {
  const f = fixture();
  const primary = new WorkspaceBackupImportError('WORKSPACE_IMPORT_RECOVERY_REQUIRED', 'plaintextQuarantine');
  vi.spyOn(f.container, 'stage').mockRejectedValueOnce(primary);
  await expect(f.coordinator.import(input)).rejects.toBe(primary);
  expect(f.journal.current?.state).toBe('candidateRootCreated');
  expect(f.root.candidateExists).toBe(true);
  expect(f.events).not.toContain('root.discardCandidate');
  expect(f.events).not.toContain('binding.clear');
  expect(f.events).not.toContain('owner.terminal');
  expect(f.events).toContain('owner.uncertain');
  expect(f.lifecycle.ensureCalls).toBe(0);
});

it.each(['journal', 'registry'] as const)('preserves the initial %s authority error through the store conversion', async target => {
  let current = true;
  const primary = new Error('SYNTHETIC_INITIAL_GENERATION_EXPIRED');
  const f = fixture({ decorateOwner(owner) { return { ...owner, assertCurrent() {
    owner.assertCurrent(); if (!current) throw primary;
  } }; } });
  const store = target === 'journal' ? f.journal : f.registry;
  vi.spyOn(store, 'inspectSlots').mockImplementationOnce(async assertAuthority => {
    current = false;
    try { assertAuthority?.(); } catch { throw new Error('SYNTHETIC_GENERIC_STORE_ERROR'); }
    throw new Error('AUTHORITY_NOT_CHECKED');
  });
  await expect(f.coordinator.import(input)).rejects.toMatchObject({ cause: primary });
  expect(f.events).not.toContain('root.createCandidate');
  expect(f.events).toContain('owner.uncertain');
  expect(f.lifecycle.ensureCalls).toBe(0);
  expect(f.lease.held).toBe(false);
});

it('reports a late terminal-owner failure separately from successful lease release', async () => {
  const f = fixture({ decorateOwner(owner) { return { ...owner,
    onTerminalAfterRelease() { throw new Error('SYNTHETIC_LATE_MAIN_OWNER'); },
  }; } });
  await expect(f.coordinator.import(input)).rejects.toMatchObject({
    code: 'WORKSPACE_IMPORT_LIFECYCLE_FAILED', stage: 'activeRuntimeRestart', cause: { message: 'SYNTHETIC_LATE_MAIN_OWNER' },
  });
  expect(f.lease.held).toBe(false);
  expect(f.lifecycle.runningRuntimeOwners).toBe(0);
  expect(f.events).toContain('owner.uncertain');
});
