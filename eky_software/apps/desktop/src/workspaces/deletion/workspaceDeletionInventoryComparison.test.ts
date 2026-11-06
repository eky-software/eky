import { expect, it } from 'vitest';
import { type WorkspaceDeletionInventoryRecord } from './workspaceDeletionInventoryCodec.js';
import { assertDeletionInventoryRecords, encodeDeletionInventory, inspectDeletionInventory } from './workspaceDeletionInventoryStream.js';
import { deletionTestDigest as hash, deletionTestHeader as header,
  deletionTestRecord as record, deletionTestRecords as records } from './workspaceDeletionDataTestSupport.js';

async function* source(values: readonly WorkspaceDeletionInventoryRecord[]) { yield* values; }
const owned = () => {};

it.each([0, 2, 300])('compares %s records through both EOFs with one expected row outstanding', async count => {
  const commitment = await inspectDeletionInventory(encodeDeletionInventory(header, records(count)), header);
  let expectedEof = false;
  let actualEof = false;
  let actualRows = 0;
  let expectedRows = 0;
  async function* actual() {
    for await (const bytes of encodeDeletionInventory(header, records(count))) {
      actualRows++;
      yield bytes;
      expect(actualRows - 1).toBe(expectedRows);
    }
    actualEof = true;
  }
  async function* expected() {
    for await (const row of records(count)) { expectedRows++; yield row; }
    expectedEof = true;
  }
  await expect(assertDeletionInventoryRecords(actual(), header, commitment, expected(), owned)).resolves.toBeUndefined();
  expect([actualEof, expectedEof]).toEqual([true, true]);
});

it.each(['short', 'long', 'reordered', 'duplicate', 'root', 'parent', 'binding', 'role', 'extraField'] as const)(
  'rejects a %s expected source and closes it', async change => {
    const commitment = await inspectDeletionInventory(encodeDeletionInventory(header, records()), header);
    const first = record();
    const values = change === 'short' ? [first] : change === 'long' ? [first, record(2), record(3)]
      : change === 'reordered' ? [record(2), first] : change === 'duplicate' ? [first, first]
      : change === 'root' ? [{ ...first, rootIdentity: hash('changed') }, record(2)]
      : change === 'parent' ? [{ ...first, parentIdentity: hash('changed') }, record(2)]
      : change === 'binding' ? [{ ...first, bindingSha256: hash('changed') }, record(2)]
      : change === 'role' ? [{ ...first, role: 'activationRollback' as const }, record(2)]
      : [{ ...first, extra: true }, record(2)];
    let closed = false;
    async function* expected() { try { yield* values; } finally { closed = true; } }
    await expect(assertDeletionInventoryRecords(encodeDeletionInventory(header, records()), header, commitment, expected(), owned))
      .rejects.toThrow('WORKSPACE_DELETE_INVENTORY_INVALID');
    expect(closed).toBe(true);
  });

it('does not accept matching rows without verifying the actual commitment at EOF', async () => {
  const commitment = await inspectDeletionInventory(encodeDeletionInventory(header, records()), header);
  let expectedClosed = false;
  async function* expected() { try { yield* records(); } finally { expectedClosed = true; } }
  await expect(assertDeletionInventoryRecords(encodeDeletionInventory(header, records()), header,
    { ...commitment, sha256: hash('other') }, expected(), owned)).rejects.toThrow('WORKSPACE_DELETE_INVENTORY_INVALID');
  expect(expectedClosed).toBe(true);
});

it.each(['next', 'eof', 'acquisition'] as const)('preserves expected source %s failure', async stage => {
  const commitment = await inspectDeletionInventory(encodeDeletionInventory(header, records()), header);
  const first = new Error('SYNTHETIC_EXPECTED_FAILURE');
  let closed = false;
  async function* actual() {
    try { yield* encodeDeletionInventory(header, records()); } finally { closed = true; }
  }
  async function* expected() { if (stage === 'eof') yield* records(); throw first; }
  const input = stage === 'acquisition' ? { [Symbol.asyncIterator](): AsyncIterator<WorkspaceDeletionInventoryRecord> { throw first; } }
    : expected();
  await expect(assertDeletionInventoryRecords(actual(), header, commitment, input, owned)).rejects.toBe(first);
  expect(closed).toBe(stage !== 'acquisition');
});

