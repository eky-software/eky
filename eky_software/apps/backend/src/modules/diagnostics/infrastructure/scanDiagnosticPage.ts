import { createHash } from 'node:crypto';
import { open } from 'node:fs/promises';

import { DiagnosticBrowseError, type DiagnosticBrowsePolicy } from '../domain/diagnosticBrowsePolicy.js';
import type { DiagnosticEventItem } from '../domain/diagnosticEventItem.js';
import { classifyDiagnosticOperationalEvent } from './diagnosticOperationalEventProjector.js';
import type { DiagnosticReadFailureObserver } from '../ports/diagnosticReadFailureObserver.js';
import { observeDiagnosticReadFailure } from '../application/observeDiagnosticReadFailure.js';
import { assertDiagnosticDirectory, assertDiagnosticSource, sameDiagnosticIdentity,
  type DiagnosticBrowseSnapshot, type DiagnosticBrowseSource, type DiagnosticReadHandle } from './diagnosticBrowseSources.js';

export type DiagnosticBoundary = Pick<DiagnosticEventItem, 'occurredAt' | 'id'>;
export type DiagnosticScanProgress = { bytes: number; chunks: number; metadata: number; stateBytes: number };
export type DiagnosticScannedPage = { events: DiagnosticEventItem[];
  olderBoundary: DiagnosticBoundary | null; newerBoundary: DiagnosticBoundary | null;
  hasOlder: boolean; hasNewer: boolean };
export type DiagnosticScanDirection = 'older' | 'newer';
export const maximumDiagnosticMetadataPerUnit = 7;

export async function* scanDiagnosticPage(
  snapshot: DiagnosticBrowseSnapshot, boundary: DiagnosticBoundary | null,
  limit: number, direction: DiagnosticScanDirection, policy: DiagnosticBrowsePolicy,
  assertActive: () => void, handles: Set<DiagnosticReadHandle>, initialMetadata = 0,
  observer?: DiagnosticReadFailureObserver,
): AsyncGenerator<DiagnosticScanProgress, DiagnosticScannedPage> {
  const progress: DiagnosticScanProgress = { bytes: 0, chunks: 0, metadata: initialMetadata, stateBytes: 0 };
  const order = direction === 'older' ? compareDiagnosticEvents
    : (left: DiagnosticBoundary, right: DiagnosticBoundary) => -compareDiagnosticEvents(left, right);
  const candidates = new Map<string, DiagnosticEventItem>();
  let newest: DiagnosticBoundary | undefined;
  let oldest: DiagnosticBoundary | undefined;
  const stateSize = () => Buffer.byteLength(JSON.stringify([...candidates.values()]));
  yield* scan(snapshot, policy, assertActive, handles, observer, progress, stateSize, event => {
    if (newest === undefined || compareDiagnosticEvents(event, newest) < 0) newest = key(event);
    if (oldest === undefined || compareDiagnosticEvents(event, oldest) > 0) oldest = key(event);
    if (boundary !== null && order(event, boundary) <= 0) return;
    const existing = candidates.get(event.id);
    if (existing !== undefined && order(existing, event) <= 0) return;
    candidates.set(event.id, event);
    if (candidates.size > limit + 1) {
      let last: DiagnosticEventItem | undefined;
      for (const candidate of candidates.values()) {
        if (last === undefined || order(candidate, last) > 0) last = candidate;
      }
      candidates.delete(last!.id);
    }
  });
  const selected = [...candidates.values()].sort(order).slice(0, limit).sort(compareDiagnosticEvents);
  const comparisons = new Map(selected.map(event => [event.id, JSON.stringify(event)]));
  candidates.clear();
  const conflicts = new Set<string>();
  const comparisonSize = () => Buffer.byteLength(JSON.stringify([selected, [...comparisons], [...conflicts]]));
  // The full second pass detects conflicting IDs outside the selected page's key range.
  yield* scan(snapshot, policy, assertActive, handles, observer, progress, comparisonSize, event => {
    const expected = comparisons.get(event.id);
    if (expected !== undefined && expected !== JSON.stringify(event)) conflicts.add(event.id);
  });
  if (conflicts.size > 0) snapshot.issues.add('invalidEntries');
  await assertDiagnosticDirectory(snapshot.root);
  for (const directory of snapshot.directories) {
    assertActive();
    await assertDiagnosticDirectory(directory);
    progress.metadata++;
    yield { ...progress };
  }
  for (const source of snapshot.sources) {
    assertActive();
    await assertDiagnosticSource(snapshot, source);
    progress.metadata += 3;
    yield { ...progress };
  }
  const newerBoundary = selected[0] === undefined ? null : key(selected[0]);
  const olderBoundary = selected.at(-1) === undefined ? null : key(selected.at(-1)!);
  return { events: selected.filter(event => !conflicts.has(event.id)), newerBoundary, olderBoundary,
    hasNewer: newest !== undefined && newerBoundary !== null && compareDiagnosticEvents(newest, newerBoundary) < 0,
    hasOlder: oldest !== undefined && olderBoundary !== null && compareDiagnosticEvents(oldest, olderBoundary) > 0 };
}

