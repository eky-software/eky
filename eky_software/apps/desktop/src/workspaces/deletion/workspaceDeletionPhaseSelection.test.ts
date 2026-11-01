import { createHash } from 'node:crypto';
import { chmod, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi, type TestContext } from 'vitest';
import { sameCrashSafeFileSlotIdentity } from '../persistence/crashSafeFileSlot.js';
import { removeWorkspaceEntry } from '../registry/workspaceRegistryMutations.js';
import { WORKSPACE_REGISTRY_FILE_NAME } from '../registry/workspaceRegistryPaths.js';
import { serializeWorkspaceRegistry, workspaceRegistryEntrySha256 } from '../registry/workspaceRegistrySerializer.js';
import { WorkspaceRegistryStore } from '../registry/workspaceRegistryStore.js';
import { validateWorkspaceBackupReplacementOperationId } from '../replacement/workspaceBackupReplacementOperationId.js';
import { createSwitchRegistry, TEST_TARGET_WORKSPACE_ID } from '../switch/workspaceSwitchTestSupport.js';
import { deletionTestId, deletionTestJournal } from './workspaceDeletionDataTestSupport.js';
import { createWorkspaceDeletionFinalizer } from './workspaceDeletionFinalization.js';
import { captureWorkspaceDeletionJournal, serializeWorkspaceDeletionJournal,
  workspaceDeletionPhases, type WorkspaceDeletionJournalV1 } from './workspaceDeletionJournalCodec.js';
import { createWorkspaceDeletionJournalPaths, WorkspaceDeletionJournalStore } from './workspaceDeletionJournalStore.js';
import { createWorkspaceDeletionMetadataCleaner } from './workspaceDeletionMetadataCleanup.js';
import { createWorkspaceDeletionPayloadExecutor } from './workspaceDeletionPayloadExecutor.js';
import { captureWorkspaceDeletionPhaseSelection } from './workspaceDeletionPhaseSelection.js';
import { createWorkspaceDeletionRegistryPublisher } from './workspaceDeletionRegistryPublication.js';

async function fixture(test: TestContext, phase: WorkspaceDeletionJournalV1['phase'] = 'authorized') {
  const root = await mkdtemp(join(tmpdir(), 'eky-delete-phase-'));
  await chmod(root, 0o700);
  test.onTestFinished(async () => {
    if (test.task.result?.state === 'pass') await rm(root, { recursive: true, force: true });
  });
  const registryPath = join(root, WORKSPACE_REGISTRY_FILE_NAME);
  const registry = new WorkspaceRegistryStore({ installationRoot: root, filePath: registryPath });
  const before = { ...createSwitchRegistry(), formatVersion: 2 as const };
  const after = removeWorkspaceEntry({ registry: before, targetWorkspaceId: TEST_TARGET_WORKSPACE_ID,
    expectedActiveWorkspaceId: before.activeWorkspaceId });
  await registry.write(before);
  const registryBytes = await readFile(registryPath);
  const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
  const target = before.workspaces.find(entry => entry.workspaceId === TEST_TARGET_WORKSPACE_ID)!;
  const journalValue = captureWorkspaceDeletionJournal({ ...deletionTestJournal(),
    target: { ...deletionTestJournal().target, workspaceId: target.workspaceId, lineageIdentity: target.lineageIdentity,
      registryEntrySha256: workspaceRegistryEntrySha256(target) }, previousActiveWorkspaceId: before.activeWorkspaceId,
    registryBeforeSha256: hash(registryBytes), registryAfterSha256: hash(serializeWorkspaceRegistry(after)) });
  const journal = new WorkspaceDeletionJournalStore(root), journalPaths = createWorkspaceDeletionJournalPaths(root);
  let current = true, writerAbsent = true;
  const ownerError = new Error('SYNTHETIC_MAIN_RESERVATION_LOST'), writerError = new Error('SYNTHETIC_WRITER_PRESENT');
  const authority = {
    assertCurrent: vi.fn(() => { if (!current) throw ownerError; }),
    assertOwned: vi.fn(async () => { authority.assertCurrent(); }),
  };
  const assertWritersAbsent = vi.fn(async () => { if (!writerAbsent) throw writerError; });
  const publication = { assertAuthority: authority.assertCurrent, async assertExternalSelection() {
    authority.assertCurrent(); await assertWritersAbsent(); authority.assertCurrent();
  } };
  await journal.publish(journalValue, { ...publication, slots: (await journal.inspect(authority.assertCurrent)).slots });
  // This fixture proves phase selection only, not the unperformed inventory or payload phase prerequisites.
  for (const next of workspaceDeletionPhases.slice(1, workspaceDeletionPhases.indexOf(phase) + 1)) {
    await journal.advance({ ...journalValue, phase: next }, { ...publication,
      slots: (await journal.inspect(authority.assertCurrent)).slots });
  }
  if (phase === 'registryPublished') await registry.write(after);
  const journalBytes = await readFile(journalPaths.currentPath);
  const input = { operationId: journalValue.target.operationId, authority, journal, registry, assertWritersAbsent };
  return { root, registry, registryPath, registryBytes, before, after, journal, journalPaths, journalValue,
    journalBytes, input, authority, publication, ownerError, writerError,
    loseOwner() { current = false; }, restoreOwner() { current = true; },
    setWriterAbsent(value: boolean) { writerAbsent = value; },
    capture: () => captureWorkspaceDeletionPhaseSelection(input),
  };
}

