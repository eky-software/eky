import { expect, it } from 'vitest';
import { captureDeletionInventoryCommitment, captureDeletionInventoryHeader, captureDeletionInventoryPayloadRecord,
  captureDeletionInventoryRecord, deletionInventoryLine, type WorkspaceDeletionInventoryRecord } from './workspaceDeletionInventoryCodec.js';
import { deletionTestChunks as chunks, deletionTestHeader as header, deletionTestId as id,
  deletionTestJournal as journal, deletionTestRecord as record } from './workspaceDeletionDataTestSupport.js';
import { captureWorkspaceDeletionJournal } from './workspaceDeletionJournalCodec.js';
import { encodeDeletionInventory, inspectDeletionInventory, readDeletionInventoryRecords } from './workspaceDeletionInventoryStream.js';

function inspection(value: number, role: 'inspection' | 'inspectionEvidence' = 'inspectionEvidence') {
  return captureDeletionInventoryRecord({ ...record(value), role, generationId: id(value + 1_000) });
}
function workspace() {
  return captureDeletionInventoryRecord({ ...record(), role: 'workspace', ownerOperationId: null, bindingSha256: null });
}
async function bytesFor(values: readonly WorkspaceDeletionInventoryRecord[]) {
  async function* source() { yield* values; }
  const parts: Buffer[] = [];
  for await (const bytes of encodeDeletionInventory(header, source())) parts.push(bytes);
  return Buffer.concat(parts);
}
function unchecked(values: readonly WorkspaceDeletionInventoryRecord[]) {
  return Buffer.concat([deletionInventoryLine(header), ...values.map(deletionInventoryLine)]);
}
async function inspect(bytes: Buffer) {
  return inspectDeletionInventory(chunks(bytes), header, undefined, () => chunks(bytes));
}

it('captures evidence without permitting it as a physical payload', () => {
  const evidence = inspection(1);
  expect(Object.isFrozen(evidence)).toBe(true);
  expect(evidence.generationId).toBe(id(1_001));
  expect(() => captureDeletionInventoryPayloadRecord(evidence)).toThrow('WORKSPACE_DELETE_INVENTORY_INVALID');
  expect(captureDeletionInventoryPayloadRecord(inspection(2, 'inspection')).role).toBe('inspection');
  expect(captureDeletionInventoryPayloadRecord(workspace()).role).toBe('workspace');
});

it.each([{ generationId: null }, { ownerOperationId: null }, { member: 'data' }, { bindingSha256: null },
  { rootIdentity: '' }, { parentIdentity: '' }, { path: '/untrusted' },
])('rejects malformed evidence %#', change => {
  expect(() => captureDeletionInventoryRecord({ ...inspection(1), ...change })).toThrow('WORKSPACE_DELETE_INVENTORY_INVALID');
});

it.each([1, 3])('rejects inventory version %s even when nested versions agree', version => {
  const value = journal();
  expect(() => captureDeletionInventoryHeader({ ...header, formatVersion: version })).toThrow();
  expect(() => captureDeletionInventoryCommitment({ ...value.inventory, formatVersion: version })).toThrow();
  for (const change of [
    { target: { ...value.target, formatVersion: version } },
    { inventory: { ...value.inventory, formatVersion: version } },
    { target: { ...value.target, formatVersion: version }, inventory: { ...value.inventory, formatVersion: version } },
  ]) expect(() => captureWorkspaceDeletionJournal({ ...value, ...change })).toThrow('WORKSPACE_DELETE_JOURNAL_CONFLICT');
});

it('validates many evidence rows with one covering workspace and bounded rereads', async () => {
  const bytes = await bytesFor([inspection(1, 'inspection'),
    ...Array.from({ length: 300 }, (_, index) => inspection(index + 2)), workspace()]);
  let rereads = 0;
  const result = await inspectDeletionInventory(chunks(bytes, 1), header, undefined, () => {
    rereads++; return chunks(bytes, 17);
  });
  expect(result.formatVersion).toBe(2);
  expect(result.recordCount).toBe(302);
  expect(rereads).toBe(2);
  const reader = readDeletionInventoryRecords(chunks(bytes), header, result);
  let count = 0;
  while (true) {
    const next = await reader.next();
    if (next.done) { expect(next.value).toEqual(result); break; }
    count++;
  }
  expect(count).toBe(302);
});

it('rejects missing or repeated covering workspace records and missing semantic rereads', async () => {
  await expect(inspect(unchecked([inspection(1)]))).rejects.toThrow();
  await expect(bytesFor([inspection(1)])).rejects.toThrow();
  await expect(inspect(unchecked([inspection(1), workspace(), workspace()]))).rejects.toThrow();
  const valid = await bytesFor([inspection(1), workspace()]);
  await expect(inspectDeletionInventory(chunks(valid), header)).rejects.toThrow();
});

it.each([1, 2, 3])('rejects a dual-role copy at merge position %s', async value => {
  const bytes = await bytesFor([inspection(1, 'inspection'), inspection(2, 'inspection'), inspection(3, 'inspection'),
    inspection(value), workspace()]);
  await expect(inspect(bytes)).rejects.toThrow('WORKSPACE_DELETE_INVENTORY_INVALID');
});

it('accepts the same operation with distinct generations and a fully drained external tail', async () => {
  const external = inspection(1, 'inspection');
  const evidence = captureDeletionInventoryRecord({ ...inspection(1), generationId: id(2_000) });
  expect((await inspect(await bytesFor([external, inspection(3, 'inspection'), evidence, workspace()]))).recordCount).toBe(4);
});

it.each(['payload', 'evidence'] as const)('rejects a changed %s reread including its trailing bytes', async which => {
  const bytes = await bytesFor([inspection(1), workspace()]);
  let pass = 0;
  await expect(inspectDeletionInventory(chunks(bytes), header, undefined, () => {
    pass++;
    return chunks(pass === (which === 'payload' ? 1 : 2) ? Buffer.concat([bytes, Buffer.from('invalid\n')]) : bytes);
  })).rejects.toThrow('WORKSPACE_DELETE_INVENTORY_INVALID');
});

it.each(['payload', 'evidence', 'both'] as const)('preserves the conflict and %s source-close errors', async failing => {
  const bytes = await bytesFor([inspection(1, 'inspection'), inspection(1), workspace()]);
  const payloadClose = new Error('SYNTHETIC_PAYLOAD_CLOSE');
  const evidenceClose = new Error('SYNTHETIC_EVIDENCE_CLOSE');
  let pass = 0;
  let closed = 0;
  async function* source(payload: boolean) {
    try { yield* chunks(bytes); }
    finally {
      closed++;
      if (failing === 'both' || failing === (payload ? 'payload' : 'evidence')) {
        throw payload ? payloadClose : evidenceClose;
      }
    }
  }
  const closeErrors = failing === 'both' ? [evidenceClose, payloadClose]
    : [failing === 'payload' ? payloadClose : evidenceClose];
  await expect(inspectDeletionInventory(chunks(bytes), header, undefined, () => source(++pass === 1)))
    .rejects.toMatchObject({ errors: [expect.objectContaining({ message: 'WORKSPACE_DELETE_INVENTORY_INVALID' }), ...closeErrors] });
  expect(closed).toBe(2);
});
