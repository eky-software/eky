import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { expect, it, vi } from 'vitest';
import { acquireWorkspaceProcessReservation } from '../../runtime/workspaceProcessReservation.js';
import { TEST_SOURCE_WORKSPACE_ID } from '../switch/workspaceSwitchTestSupport.js';
import { createWorkspaceDeletionInventoryPaths } from './workspaceDeletionInventoryStore.js';
import { createWorkspaceDeletionJournalPaths, WorkspaceDeletionJournalStore } from './workspaceDeletionJournalStore.js';
import { workspaceDeletionPhases } from './workspaceDeletionJournalCodec.js';
import { deriveWorkspaceDeletionPayloadPaths } from './workspaceDeletionPayloadPaths.js';
import { assertDeletionReservationBusy, deletionProcessFixture } from './workspaceDeletionProcessTestSupport.js';

const processCaseTimeoutMs = 60_000;
const fullColdResumeTimeoutMs = 90_000;
type AdvancedPhase = Exclude<(typeof workspaceDeletionPhases)[number], 'authorized'>;

for (const phase of workspaceDeletionPhases.filter((value): value is AdvancedPhase => value !== 'authorized')) {
  for (const side of ['before', 'after'] as const) {
    const cut = `${side}:${phase}` as const;
    it(`cold restart joins a real terminated owner ${cut} without replaying consent`, {
      timeout: ['before:purgeAuthorized', 'before:quarantined', 'after:quarantined', 'after:purgeAuthorized', 'before:purged'].includes(cut) ? fullColdResumeTimeoutMs : processCaseTimeoutMs,
    }, async test => {
      const f = await deletionProcessFixture(test), first = f.start('publish', cut);
      expect((await first.message('cut')).cut).toBe(cut);
      await assertDeletionReservationBusy(() => acquireWorkspaceProcessReservation({ userDataRoot: f.root, signal: test.signal }));
      const store = new WorkspaceDeletionJournalStore(f.root);
      const selected = await store.inspect(() => test.signal.throwIfAborted());
      const expectedPhase = side === 'after' ? phase : workspaceDeletionPhases[workspaceDeletionPhases.indexOf(phase) - 1];
      expect(selected.plan).toMatchObject({ mode: 'published', selected: { phase: expectedPhase } });
      if (selected.plan.mode !== 'published') throw new Error('DELETION_PROCESS_PUBLISHED_PHASE_REQUIRED');
      expect(selected.slots.next).toBeUndefined(); expect(selected.slots.backup).toBeUndefined();
      const journal = selected.plan.selected;
      const paths = createWorkspaceDeletionJournalPaths(f.root);
      const journalBytes = await readFile(paths.currentPath);
      const inventory = createWorkspaceDeletionInventoryPaths(f.root, f.operationId);
      const inventoryBytes = await readFile(inventory.currentPath);
      const payload = deriveWorkspaceDeletionPayloadPaths(f.root, journal.target, {
        role: 'workspace', ownerOperationId: null, generationId: null, member: null, bindingSha256: null,
        rootIdentity: f.targetRootIdentity, parentIdentity: f.targetParentIdentity,
      })[0]!;
      expect(existsSync(f.target.workspaceRoot)).toBe(false);
      const quarantined = phase === 'quarantined' || phase === 'purgeAuthorized';
      expect(existsSync(payload.quarantinePath)).toBe(quarantined);
      if (quarantined) for (const path of f.targetFiles) {
        expect(await readFile(join(payload.quarantinePath, relative(f.target.workspaceRoot, path)), 'utf8')).toBe('synthetic-not-a-database');
      }
      if (phase === 'registryPublished') {
        expect((await f.registry.inspectSlots()).current!.value.workspaces.map(row => row.workspaceId)).toEqual([TEST_SOURCE_WORKSPACE_ID]);
      } else expect(await readFile(f.registryPath)).toEqual(f.registryBytes);
      await f.assertRetained();
      await first.killAndJoin();
      expect(await readFile(paths.currentPath)).toEqual(journalBytes);
      expect(await readFile(inventory.currentPath)).toEqual(inventoryBytes);

      const fresh = f.start('resumeCold', null);
      expect(fresh.pid === first.pid).toBe(false);
      expect(await fresh.message('completed')).toMatchObject({ coldSettled: true,
        completion: { formatVersion: 1, status: 'completed', navigation: 'reopenPrevious' } });
      await fresh.successfulExit();
      for (const path of [f.target.workspaceRoot, payload.quarantinePath, inventory.directoryPath,
        paths.currentPath, paths.nextPath, paths.backupPath]) expect(existsSync(path)).toBe(false);
      expect((await f.registry.inspectSlots()).current!.value.workspaces.map(row => row.workspaceId)).toEqual([TEST_SOURCE_WORKSPACE_ID]);
      await f.assertRetained();
      const proof = await acquireWorkspaceProcessReservation({ userDataRoot: f.root, signal: test.signal });
      try { await proof.assertOwned(); } finally { await proof.release(); }
    });
  }
}