it.for(workspaceDeletionPhases)('pins actual journal and registry bytes in %s without writing or repairing', async (phase, test) => {
  const f = await fixture(test, phase);
  const registryBefore = await readFile(f.registryPath);
  const selection = await f.capture();
  expect(selection.journal.phase).toBe(phase);
  expect(selection.registryState).toBe(phase === 'registryPublished' ? 'after' : 'before');
  expect(selection.afterRegistry).toEqual(f.after);
  expect(selection.registryNeedsRecovery).toBe(false);
  await selection.assertSelected();
  expect(await readFile(f.registryPath)).toEqual(registryBefore);
  expect(await readFile(f.journalPaths.currentPath)).toEqual(f.journalBytes);
  selection.revoke();
  expect(() => selection.assertCurrent()).toThrow('WORKSPACE_DELETE_JOURNAL_CONFLICT');
});

it.for(['absent', 'initialNext', 'differentOperation'] as const)('rejects %s without granting a phase', async (state, test) => {
  const f = await fixture(test);
  if (state === 'absent') await rename(f.journalPaths.currentPath, join(f.root, 'preserved-journal'));
  else if (state === 'initialNext') await rename(f.journalPaths.currentPath, f.journalPaths.nextPath);
  else f.input.operationId = validateWorkspaceBackupReplacementOperationId(deletionTestId(99));
  await expect(f.capture()).rejects.toThrow('WORKSPACE_DELETE_JOURNAL_CONFLICT');
  expect(await readFile(f.registryPath)).toEqual(f.registryBytes);
  if (state === 'initialNext') expect(await readFile(f.journalPaths.nextPath)).toEqual(f.journalBytes);
});

it.for(['journal', 'registry'] as const)('rejects a same-byte %s replacement after capture', async (target, test) => {
  const f = await fixture(test);
  const selected = await f.capture();
  const path = target === 'journal' ? f.journalPaths.currentPath : f.registryPath;
  const bytes = await readFile(path);
  await rename(path, `${path}.preserved`);
  await writeFile(path, bytes, { mode: 0o600, flag: 'wx' });
  await expect(selected.assertSelected()).rejects.toThrow('WORKSPACE_DELETE_JOURNAL_CONFLICT');
  expect(await readFile(path)).toEqual(bytes);
  expect(await readFile(`${path}.preserved`)).toEqual(bytes);
});

it.for(['registryBackup', 'registryNext', 'journalBackup', 'journalNext'] as const)(
  'rejects newly appearing %s rather than adopting or removing it', async (side, test) => {
    const f = await fixture(test), selected = await f.capture();
    const path = side === 'registryBackup' ? `${f.registryPath}.backup` : side === 'registryNext' ? `${f.registryPath}.next`
      : side === 'journalBackup' ? f.journalPaths.backupPath : f.journalPaths.nextPath;
    const bytes = side.startsWith('registry') ? f.registryBytes : f.journalBytes;
    await writeFile(path, bytes, { mode: 0o600, flag: 'wx' });
    await expect(selected.assertSelected()).rejects.toThrow('WORKSPACE_DELETE_JOURNAL_CONFLICT');
    expect(await readFile(path)).toEqual(bytes);
  },
);