it('joins both iterator closes and preserves the original mismatch before both close failures', async () => {
  const commitment = await inspectDeletionInventory(encodeDeletionInventory(header, records()), header);
  const expectedClose = new Error('SYNTHETIC_EXPECTED_CLOSE');
  const actualClose = new Error('SYNTHETIC_ACTUAL_CLOSE');
  const closed: string[] = [];
  async function* actual() {
    try { yield* encodeDeletionInventory(header, records()); }
    finally { closed.push('actual'); throw actualClose; }
  }
  async function* expected() {
    try { yield record(3); } finally { closed.push('expected'); throw expectedClose; }
  }
  const result = await assertDeletionInventoryRecords(actual(), header, commitment, expected(), owned).catch(error => error);
  expect(result).toBeInstanceOf(AggregateError);
  expect(result.errors).toEqual([expect.objectContaining({ message: 'WORKSPACE_DELETE_INVENTORY_INVALID' }), expectedClose, actualClose]);
  expect(closed).toEqual(['expected', 'actual']);
});

it('preserves both a malformed actual row and its byte-source close failure', async () => {
  const commitment = await inspectDeletionInventory(encodeDeletionInventory(header, records()), header);
  const closeFailure = new Error('SYNTHETIC_BYTE_SOURCE_CLOSE');
  let closed = false;
  async function* actual() {
    try { yield Buffer.from('invalid-json\n'); }
    finally { closed = true; throw closeFailure; }
  }
  await expect(assertDeletionInventoryRecords(actual(), header, commitment, records(), owned)).rejects.toMatchObject({
    errors: [expect.objectContaining({ message: 'WORKSPACE_DELETE_INVENTORY_INVALID' }), closeFailure],
  });
  expect(closed).toBe(true);
});

it.each(['read', 'commitment'] as const)('preserves byte-source close failure after %s failure', async stage => {
  const commitment = await inspectDeletionInventory(encodeDeletionInventory(header, records(0)), header);
  const first = new Error('SYNTHETIC_BYTE_READ');
  const closeFailure = new Error('SYNTHETIC_BYTE_CLOSE');
  const encoded = encodeDeletionInventory(header, records(0));
  const actual: AsyncIterable<Uint8Array> = { [Symbol.asyncIterator]() { return {
    async next() { if (stage === 'read') throw first; return encoded.next(); },
    async return() { await encoded.return(undefined); throw closeFailure; },
  }; } };
  await expect(assertDeletionInventoryRecords(actual, header,
    { ...commitment, sha256: hash('mismatch') }, records(0), owned)).rejects.toMatchObject({
    errors: [stage === 'read' ? first : expect.objectContaining({ message: 'WORKSPACE_DELETE_INVENTORY_INVALID' }), closeFailure],
  });
});

it.each(['actual', 'expected', 'eof'] as const)('rejects lost authority during %s reads and closes both readers', async stage => {
  const commitment = await inspectDeletionInventory(encodeDeletionInventory(header, records()), header);
  let current = true;
  const closed: string[] = [];
  async function* actual() {
    try {
      for await (const bytes of encodeDeletionInventory(header, records())) {
        if (stage === 'actual') current = false;
        yield bytes;
      }
    } finally { closed.push('actual'); }
  }
  async function* expected() {
    try {
      if (stage === 'expected') current = false;
      yield* records();
      if (stage === 'eof') current = false;
    } finally { closed.push('expected'); }
  }
  await expect(assertDeletionInventoryRecords(actual(), header, commitment, expected(), () => {
    if (!current) throw new Error('SYNTHETIC_AUTHORITY_LOST');
  })).rejects.toThrow('SYNTHETIC_AUTHORITY_LOST');
  expect(closed).toContain('actual');
  expect(closed.includes('expected')).toBe(stage !== 'actual');
});

it('surfaces a failing return even after both sources reported EOF', async () => {
  const commitment = await inspectDeletionInventory(encodeDeletionInventory(header, records(0)), header);
  const failure = new Error('SYNTHETIC_EOF_CLOSE');
  const expected: AsyncIterable<WorkspaceDeletionInventoryRecord> = {
    [Symbol.asyncIterator]() { return { async next() { return { done: true, value: undefined }; }, async return() { throw failure; } }; },
  };
  await expect(assertDeletionInventoryRecords(encodeDeletionInventory(header, source([])), header, commitment, expected, owned))
    .rejects.toBe(failure);
});
