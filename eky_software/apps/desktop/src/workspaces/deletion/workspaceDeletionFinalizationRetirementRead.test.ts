import { readFile } from 'node:fs/promises';
import { expect, it, vi } from 'vitest';
import { captureWorkspaceDeletionRetirementReadTestFailure,
  createWorkspaceDeletionFinalizationTestFixture as fixture } from './workspaceDeletionFinalizationTestSupport.js';
import * as inventoryRetirement from './workspaceDeletionInventoryRetirement.js';

for (const cold of [false, true]) for (const kind of ['error', 'undefined'] as const) {
  it(`retirement upper caller preserves first ${kind} and real close (cold: ${cold})`, async test => {
    const first = kind === 'error' ? new Error('SYNTHETIC_RETIREMENT_UPPER_FIRST') : undefined;
    const closing = new Error('SYNTHETIC_RETIREMENT_UPPER_CLOSE');
    const result = await captureWorkspaceDeletionRetirementReadTestFailure(test, first, closing, cold);
    expect(result.errors).toHaveLength(2); expect(result.errors[0]).toBe(first); expect(result.errors[1]).toBe(closing);
  });
}

for (const cold of [false, true]) for (const kind of ['error', 'undefined'] as const) {
  it(`retirement unrelated aggregate keeps first ${kind} (cold: ${cold})`, async test => {
    const f = await fixture(test, true, false, { coldSelection: cold });
    const first = kind === 'error' ? new Error('SYNTHETIC_RETIREMENT_OUTSIDE_FIRST') : undefined;
    const later = new Error('SYNTHETIC_RETIREMENT_OUTSIDE_LATER');
    const owned = f.authority.assertOwned.bind(f.authority); let armed = false, reached = false;
    f.authority.assertOwned = async () => { if (armed) throw first; await owned(); };
    vi.spyOn(inventoryRetirement, 'retireWorkspaceDeletionInventory').mockImplementationOnce(async (_root, _journal, authority) => {
      armed = true;
      const result = await authority.assertExternalSelection().then(() => ({ ok: true }), error => ({ ok: false, error }));
      expect(result.ok).toBe(false); if (!('error' in result)) throw new Error('RETIREMENT_FIRST_REQUIRED');
      expect(result.error).toBe(first); reached = true;
      throw new AggregateError([first, later], 'SYNTHETIC_NOT_A_COMPLETED_READ');
    });
    const result = await f.run().then(() => ({ ok: true }), error => ({ ok: false, error }));
    expect(reached).toBe(true); expect(result.ok).toBe(false);
    if (!('error' in result)) throw new Error('RETIREMENT_REJECTION_REQUIRED'); expect(result.error).toBe(first);
    expect(await readFile(f.journalPaths.currentPath)).toEqual(f.journalBytes);
    expect(await readFile(f.inventoryPaths.currentPath)).toEqual(f.inventoryBytes); await f.preserved();
  });
}

it('retirement completed read notification expires before a later invocation', async test => {
  const f = await fixture(test, true, false, { coldSelection: false });
  const first = new Error('SYNTHETIC_RETIREMENT_DELEGATE_STOP');
  let captured: ((error: unknown) => void) | undefined;
  const spy = vi.spyOn(inventoryRetirement, 'retireWorkspaceDeletionInventory').mockImplementationOnce(async (...args) => {
    captured = args[5]; expect(captured).toBeTypeOf('function'); throw first;
  });
  await expect(f.run()).rejects.toBe(first);
  expect(() => captured!(new Error('SYNTHETIC_LATE_NOTIFICATION'))).toThrow('WORKSPACE_DELETE_JOURNAL_CONFLICT');
  spy.mockImplementationOnce(async () => { throw first; });
  await expect(f.run()).rejects.toBe(first);
  expect(await readFile(f.journalPaths.currentPath)).toEqual(f.journalBytes);
  expect(await readFile(f.inventoryPaths.currentPath)).toEqual(f.inventoryBytes); await f.preserved();
});