it('rejects an externally advanced phase with the same lease and immutable journal binding', async test => {
  const f = await fixture(test), selected = await f.capture();
  await f.journal.advance({ ...f.journalValue, phase: 'quarantined' }, { ...f.publication,
    slots: (await f.journal.inspect(f.authority.assertCurrent)).slots });
  await expect(selected.assertSelected()).rejects.toThrow('WORKSPACE_DELETE_JOURNAL_CONFLICT');
  expect(() => f.authority.assertCurrent()).not.toThrow();
  expect((await f.journal.inspect(f.authority.assertCurrent)).plan).toMatchObject({ selected: { phase: 'quarantined' } });
});

it('keeps pinned observations separate from mutable copies supplied to stores', async test => {
  const f = await fixture(test), selected = await f.capture();
  selected.journalSlots.current!.bytes.fill(0);
  selected.registrySlots.current!.bytes.fill(0);
  await expect(selected.assertSelected()).resolves.toBeUndefined();
  expect(await readFile(f.registryPath)).toEqual(f.registryBytes);
  expect(await readFile(f.journalPaths.currentPath)).toEqual(f.journalBytes);
});

it('latches the first writer failure even if that writer later disappears', async test => {
  const f = await fixture(test), selected = await f.capture();
  f.setWriterAbsent(false);
  await expect(selected.assertSelected()).rejects.toBe(f.writerError);
  f.setWriterAbsent(true);
  await expect(selected.assertSelected()).rejects.toBe(f.writerError);
  expect(() => selected.assertCurrent()).toThrow(f.writerError);
});

it('joins an already started owner check after revocation without returning a selection', async test => {
  const f = await fixture(test);
  let entered!: () => void, release!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const pending = new Promise<void>(resolve => { release = resolve; });
  f.authority.assertOwned.mockImplementationOnce(async () => { entered(); await pending; });
  let settled = false;
  const result = f.capture().then(() => { settled = true; return undefined; }, error => { settled = true; return error; });
  try {
    await Promise.race([started, result.then(() => { throw new Error('SYNTHETIC_OWNER_NOT_PENDING'); })]);
    f.loseOwner();
    await new Promise<void>(resolve => setImmediate(resolve));
    expect(settled).toBe(false);
  } finally { release(); await result; }
  expect(await result).toBe(f.ownerError);
  expect(await readFile(f.registryPath)).toEqual(f.registryBytes);
  expect(await readFile(f.journalPaths.currentPath)).toEqual(f.journalBytes);
});

it('rejects owner loss during the real registry read and preserves original bytes', async test => {
  const f = await fixture(test), original = f.registry.inspectSlots.bind(f.registry);
  await expect(captureWorkspaceDeletionPhaseSelection({ ...f.input, registry: {
    async inspectSlots(guard) { const result = await original(guard); f.loseOwner(); return result; },
  } })).rejects.toBe(f.ownerError);
  expect(await readFile(f.registryPath)).toEqual(f.registryBytes);
  expect(await readFile(f.journalPaths.currentPath)).toEqual(f.journalBytes);
});

it('rejects a Promise-returning current-owner callback', async test => {
  const f = await fixture(test);
  await expect(captureWorkspaceDeletionPhaseSelection({ ...f.input,
    authority: { async assertCurrent() {}, async assertOwned() {} },
  })).rejects.toThrow('WORKSPACE_DELETE_JOURNAL_CONFLICT');
  expect(await readFile(f.registryPath)).toEqual(f.registryBytes);
});

it('uses captured external selection during a real journal advance without reentering the journal reader', async test => {
  const f = await fixture(test), selection = await f.capture();
  const expected = captureWorkspaceDeletionJournal({ ...selection.journal, phase: 'quarantined' });
  // Phase selection only: the future executor must add the full inventory and quarantined-payload proof.
  const identity = await f.journal.advance(expected, { slots: selection.journalSlots,
    assertAuthority: selection.assertCurrent, assertExternalSelection: selection.assertExternalSelection });
  const published = await f.journal.inspect(f.authority.assertCurrent);
  expect(published.plan).toMatchObject({ mode: 'published', selected: expected });
  expect(sameCrashSafeFileSlotIdentity(published.slots.current!.identity!, identity)).toBe(true);
  expect(published.slots.next).toBeUndefined();
  expect(published.slots.backup).toBeUndefined();
  expect(await readFile(f.registryPath)).toEqual(f.registryBytes);
  await expect(selection.assertSelected()).rejects.toThrow('WORKSPACE_DELETE_JOURNAL_CONFLICT');
});