async function* scan(
  snapshot: DiagnosticBrowseSnapshot, policy: DiagnosticBrowsePolicy,
  assertActive: () => void, handles: Set<DiagnosticReadHandle>, observer: DiagnosticReadFailureObserver | undefined,
  progress: DiagnosticScanProgress, stateSize: () => number,
  visit: (event: DiagnosticEventItem) => void,
): AsyncGenerator<DiagnosticScanProgress> {
  for (const source of snapshot.sources) {
    const hash = createHash('sha256');
    let offset = 0;
    let pending: Buffer = Buffer.alloc(0);
    let discarding = false;
    while (offset < source.size) {
      assertActive();
      const chunk = await readChunk(snapshot, source, offset, policy.chunkBytes, assertActive, handles, observer);
      hash.update(chunk);
      offset += chunk.length;
      progress.bytes += chunk.length;
      progress.chunks++;
      progress.metadata += maximumDiagnosticMetadataPerUnit;
      for (let start = 0; start < chunk.length;) {
        const newline = chunk.indexOf(10, start);
        const end = newline < 0 ? chunk.length : newline;
        const part = chunk.subarray(start, end);
        if (!discarding && pending.length + part.length <= policy.lineBytes) pending = Buffer.concat([pending, part]);
        else {
          pending = Buffer.alloc(0);
          discarding = true;
          snapshot.issues.add('invalidEntries');
        }
        if (newline >= 0) {
          if (!discarding && pending.length > 0) projectLine(pending, source.component, snapshot, visit);
          pending = Buffer.alloc(0);
          discarding = false;
        }
        start = newline < 0 ? chunk.length : newline + 1;
      }
      progress.stateBytes = stateSize() + pending.length + chunk.length;
      yield { ...progress };
    }
    if (pending.length > 0 || discarding) snapshot.issues.add('invalidEntries');
    assertActive();
    await assertDiagnosticSource(snapshot, source);
    const digest = hash.digest('hex');
    if (source.digest === undefined) source.digest = digest;
    else if (source.digest !== digest) throw new DiagnosticBrowseError('diagnostic_browse_stale');
    progress.metadata += 3;
    progress.stateBytes = stateSize();
    yield { ...progress };
  }
}

async function readChunk(
  snapshot: DiagnosticBrowseSnapshot, source: DiagnosticBrowseSource,
  offset: number, chunkBytes: number, assertActive: () => void, handles: Set<DiagnosticReadHandle>,
  observer: DiagnosticReadFailureObserver | undefined,
): Promise<Buffer> {
  await assertDiagnosticSource(snapshot, source);
  assertActive();
  const handle = await open(source.path, 'r');
  handles.add(handle);
  try {
    const metadata = await handle.stat({ bigint: true });
    if (!metadata.isFile() || !sameDiagnosticIdentity(metadata, source.identity)
      || metadata.size < BigInt(source.size)) throw new DiagnosticBrowseError('diagnostic_browse_stale');
    await assertDiagnosticSource(snapshot, source);
    assertActive();
    const buffer = Buffer.alloc(Math.min(chunkBytes, source.size - offset));
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, offset);
    if (bytesRead !== buffer.length) throw new DiagnosticBrowseError('diagnostic_browse_stale');
    return buffer;
  } catch (error) {
    observeDiagnosticReadFailure(observer, error);
    throw error;
  } finally { await handle.close(); handles.delete(handle); }
}

function projectLine(
  line: Buffer, component: 'backend' | 'desktop', snapshot: DiagnosticBrowseSnapshot,
  visit: (event: DiagnosticEventItem) => void,
): void {
  let value: unknown;
  try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(line)); }
  catch { snapshot.issues.add('invalidEntries'); return; }
  if (typeof value !== 'object' || value === null || !('component' in value) || value.component !== component) {
    snapshot.issues.add('invalidEntries');
    return;
  }
  const projected = classifyDiagnosticOperationalEvent(value);
  if (projected.kind === 'invalid') snapshot.issues.add('invalidEntries');
  if (projected.kind === 'event') visit(projected.event);
}

export function compareDiagnosticEvents(left: DiagnosticBoundary, right: DiagnosticBoundary): number {
  return Date.parse(right.occurredAt) - Date.parse(left.occurredAt)
    || (left.id === right.id ? 0 : left.id > right.id ? -1 : 1);
}

function key(event: DiagnosticEventItem): DiagnosticBoundary {
  return { id: event.id, occurredAt: event.occurredAt };
}