for (const cut of ['authorized', 'payloadAbsent', 'registryPublished'] as const) {
  it(`joins a real terminated owner and resumes the same file command in a fresh process (${cut})`,
  { timeout: cut === 'authorized' ? fullColdResumeTimeoutMs : processCaseTimeoutMs }, async test => {
    const f = await deletionProcessFixture(test), first = f.start('publish', cut);
    expect((await first.message('cut')).cut).toBe(cut);
    await f.assertRetained();
    // The first child must really own the OS reservation while paused.
    await assertDeletionReservationBusy(() => acquireWorkspaceProcessReservation({ userDataRoot: f.root, signal: test.signal }));
    const journal = new WorkspaceDeletionJournalStore(f.root);
    const before = await journal.inspect(() => test.signal.throwIfAborted());
    expect(before.plan).toMatchObject({ mode: 'published', selected: {
      phase: cut === 'payloadAbsent' ? 'purgeAuthorized' : cut,
    } });
    if (before.plan.mode !== 'published') throw new Error('DELETION_PROCESS_PUBLISHED_PHASE_REQUIRED');
    const payload = deriveWorkspaceDeletionPayloadPaths(f.root, before.plan.selected.target, {
      role: 'workspace', ownerOperationId: null, generationId: null, member: null, bindingSha256: null,
      rootIdentity: f.targetRootIdentity, parentIdentity: f.targetParentIdentity,
    })[0]!;
    const inventory = createWorkspaceDeletionInventoryPaths(f.root, f.operationId);
    const committedBytes = await readFile(inventory.currentPath);
    if (cut === 'authorized') {
      expect(await readFile(f.registryPath)).toEqual(f.registryBytes);
      for (const path of f.targetFiles) expect(await readFile(path, 'utf8')).toBe('synthetic-not-a-database');
    } else expect(existsSync(f.target.workspaceRoot)).toBe(false);
    expect(existsSync(payload.quarantinePath)).toBe(false);
    await first.killAndJoin();
    // Exit/close is awaited before the next owner acquires the same reservation.
    expect(await readFile(inventory.currentPath)).toEqual(committedBytes);
    const cold = cut === 'authorized';
    const fresh = f.start(cold ? 'resumeCold' : 'resume', null);
    expect(fresh.pid === first.pid).toBe(false);
    expect(await fresh.message('completed')).toMatchObject({ ...(cold ? { coldSettled: true } : { receiptCount: 1 }),
      completion: { formatVersion: 1, status: 'completed', navigation: 'reopenPrevious' } });
    await fresh.successfulExit();
    expect((await journal.inspect(() => test.signal.throwIfAborted())).plan.mode).toBe('absent');
    expect(existsSync(inventory.directoryPath)).toBe(false);
    expect(existsSync(f.target.workspaceRoot)).toBe(false);
    expect(existsSync(payload.quarantinePath)).toBe(false);
    for (const path of f.targetFiles) expect(existsSync(path)).toBe(false);
    expect((await f.registry.inspectSlots()).current!.value.workspaces.map(row => row.workspaceId)).toEqual([TEST_SOURCE_WORKSPACE_ID]);
    const slots = createWorkspaceDeletionJournalPaths(f.root);
    for (const path of [slots.currentPath, slots.nextPath, slots.backupPath]) expect(existsSync(path)).toBe(false);
    await f.assertRetained();
  });
}

it('returns to the empty selector after a real process restart deletes the final faulty workspace', {
  timeout: 90_000,
}, async test => {
  const f = await deletionProcessFixture(test, true), first = f.start('publish', 'authorized');
  await first.message('cut');
  await first.killAndJoin();
  const fresh = f.start('resumeCold', null);
  expect(await fresh.message('completed')).toMatchObject({ coldSettled: true,
    completion: { formatVersion: 1, status: 'completed', navigation: 'selector' } });
  await fresh.successfulExit();
  expect((await f.registry.inspectSlots()).current!.value).toMatchObject({ activeWorkspaceId: null, workspaces: [] });
  expect(existsSync(f.target.workspaceRoot)).toBe(false);
  await f.assertRetained();
});

it('releases an unexpectedly granted reservation before rejecting the exclusion probe', async () => {
  const release = vi.fn(async () => {});
  await expect(assertDeletionReservationBusy(async () => ({ release }))).rejects.toMatchObject({ name: 'AssertionError' });
  expect(release).toHaveBeenCalledTimes(1);
});
