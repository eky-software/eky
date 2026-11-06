import { readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, it, vi, type TestContext } from 'vitest';
import { deletionTestHeader as header, deletionTestId as id, deletionTestJournal } from './workspaceDeletionDataTestSupport.js';
import { WorkspaceDeletionInventoryStore } from './workspaceDeletionInventoryStore.js';
import { createWorkspaceDeletionJournalPaths, WorkspaceDeletionJournalStore } from './workspaceDeletionJournalStore.js';
import { workspaceDeletionRemnantReads as nativeReads } from './workspaceDeletionRemnantCensus.js';
import * as censusPorts from './workspaceDeletionRemnantCensusSelection.js';
import { deletionRoleSourceFixture } from './workspaceDeletionRolesTestSupport.js';
import { captureWorkspaceRemnantBinding, serializeWorkspaceRemnantBinding, workspaceRemnantBindingKey,
  type WorkspaceRemnantBindingV1 } from './workspaceRemnantBindingCodec.js';
import { createWorkspaceRemnantBindingPaths } from './workspaceRemnantBindingPaths.js';
import { remnantTestBinding } from './workspaceRemnantBindingTestSupport.js';
import * as lookupPorts from './workspaceReplacementRemnantEnumeration.js';

async function fixture(context: TestContext) {
  const f = await deletionRoleSourceFixture(context), retained = await f.preserved();
  const bindings: Extract<WorkspaceRemnantBindingV1, { owner: 'profileInspection' }>[] = [];
  for (let n = 0; n < 2; n++) {
    const binding = await f.publish({ ...remnantTestBinding('profileInspection'),
      operationId: id(100 + n), generationId: id(200 + n), workspaceId: id(300 + n) });
    if (binding.owner !== 'profileInspection') throw new Error('SYNTHETIC_INSPECTION_BINDING_REQUIRED');
    bindings.push(binding);
  }
  return { ...f, retained, bindings,
    paths: bindings.map(value => createWorkspaceRemnantBindingPaths(f.root, workspaceRemnantBindingKey(value))) };
}

it.for(['malformed', 'miskeyed', 'identity'] as const)(
  'keeps unrelated %s slot validation in the complete source receipt', async (kind, context) => {
    const f = await fixture(context), source = await f.capture(), foreign = f.paths[0]!;
    const targetBefore = await readFile(f.paths[1]!.currentPath), before = await readFile(foreign.currentPath);
    if (kind === 'identity') {
      await rename(foreign.currentPath, join(f.root, 'retained-original-binding'));
      await writeFile(foreign.currentPath, before, { flag: 'wx', mode: 0o600 });
    } else await writeFile(foreign.currentPath, kind === 'malformed' ? '{' : serializeWorkspaceRemnantBinding(
      captureWorkspaceRemnantBinding({ ...f.bindings[0], generationId: f.bindings[1]!.generationId })));
    const changed = await readFile(foreign.currentPath);
    expect((await lookupPorts.findUniqueWorkspaceInspectionBinding(f.root, f.bindings[1]!.generationId, f.authority, nativeReads)).value)
      .toEqual(f.bindings[1]);
    await expect(source.assertUnchanged()).rejects.toThrow('WORKSPACE_REMNANT_BINDING_INVALID');
    expect(await readFile(foreign.currentPath)).toEqual(changed);
    expect(await readFile(f.paths[1]!.currentPath)).toEqual(targetBefore);
    expect((await f.preserved()).slice(0, f.retained.length)).toEqual(f.retained);
  });

it.for(['beforeComparison', 'duringFinalReceipt'] as const)(
  'preserves the committed native owner-port state after unrelated corruption %s', async (when, context) => {
    const f = await fixture(context), targetBefore = await readFile(f.paths[1]!.currentPath);
    let comparing = false, insideReceipt = false, receiptCalls = 0, changed = false;
    const captureReceipt = censusPorts.captureWorkspaceDeletionRemnantCensus;
    const receiptSpy = vi.spyOn(censusPorts, 'captureWorkspaceDeletionRemnantCensus').mockImplementation(async (...args) => {
      const receipt = await captureReceipt(...args);
      return Object.freeze({ ...receipt, assertUnchanged() {
        const selected = comparing;
        if (selected) { insideReceipt = true; receiptCalls++; }
        const finish = () => { if (selected) insideReceipt = false; };
        try { const result = receipt.assertUnchanged(); void result.then(finish, finish); return result; }
        catch (error) { finish(); throw error; }
      } });
    });
    const lookup = lookupPorts.findUniqueWorkspaceInspectionBinding;
    const lookupSpy = vi.spyOn(lookupPorts, 'findUniqueWorkspaceInspectionBinding').mockImplementation(async (...args) => {
      if (when === 'duringFinalReceipt' && !changed && insideReceipt && args[1] === f.bindings[1]!.generationId) {
        await writeFile(f.paths[0]!.currentPath, '{'); changed = true;
      }
      return lookup(...args);
    });
    context.onTestFinished(() => { receiptSpy.mockRestore(); lookupSpy.mockRestore(); });
    const work = (async () => {
      let source!: Awaited<ReturnType<typeof f.capture>>;
      async function* records() { source = await f.capture(); yield* source.records(); }
      const inventory = new WorkspaceDeletionInventoryStore(f.root, header.operationId);
      const selected = await inventory.publish(header, records(), f.authority);
      const journal = new WorkspaceDeletionJournalStore(f.root), journalPaths = createWorkspaceDeletionJournalPaths(f.root);
      // A committed owner-port fixture, not the publisher's three-comparison acceptance test.
      const journalIdentity = await journal.publish({ ...deletionTestJournal(), ...selected }, {
        ...f.authority, slots: (await journal.inspect(f.authority.assertAuthority)).slots,
      }, async () => {});
      const journalBytes = await readFile(journalPaths.currentPath);
      if (when === 'beforeComparison') { await writeFile(f.paths[0]!.currentPath, '{'); changed = true; }
      comparing = true;
      const comparison = inventory.assertRecords(selected, source.records(), f.authority);
      if (when === 'duringFinalReceipt') await comparison;
      else await expect(comparison).rejects.toThrow('WORKSPACE_REMNANT_BINDING_INVALID');
      comparing = false;
      expect(changed).toBe(true); expect(insideReceipt).toBe(false);
      if (when === 'duringFinalReceipt') {
        expect(receiptCalls).toBe(1);
        lookupSpy.mockRestore();
        // The receipt is not an atomic snapshot; the following whole read must reject the persistent change.
        await expect(source.assertUnchanged()).rejects.toThrow('WORKSPACE_REMNANT_BINDING_INVALID');
      }
      expect(await readFile(journalPaths.currentPath)).toEqual(journalBytes);
      expect((await journal.inspect(f.authority.assertAuthority)).slots.current!.identity).toEqual(journalIdentity);
      expect(await readFile(f.paths[0]!.currentPath)).toEqual(Buffer.from('{'));
      expect(await readFile(f.paths[1]!.currentPath)).toEqual(targetBefore);
      expect((await f.preserved()).slice(0, f.retained.length)).toEqual(f.retained);
    })();
    context.onTestFinished(async () => { await work.catch(() => undefined); });
    await work;
  });
