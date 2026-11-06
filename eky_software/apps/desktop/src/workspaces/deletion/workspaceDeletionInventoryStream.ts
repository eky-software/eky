import { createHash } from 'node:crypto';

import { invalidDeletionData, parseDeletionJson } from './workspaceDeletionDataValidation.js';
import {
  captureDeletionInventoryCommitment, captureDeletionInventoryHeader, captureDeletionInventoryRecord,
  deletionInventoryLine, deletionInventoryReadChunkBytes, deletionInventoryRecordKey,
  maximumDeletionInventoryLineBytes, deletionInventoryFormatVersion,
  type WorkspaceDeletionInventoryCommitment, type WorkspaceDeletionInventoryHeader,
  type WorkspaceDeletionInventoryRecord,
} from './workspaceDeletionInventoryCodec.js';

const invalidCode = 'WORKSPACE_DELETE_INVENTORY_INVALID';

export async function* encodeDeletionInventory(
  header: WorkspaceDeletionInventoryHeader, source: AsyncIterable<WorkspaceDeletionInventoryRecord>,
): AsyncGenerator<Buffer> {
  yield deletionInventoryLine(captureDeletionInventoryHeader(header));
  let previous = '';
  let workspace = false;
  let evidence = false;
  for await (const value of source) {
    const record = captureDeletionInventoryRecord(value);
    const key = deletionInventoryRecordKey(record);
    if (key <= previous) return invalidDeletionData(invalidCode);
    previous = key;
    workspace ||= record.role === 'workspace';
    evidence ||= record.role === 'inspectionEvidence';
    yield deletionInventoryLine(record);
  }
  if (evidence && !workspace) return invalidDeletionData(invalidCode);
}

// Yielded records are observations only; the commitment is available only after verified EOF.
export async function* readDeletionInventoryRecords(
  chunks: AsyncIterable<Uint8Array>, expectedHeader: WorkspaceDeletionInventoryHeader,
  expectedCommitment?: WorkspaceDeletionInventoryCommitment, onFailure?: (error: unknown) => void,
): AsyncGenerator<WorkspaceDeletionInventoryRecord, WorkspaceDeletionInventoryCommitment> {
  const header = captureDeletionInventoryHeader(expectedHeader);
  const expected = expectedCommitment === undefined ? undefined : captureDeletionInventoryCommitment(expectedCommitment);
  const hash = createHash('sha256');
  let byteLength = 0;
  let recordCount = 0;
  let pending = Buffer.alloc(0);
  let headerRead = false;
  let previous = '';
  let workspace = false;
  let evidence = false;
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
      workspace ||= record.role === 'workspace';
      evidence ||= record.role === 'inspectionEvidence';
      return record;
    }
  };
  const source = chunks[Symbol.asyncIterator]();
  let failed = false;
  let failure: unknown;
  try {
    while (true) {
      const next = await source.next();
      if (next.done) break;
      const chunk = next.value;
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
        const record = inspectLine(Buffer.concat([pending, chunk.subarray(start, index)]));
        pending = Buffer.alloc(0);
        start = index + 1;
        if (record !== undefined) yield record;
      }
      if (pending.byteLength + chunk.byteLength - start >= maximumDeletionInventoryLineBytes) return invalidDeletionData(invalidCode);
      pending = Buffer.concat([pending, chunk.subarray(start)]);
    }
    if (!headerRead || pending.byteLength !== 0 || (evidence && !workspace)) return invalidDeletionData(invalidCode);
    const result = captureDeletionInventoryCommitment({ formatVersion: deletionInventoryFormatVersion,
      byteLength, recordCount, sha256: hash.digest('hex') });
    if (expected !== undefined && (result.byteLength !== expected.byteLength ||
        result.recordCount !== expected.recordCount || result.sha256 !== expected.sha256)) return invalidDeletionData(invalidCode);
    return result;
  } catch (error) { failed = true; failure = error; notifyReadFailure(onFailure, error); throw error; }
  finally {
    // Manual iteration retains a byte-source close failure after parser/read failure too.
    try { await source.return?.(); }
    catch (error) {
      notifyReadFailure(onFailure, error);
      if (failed) throw new AggregateError([failure, error], invalidCode);
      throw error;
    }
  }
}

// Completion validates bytes and cross-role coverage, never filesystem ownership or deletion authority.
export async function inspectDeletionInventory(
  chunks: AsyncIterable<Uint8Array>, expectedHeader: WorkspaceDeletionInventoryHeader,
  expectedCommitment?: WorkspaceDeletionInventoryCommitment,
  reread?: () => AsyncIterable<Uint8Array>, onFailure?: (error: unknown) => void,
): Promise<WorkspaceDeletionInventoryCommitment> {
  const reader = readDeletionInventoryRecords(chunks, expectedHeader, expectedCommitment, onFailure);
  let evidence = false;
  let result: WorkspaceDeletionInventoryCommitment;
  while (true) {
    const next = await reader.next();
    if (next.done) { result = next.value; break; }
    evidence ||= next.value.role === 'inspectionEvidence';
  }
  if (evidence) {
    if (reread === undefined) return invalidDeletionData(invalidCode);
    await assertInspectionRolesDisjoint(reread, expectedHeader, result, onFailure);
  }
  return result;
}

