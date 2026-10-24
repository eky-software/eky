import type { BigIntStats } from 'node:fs';
import { lstat, open, opendir } from 'node:fs/promises';
import { join } from 'node:path';

import { observeDiagnosticReadFailure } from '../application/observeDiagnosticReadFailure.js';
import { DiagnosticBrowseError, DiagnosticBrowseLimitError, type DiagnosticBrowsePolicy } from '../domain/diagnosticBrowsePolicy.js';
import type { DiagnosticReadIssue } from '../domain/diagnosticReadState.js';
import type { DiagnosticReadFailureObserver } from '../ports/diagnosticReadFailureObserver.js';
import { diagnosticLogBelongsToDirectory, diagnosticLogFileNamePattern } from './diagnosticLogSources.js';

export type DiagnosticFileIdentity = { dev: bigint; ino: bigint };
export type DiagnosticReadHandle = { close(): Promise<void> };
type Directory = { path: string; identity: DiagnosticFileIdentity };
export type DiagnosticBrowseSource = { path: string; parent: Directory;
  identity: DiagnosticFileIdentity; size: number; component: 'backend' | 'desktop'; digest?: string };
export type DiagnosticBrowseSnapshot = { root: Directory; directories: Directory[];
  sources: DiagnosticBrowseSource[]; issues: Set<DiagnosticReadIssue>; bytes: number };

export async function* captureDiagnosticBrowseSources(
  root: string, policy: DiagnosticBrowsePolicy, assertActive: () => void,
  handles: Set<DiagnosticReadHandle>, observer?: DiagnosticReadFailureObserver,
): AsyncGenerator<number, DiagnosticBrowseSnapshot> {
  const rootStat = await lstat(root, { bigint: true });
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error('Diagnostic root is unavailable.');
  const snapshot: DiagnosticBrowseSnapshot = { root: { path: root, identity: identity(rootStat) },
    directories: [], sources: [], issues: new Set(), bytes: 0 };
  const names: { path: string; parent: Directory; component: 'backend' | 'desktop' }[] = [];
  let entries = 0;
  // Directory handles never survive a response; file metadata capture below can yield.
  for (const directory of ['backend', 'desktop', 'security']) {
    assertActive();
    const path = join(root, directory);
    let stat: BigIntStats;
    try { stat = await lstat(path, { bigint: true }); }
    catch (error) {
      if (!isMissing(error)) {
        observeDiagnosticReadFailure(observer, error);
        snapshot.issues.add('sourceUnavailable');
      }
      continue;
    }
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      snapshot.issues.add('sourceUnavailable');
      continue;
    }
    const parent: Directory = { path, identity: identity(stat) };
    snapshot.directories.push(parent);
    try {
      const handle = await opendir(path);
      handles.add(handle);
      try {
        for (let entry = await handle.read(); entry !== null; entry = await handle.read()) {
          assertActive();
          if (++entries > policy.directoryEntries) throw new DiagnosticBrowseLimitError();
          if (!diagnosticLogFileNamePattern.test(entry.name) || !diagnosticLogBelongsToDirectory(entry.name, directory)) continue;
          if (!entry.isFile() || entry.isSymbolicLink()) {
            snapshot.issues.add('sourceUnavailable');
            continue;
          }
          if (names.length >= policy.sources) throw new DiagnosticBrowseLimitError();
          names.push({ path: join(path, entry.name), parent,
            component: entry.name.startsWith('backend-') ? 'backend' : 'desktop' });
          if (serializedBytes(names) + diagnosticSnapshotStateBytes(snapshot) > policy.stateBytes) {
            throw new DiagnosticBrowseLimitError();
          }
        }
      } catch (error) {
        observeDiagnosticReadFailure(observer, error);
        throw error;
      } finally { await handle.close(); handles.delete(handle); }
    } catch (error) {
      if (error instanceof DiagnosticBrowseLimitError || error instanceof DiagnosticBrowseError || handles.size > 0) throw error;
      observeDiagnosticReadFailure(observer, error);
      snapshot.issues.add('sourceUnavailable');
    }
  }
  for (const name of names) {
    assertActive();
    await assertDiagnosticDirectory(snapshot.root);
    await assertDiagnosticDirectory(name.parent);
    try {
      const stat = await lstat(name.path, { bigint: true });
      if (!stat.isFile() || stat.isSymbolicLink()) snapshot.issues.add('sourceUnavailable');
      else {
        if (stat.size > BigInt(policy.sourceBytes - snapshot.bytes)) throw new DiagnosticBrowseLimitError();
        const handle = await open(name.path, 'r');
        handles.add(handle);
        try {
          const opened = await handle.stat({ bigint: true });
          if (!opened.isFile() || !sameDiagnosticIdentity(opened, stat)) throw new DiagnosticBrowseError('diagnostic_browse_stale');
        } catch (error) {
          observeDiagnosticReadFailure(observer, error);
          throw error;
        } finally {
          await handle.close();
          handles.delete(handle);
        }
        snapshot.bytes += Number(stat.size);
        snapshot.sources.push({ ...name, size: Number(stat.size), identity: identity(stat) });
        if (serializedBytes(names) + diagnosticSnapshotStateBytes(snapshot) > policy.stateBytes) {
          throw new DiagnosticBrowseLimitError();
        }
      }
    } catch (error) {
      if (error instanceof DiagnosticBrowseLimitError || error instanceof DiagnosticBrowseError || handles.size > 0) throw error;
      observeDiagnosticReadFailure(observer, error);
      snapshot.issues.add('sourceUnavailable');
    }
    yield 5;
  }
  await assertDiagnosticDirectory(snapshot.root);
  yield 1;
  for (const directory of snapshot.directories) {
    assertActive();
    await assertDiagnosticDirectory(directory);
    yield 1;
  }
  return snapshot;
}

export async function assertDiagnosticDirectory(directory: Directory): Promise<void> {
  const current = await lstat(directory.path, { bigint: true });
  if (!current.isDirectory() || current.isSymbolicLink() || !sameDiagnosticIdentity(current, directory.identity)) {
    throw new DiagnosticBrowseError('diagnostic_browse_stale');
  }
}

export async function assertDiagnosticSource(snapshot: DiagnosticBrowseSnapshot, source: DiagnosticBrowseSource): Promise<void> {
  await assertDiagnosticDirectory(snapshot.root);
  await assertDiagnosticDirectory(source.parent);
  const current = await lstat(source.path, { bigint: true });
  if (!current.isFile() || current.isSymbolicLink() || !sameDiagnosticIdentity(current, source.identity)
    || current.size < BigInt(source.size)) throw new DiagnosticBrowseError('diagnostic_browse_stale');
}

export function sameDiagnosticIdentity(left: DiagnosticFileIdentity, right: DiagnosticFileIdentity): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

export function diagnosticSnapshotStateBytes(snapshot: DiagnosticBrowseSnapshot): number {
  return serializedBytes(snapshot);
}

function serializedBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value, (_key, value: unknown) =>
    typeof value === 'bigint' ? value.toString() : value instanceof Set ? [...value] : value));
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

function identity(stat: BigIntStats): DiagnosticFileIdentity { return { dev: stat.dev, ino: stat.ino }; }