it('uses captured external selection during real recovery without promoting an unpublished next phase', async test => {
  const f = await fixture(test);
  await writeFile(f.journalPaths.nextPath, serializeWorkspaceDeletionJournal(
    captureWorkspaceDeletionJournal({ ...f.journalValue, phase: 'quarantined' })), { mode: 0o600, flag: 'wx' });
  const selection = await f.capture();
  expect(selection.journal.phase).toBe('authorized');
  const identity = await f.journal.recover({ slots: selection.journalSlots,
    assertAuthority: selection.assertCurrent, assertExternalSelection: selection.assertExternalSelection });
  const published = await f.journal.inspect(f.authority.assertCurrent);
  expect(published.plan).toMatchObject({ mode: 'published', selected: { phase: 'authorized' } });
  expect(sameCrashSafeFileSlotIdentity(published.slots.current!.identity!, identity)).toBe(true);
  expect(published.slots.next).toBeUndefined();
  expect(await readFile(f.journalPaths.currentPath)).toEqual(f.journalBytes);
  expect(await readFile(f.registryPath)).toEqual(f.registryBytes);
  selection.revoke();
});

it.for(['owner', 'writer', 'registry'] as const)('joins pending %s work when the returned phase selection is revoked', async (stage, test) => {
  const f = await fixture(test), nativeRead = f.registry.inspectSlots.bind(f.registry);
  const readRegistry = vi.fn(nativeRead);
  const selection = await captureWorkspaceDeletionPhaseSelection({ ...f.input, registry: { inspectSlots: readRegistry } });
  let entered!: () => void, release!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const pending = new Promise<void>(resolve => { release = resolve; });
  const hold = async () => { entered(); await pending; };
  if (stage === 'owner') f.authority.assertOwned.mockImplementationOnce(hold);
  else if (stage === 'writer') f.input.assertWritersAbsent.mockImplementationOnce(hold);
  else readRegistry.mockImplementationOnce(async guard => { const result = await nativeRead(guard); await hold(); return result; });
  let settled = false;
  const result = selection.assertSelected().then(() => { settled = true; return undefined; }, error => { settled = true; return error; });
  try {
    await Promise.race([started, result.then(() => { throw new Error('SYNTHETIC_CHECK_NOT_PENDING'); })]);
    selection.revoke();
    await new Promise<void>(resolve => setImmediate(resolve));
    expect(settled).toBe(false);
  } finally { release(); await result; }
  expect(await result).toMatchObject({ message: 'WORKSPACE_DELETE_JOURNAL_CONFLICT' });
  await expect(selection.assertExternalSelection()).rejects.toBe(await result);
  expect(await readFile(f.registryPath)).toEqual(f.registryBytes);
  expect(await readFile(f.journalPaths.currentPath)).toEqual(f.journalBytes);
});

it('uses inverse journal selection while the real registry store owns its changing slots', async test => {
  const f = await fixture(test, 'purged'), selected = await f.capture();
  const slots = selected.registrySlots;
  // The registry publisher must additionally prove inventory/payload absence before using this inverse guard.
  const identity = await f.registry.writeSelected(f.after, {
    expectedSlots: { current: slots.current?.bytes, backup: slots.backup?.bytes, next: slots.next?.bytes },
    expectedIdentities: { current: slots.current?.identity, backup: slots.backup?.identity, next: slots.next?.identity },
    assertAuthority: selected.assertCurrent, assertExternalSelection: selected.assertJournalSelected,
  });
  const published = await f.registry.inspectSlots(f.authority.assertCurrent);
  expect(sameCrashSafeFileSlotIdentity(published.current!.identity!, identity)).toBe(true);
  expect(published.next).toBeUndefined(); expect(published.backup).toBeUndefined();
  expect(await readFile(f.registryPath)).toEqual(Buffer.from(serializeWorkspaceRegistry(f.after)));
  expect(await readFile(f.journalPaths.currentPath)).toEqual(f.journalBytes);
  await expect(selected.assertJournalSelected()).resolves.toBeUndefined();
  await expect(selected.assertSelected()).rejects.toThrow('WORKSPACE_DELETE_JOURNAL_CONFLICT');
});

