import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import { deletionInventoryLine, deletionInventoryReadChunkBytes, maximumDeletionInventoryLineBytes } from './workspaceDeletionInventoryCodec.js';
import { encodeDeletionInventory, inspectDeletionInventory } from './workspaceDeletionInventoryStream.js';
import { deletionTestChunks as chunks, deletionTestDigest as hash, deletionTestHeader as header,
  deletionTestRecord as record, deletionTestRecords as records } from './workspaceDeletionDataTestSupport.js';

async function encoded(count = 2) {
  const result: Buffer[] = [];
  for await (const bytes of encodeDeletionInventory(header, records(count))) result.push(bytes);
  return Buffer.concat(result);
}

it('validates more inventory bytes than fit in a journal without keeping all records', async () => {
  const result = await inspectDeletionInventory(encodeDeletionInventory(header, records(300)), header);
  expect(result.recordCount).toBe(300);
  expect(result.byteLength).toBeGreaterThan(16 * 1_024);
  expect(await inspectDeletionInventory(encodeDeletionInventory(header, records(300)), header, result)).toEqual(result);
});

it.each([0, 2])('validates exact bytes/count/hash across single-byte splits for %s records', async count => {
  const bytes = await encoded(count);
  const expected = { formatVersion: 2 as const, byteLength: bytes.byteLength, recordCount: count,
    sha256: createHash('sha256').update(bytes).digest('hex') };
  expect(await inspectDeletionInventory(chunks(bytes, 1), header, expected)).toEqual(expected);
});

it.each(['missingLf', 'extraLine', 'changedRoot', 'duplicate', 'reversed', 'duplicateKey',
  'invalidUtf8', 'oversizedLine', 'noncanonical', 'bom', 'blankLine'] as const)('rejects %s before returning a commitment', async mutation => {
  const bytes = await encoded();
  const expected = await inspectDeletionInventory(chunks(bytes), header);
  const lines = bytes.toString().trimEnd().split('\n');
  const changed = mutation === 'missingLf' ? bytes.subarray(0, -1)
    : mutation === 'extraLine' ? Buffer.concat([bytes, deletionInventoryLine(record(3))])
    : mutation === 'changedRoot' ? Buffer.from(bytes.toString().replace(hash('root-1'), hash('other')))
    : mutation === 'duplicate' ? Buffer.from(`${lines[0]}\n${lines[1]}\n${lines[1]}\n`)
    : mutation === 'reversed' ? Buffer.from(`${lines[0]}\n${lines[2]}\n${lines[1]}\n`)
    : mutation === 'duplicateKey' ? Buffer.from(bytes.toString().replace('"formatVersion":2', '"formatVersion":2,"formatVersion":2'))
    : mutation === 'invalidUtf8' ? Buffer.concat([Buffer.from([255]), bytes])
    : mutation === 'oversizedLine' ? Buffer.from(' '.repeat(maximumDeletionInventoryLineBytes))
    : mutation === 'bom' ? Buffer.concat([Buffer.from([239, 187, 191]), bytes])
    : mutation === 'blankLine' ? Buffer.concat([bytes, Buffer.from('\n')])
    : Buffer.from(bytes.toString().replace('{', '{ '));
  if (mutation !== 'extraLine' && mutation !== 'changedRoot') {
    await expect(inspectDeletionInventory(chunks(changed), header)).rejects.toThrow('WORKSPACE_DELETE_INVENTORY_INVALID');
  }
  await expect(inspectDeletionInventory(chunks(changed), header, expected)).rejects.toThrow('WORKSPACE_DELETE_INVENTORY_INVALID');
});

it('checks exact target, counter and source chunk limits', async () => {
  const bytes = await encoded();
  const expected = await inspectDeletionInventory(chunks(bytes), header);
  await expect(inspectDeletionInventory(chunks(bytes), { ...header, registryEntrySha256: hash('other') })).rejects.toThrow();
  for (const changed of [{ byteLength: expected.byteLength - 1 }, { byteLength: expected.byteLength + 1 },
    { recordCount: 0 }, { sha256: hash('other') }]) {
    await expect(inspectDeletionInventory(chunks(bytes), header, { ...expected, ...changed })).rejects.toThrow();
  }
  await expect(inspectDeletionInventory(chunks(Buffer.alloc(deletionInventoryReadChunkBytes + 1), deletionInventoryReadChunkBytes + 1), header)).rejects.toThrow();
});

it('closes the source iterator on validation failure and preserves source failures', async () => {
  let closed = false;
  async function* invalid() {
    try { yield Buffer.from('invalid\n'); } finally { closed = true; }
  }
  await expect(inspectDeletionInventory(invalid(), header)).rejects.toThrow();
  expect(closed).toBe(true);
  const first = new Error('synthetic-source-failure');
  async function* failed() { yield deletionInventoryLine(header); throw first; }
  await expect(inspectDeletionInventory(failed(), header)).rejects.toBe(first);
});

it('rejects duplicate or unordered records on encoding as well as reading', async () => {
  for (const source of [[record(1), record(1)], [record(2), record(1)]]) {
    async function* unsorted() { yield* source; }
    await expect(inspectDeletionInventory(encodeDeletionInventory(header, unsorted()), header)).rejects.toThrow();
  }
});
