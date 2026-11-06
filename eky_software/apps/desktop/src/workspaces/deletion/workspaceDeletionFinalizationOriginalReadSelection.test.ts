import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { expect, it, vi } from 'vitest';
import { deletionTestId as id } from './workspaceDeletionDataTestSupport.js';
import { createWorkspaceDeletionFinalizer } from './workspaceDeletionFinalization.js';
import { createWorkspaceDeletionFinalizationTestFixture as fixture } from './workspaceDeletionFinalizationTestSupport.js';
import { captureWorkspaceDeletionJournal as captureJournal, captureWorkspaceDeletionOriginalJournalProof as captureProof,
  serializeWorkspaceDeletionJournal as serializeJournal } from './workspaceDeletionJournalCodec.js';
import * as originalPayload from './workspaceDeletionOriginalPayloadAbsence.js';
import { captureWorkspaceRemnantBinding as captureBinding, workspaceRemnantBindingSha256 as bindingHash } from './workspaceRemnantBindingCodec.js';

const owners = ['workspaceImport', 'workspaceReplacement', 'workspaceActivationMigration', 'workspaceLegacyAdoption'] as const;
const faults = owners.flatMap(owner => (['firstOwner', 'writer', 'secondOwner'] as const).flatMap(kind =>
  [false, true].map(undefinedFailure => ({ owner, kind, undefinedFailure }))));

it.for(faults)('retains original hook $owner $kind undefined=$undefinedFailure through cleanup', async (variant, test) => {
  const f = await fixture(test, true, true);
  if (f.journal.formatVersion !== 2) throw new Error('SYNTHETIC_EXPECTED_V2');
  const binding = captureBinding({ formatVersion: 1, owner: variant.owner, operationId: id(223),
    workspaceId: f.header.workspaceId, lineageIdentity: f.header.lineageIdentity });
  // Controlled commitment for absence-reader composition, not admission of an
  // actual interrupted operation of a different original-journal type.
  const proof = captureProof(f.header, { owner: binding.owner, operationId: binding.operationId,
    bindingSha256: bindingHash(binding), slots: f.journal.originalJournalProofs[0]!.slots });
  f.journal = captureJournal({ ...f.journal, originalJournalProofs: [proof], phase: 'registryPublished' });
  f.journalBytes = Buffer.from(serializeJournal(f.journal));
  await writeFile(f.journalPaths.currentPath, f.journalBytes);
  const failure = variant.undefinedFailure ? undefined : new Error('SYNTHETIC_ORIGINAL_HOOK_FIRST');
  const close = new Error('SYNTHETIC_ORIGINAL_HOOK_CLOSE');
  let armed = false, checks = 0, fullBeforeHook = 0, seen: unknown = close, caught = false;
  const actual = originalPayload.captureWorkspaceDeletionOriginalPayloadAbsence;
  vi.spyOn(originalPayload, 'captureWorkspaceDeletionOriginalPayloadAbsence').mockImplementation(async (...args) => {
    const authority = args[2], scoped = authority.assertReadSelection;
    expect(typeof scoped).toBe('function');
    try {
      return await actual(args[0], args[1], { ...authority,
        async assertExternalSelection() { fullBeforeHook++; await authority.assertExternalSelection(); },
        async assertReadSelection() { armed = true; await scoped!(); },
      });
    } catch (error) { caught = true; seen = error; f.revoke(); throw close; }
  });
  const authority = { assertCurrent: f.authority.assertCurrent, async assertOwned() {
    await f.authority.assertOwned();
    if (armed && ++checks === (variant.kind === 'secondOwner' ? 2 : 1) && variant.kind !== 'writer') throw failure;
  } };
  const command = createWorkspaceDeletionFinalizer({ userDataRoot: f.root, registry: f.registry,
    async assertWritersAbsent() { f.authority.assertCurrent(); if (armed && variant.kind === 'writer') throw failure; } });
  await expect(f.track(command(f.header.operationId, authority))).rejects.toBe(failure);
  expect(caught).toBe(true); expect(seen).toBe(failure); expect(fullBeforeHook).toBeGreaterThan(0);
  expect(await readFile(f.journalPaths.currentPath)).toEqual(f.journalBytes);
  expect(await readFile(f.inventoryPaths.currentPath)).toEqual(f.inventoryBytes); await f.preserved();
});

it('retains the initially absent original parent vector through finalization', async test => {
  const f = await fixture(test, true, true);
  const actual = originalPayload.captureWorkspaceDeletionOriginalPayloadAbsence;
  let changed = false;
  vi.spyOn(originalPayload, 'captureWorkspaceDeletionOriginalPayloadAbsence').mockImplementation(async (...args) => {
    const selected = await actual(...args);
    await mkdir(f.originalPaths.operationsRoot, { recursive: true, mode: 0o700 }); changed = true;
    return selected;
  });
  await expect(f.run()).rejects.toThrow('WORKSPACE_REMNANT_BINDING_INVALID');
  expect(changed).toBe(true);
  expect(await readFile(f.journalPaths.currentPath)).toEqual(f.journalBytes);
  expect(await readFile(f.inventoryPaths.currentPath)).toEqual(f.inventoryBytes); await f.preserved();
});