it('never treats inverse registry-write authority as permission to ignore changed journal slots', async test => {
  const f = await fixture(test, 'purged'), selected = await f.capture();
  await writeFile(f.journalPaths.nextPath, serializeWorkspaceDeletionJournal(
    captureWorkspaceDeletionJournal({ ...f.journalValue, phase: 'registryPublished' })), { mode: 0o600 });
  await expect(selected.assertJournalSelected()).rejects.toThrow('WORKSPACE_DELETE_JOURNAL_CONFLICT');
  expect(await readFile(f.registryPath)).toEqual(f.registryBytes);
  expect(await readFile(f.journalPaths.currentPath)).toEqual(f.journalBytes);
});

it('keeps the original binding while allowing its published phase to advance', async test => {
  const f = await fixture(test, 'purged');
  const selected = await captureWorkspaceDeletionPhaseSelection({ ...f.input, expectedBinding: f.journalValue });
  expect(selected.journal.phase).toBe('purged'); await selected.assertSelected(); selected.revoke();
});

it.for(['inventory', 'registry', 'root', 'backup'] as const)('rejects changed expected %s before reading the registry', async (change, test) => {
  const f = await fixture(test);
  const expected = captureWorkspaceDeletionJournal({ ...f.journalValue,
    ...(change === 'inventory' ? { inventory: { ...f.journalValue.inventory, sha256: 'b'.repeat(64) } } : {}),
    ...(change === 'registry' ? { registryAfterSha256: 'c'.repeat(64) } : {}),
    ...(change === 'root' ? { operationRootIdentity: 'd'.repeat(64) } : {}),
    ...(change === 'backup' ? { backupDisposition: f.journalValue.backupDisposition === 'verifiedBackup' ? 'explicitDataLoss' : 'verifiedBackup' } : {}),
  });
  const read = vi.fn(f.registry.inspectSlots.bind(f.registry));
  await expect(captureWorkspaceDeletionPhaseSelection({ ...f.input, registry: { inspectSlots: read }, expectedBinding: expected }))
    .rejects.toThrow('WORKSPACE_DELETE_JOURNAL_CONFLICT');
  expect(read).not.toHaveBeenCalled(); expect(await readFile(f.journalPaths.currentPath)).toEqual(f.journalBytes);
  expect(await readFile(f.registryPath)).toEqual(f.registryBytes);
});

it('captures the expected binding before a pending owner check', async test => {
  const f = await fixture(test), expected = { ...f.journalValue, inventory: { ...f.journalValue.inventory } };
  let entered!: () => void, release!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; }), held = new Promise<void>(resolve => { release = resolve; });
  f.authority.assertOwned.mockImplementationOnce(async () => { entered(); await held; });
  const result = captureWorkspaceDeletionPhaseSelection({ ...f.input, expectedBinding: expected });
  try {
    await Promise.race([started, result.then(() => { throw new Error('SYNTHETIC_BINDING_CHECK_NOT_PENDING'); })]);
    expected.inventory.sha256 = 'b'.repeat(64);
  }
  finally { release(); }
  const selected = await result; expect(selected.journal).toEqual(f.journalValue); await selected.assertSelected(); selected.revoke();
});

it.for(['payload', 'registry', 'metadata', 'terminal'] as const)('enforces the shared binding at the actual %s stage entry', async (stage, test) => {
  const f = await fixture(test, stage === 'payload' ? 'authorized' : stage === 'terminal' ? 'registryPublished' : 'purged');
  if (stage === 'metadata') await f.registry.write(f.after);
  const registryBytes = await readFile(f.registryPath), read = vi.fn(f.registry.inspectSlots.bind(f.registry));
  const expected = captureWorkspaceDeletionJournal({ ...f.journalValue, inventory: { ...f.journalValue.inventory, sha256: 'b'.repeat(64) } });
  const input = { userDataRoot: f.root, registry: { inspectSlots: read, writeSelected: f.registry.writeSelected.bind(f.registry),
    recoverSelected: f.registry.recoverSelected.bind(f.registry) }, assertWritersAbsent: f.input.assertWritersAbsent };
  const create = { payload: createWorkspaceDeletionPayloadExecutor, registry: createWorkspaceDeletionRegistryPublisher,
    metadata: createWorkspaceDeletionMetadataCleaner, terminal: createWorkspaceDeletionFinalizer }[stage];
  await expect(create(input)(f.input.operationId, f.authority, expected)).rejects.toThrow('WORKSPACE_DELETE_JOURNAL_CONFLICT');
  expect(read).not.toHaveBeenCalled(); expect(await readFile(f.journalPaths.currentPath)).toEqual(f.journalBytes);
  expect(await readFile(f.registryPath)).toEqual(registryBytes);
});
