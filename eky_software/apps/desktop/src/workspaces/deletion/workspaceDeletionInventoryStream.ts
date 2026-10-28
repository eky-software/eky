import { createHash } from 'node:crypto';

import { invalidDeletionData, parseDeletionJson } from './workspaceDeletionDataValidation.js';
import {
  captureDeletionInventoryCommitment, captureDeletionInventoryHeader, captureDeletionInventoryRecord,
  deletionInventoryLine, deletionInventoryReadChunkBytes, deletionInventoryRecordKey,
  maximumDeletionInventoryLineBytes,
  type WorkspaceDeletionInventoryCommitment, type WorkspaceDeletionInventoryHeader,
  type WorkspaceDeletionInventoryRecord,
} from './workspaceDeletionInventoryCodec.js';

const invalidCode = 'WORKSPACE_DELETE_INVENTORY_INVALID';

export async function* encodeDeletionInventory(
  header: WorkspaceDeletionInventoryHeader, source: AsyncIterable<WorkspaceDeletionInventoryRecord>,
): AsyncGenerator<Buffer> {
  yield deletionInventoryLine(captureDeletionInventoryHeader(header));
  let previous = '';
  for await (const value of source) {
    const record = captureDeletionInventoryRecord(value);
    const key = deletionInventoryRecordKey(record);
    if (key <= previous) return invalidDeletionData(invalidCode);
    previous = key;
    yield deletionInventoryLine(record);
  }
}

// Completion proves only the entire byte contract, never root ownership or deletion authority.
export async function inspectDeletionInventory(
  chunks: AsyncIterable<Uint8Array>, expectedHeader: WorkspaceDeletionInventoryHeader,
  expectedCommitment?: WorkspaceDeletionInventoryCommitment,
): Promise<WorkspaceDeletionInventoryCommitment> {
  const header = captureDeletionInventoryHeader(expectedHeader);
  const expected = expectedCommitment === undefined ? undefined : captureDeletionInventoryCommitment(expectedCommitment);
  const hash = createHash('sha256');
  let byteLength = 0;
  let recordCount = 0;
  let pending = Buffer.alloc(0);
  let headerRead = false;
  let previous = '';
  const inspectLine = (bytes: Buffer) => {
    const parsed = parseDeletionJson(bytes, maximumDeletionInventoryLineBytes - 1, invalidCode);
    if (!headerRead) {
      const captured = captureDeletionInventoryHeader(parsed);
      if (!deletionInventoryLine(captured).equals(Buffer.concat([bytes, Buffer.from('\n')])) ||
          !deletionInventoryLine(captured).equals(deletionInventoryLine(header))) return invalidDeletionData(invalidCode);
      headerRead = true;
    } else {
      const record = captureDeletionInventoryRecord(parsed);
      if (!deletionInventoryLine(record).equals(Buffer.concat([bytes, Buffer.from('\n')]))) return invalidDeletionData(invalidCode);
      const key = deletionInventoryRecordKey(record);
      if (key <= previous) return invalidDeletionData(invalidCode);
      previous = key;
      recordCount++;
      if (!Number.isSafeInteger(recordCount)) return invalidDeletionData(invalidCode);
    }
  };
  for await (const chunk of chunks) {
    if (!(chunk instanceof Uint8Array) || chunk.byteLength > deletionInventoryReadChunkBytes) return invalidDeletionData(invalidCode);
    byteLength += chunk.byteLength;
    if (!Number.isSafeInteger(byteLength) || (expected !== undefined && byteLength > expected.byteLength)) {
      return invalidDeletionData(invalidCode);
    }
    hash.update(chunk);
    let start = 0;
    for (let index = 0; index < chunk.byteLength; index++) {
      if (chunk[index] !== 10) continue;
      if (pending.byteLength + index - start + 1 > maximumDeletionInventoryLineBytes) return invalidDeletionData(invalidCode);
      inspectLine(Buffer.concat([pending, chunk.subarray(start, index)]));
      pending = Buffer.alloc(0);
      start = index + 1;
    }
    if (pending.byteLength + chunk.byteLength - start >= maximumDeletionInventoryLineBytes) return invalidDeletionData(invalidCode);
    pending = Buffer.concat([pending, chunk.subarray(start)]);
  }
  if (!headerRead || pending.byteLength !== 0) return invalidDeletionData(invalidCode);
  const result = captureDeletionInventoryCommitment({ formatVersion: 1, byteLength, recordCount, sha256: hash.digest('hex') });
  if (expected !== undefined && (result.byteLength !== expected.byteLength ||
      result.recordCount !== expected.recordCount || result.sha256 !== expected.sha256)) return invalidDeletionData(invalidCode);
  return result;
}