// Observed rows must match through both EOFs; this does not grant filesystem deletion authority.
export async function assertDeletionInventoryRecords(
  chunks: AsyncIterable<Uint8Array>, header: WorkspaceDeletionInventoryHeader,
  commitment: WorkspaceDeletionInventoryCommitment, expected: AsyncIterable<WorkspaceDeletionInventoryRecord>,
  assertAuthority: () => void, onFailure?: (error: unknown) => void,
): Promise<void> {
  const actual: AsyncIterator<WorkspaceDeletionInventoryRecord> = readDeletionInventoryRecords(chunks, header, commitment, onFailure);
  let source: AsyncIterator<WorkspaceDeletionInventoryRecord> | undefined;
  let failed = false;
  let failure: unknown;
  try {
    assertAuthority();
    source = expected[Symbol.asyncIterator]();
    while (true) {
      assertAuthority();
      const row = await actual.next();
      assertAuthority();
      const observed = await source.next();
      assertAuthority();
      if (row.done || observed.done) {
        if (!row.done || !observed.done) return invalidDeletionData(invalidCode);
        break;
      }
      if (!deletionInventoryLine(row.value).equals(deletionInventoryLine(observed.value))) {
        return invalidDeletionData(invalidCode);
      }
    }
  } catch (error) { failed = true; failure = error; notifyReadFailure(onFailure, error); }
  const closeFailures: unknown[] = [];
  for (const reader of [source, actual]) {
    try { await reader?.return?.(); } catch (error) { notifyReadFailure(onFailure, error); closeFailures.push(error); }
  }
  if (closeFailures.length > 0) {
    if (failed) throw new AggregateError([failure, ...closeFailures], invalidCode);
    if (closeFailures.length === 1) throw closeFailures[0];
    throw new AggregateError(closeFailures, invalidCode);
  }
  if (failed) throw failure;
  assertAuthority();
}

async function* inspectionRecords(
  chunks: AsyncIterable<Uint8Array>, header: WorkspaceDeletionInventoryHeader,
  commitment: WorkspaceDeletionInventoryCommitment, role: 'inspection' | 'inspectionEvidence', onFailure?: (error: unknown) => void,
) {
  for await (const record of readDeletionInventoryRecords(chunks, header, commitment, onFailure)) {
    if (record.role === role) yield record;
  }
}

async function assertInspectionRolesDisjoint(
  reread: () => AsyncIterable<Uint8Array>, header: WorkspaceDeletionInventoryHeader,
  commitment: WorkspaceDeletionInventoryCommitment, onFailure?: (error: unknown) => void,
) {
  const payload = inspectionRecords(reread(), header, commitment, 'inspection', onFailure);
  let evidence: AsyncGenerator<WorkspaceDeletionInventoryRecord> | undefined;
  let failed = false;
  let failure: unknown;
  try {
    evidence = inspectionRecords(reread(), header, commitment, 'inspectionEvidence', onFailure);
    let current = await payload.next();
    let observed = await evidence.next();
    while (!observed.done) {
      const key = inspectionKey(observed.value);
      while (!current.done && inspectionKey(current.value) < key) current = await payload.next();
      if (!current.done && inspectionKey(current.value) === key) return invalidDeletionData(invalidCode);
      observed = await evidence.next();
    }
    // Both sources must reach EOF, including any tail after the last evidence row.
    while (!current.done) current = await payload.next();
  } catch (error) { failed = true; failure = error; notifyReadFailure(onFailure, error); }
  // Explicitly close both: for-await would suppress a return failure after a primary conflict.
  const closeFailures: unknown[] = [];
  for (const reader of [evidence, payload]) {
    try { await reader?.return(undefined); } catch (error) { notifyReadFailure(onFailure, error); closeFailures.push(error); }
  }
  if (closeFailures.length > 0) {
    if (failed) throw new AggregateError([failure, ...closeFailures], invalidCode);
    if (closeFailures.length === 1) throw closeFailures[0];
    throw new AggregateError(closeFailures, invalidCode);
  }
  if (failed) throw failure;
}

function inspectionKey(record: WorkspaceDeletionInventoryRecord): string {
  return `${record.ownerOperationId}/${record.generationId}`;
}

function notifyReadFailure(callback: ((error: unknown) => void) | undefined, error: unknown): void {
  try { callback?.(error); } catch { /* Preserve the original failure. */ }
}
