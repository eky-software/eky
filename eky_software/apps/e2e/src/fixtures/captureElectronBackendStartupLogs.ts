import fs, { type BigIntStats } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

import {
  backendOperationalEventSpecs,
  type BackendOperationalEventName,
  type OperationalEventOutcome,
} from '../../../backend/src/observability/operationalEvent.js';
import { validateBackendOperationalEvent } from '../../../backend/src/observability/operationalEventValidator.js';

const maximumDirectoryEntries = 64;
const maximumFiles = 16;
const maximumFileBytes = 64 * 1024;
const maximumTotalBytes = 256 * 1024;
const maximumLineBytes = 16 * 1024;
const runtimeIdentityPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

// Catalog order is for stable serialization, not chronology or stage completion.
const startupNames = [
  'backend.starting', 'backend.started',
  'operationalLog.retentionCompleted',
  'database.opening', 'database.opened', 'database.openFailed',
  'database.integrityCheckFailed',
  'migration.started', 'migration.completed', 'migration.failed',
  'businessAudit.retentionCompleted', 'businessAudit.retentionFailed',
] as const satisfies readonly BackendOperationalEventName[];
const shutdownNames = [
  'backend.shutdownStarted', 'backend.shutdownCompleted',
] as const satisfies readonly BackendOperationalEventName[];

export type ElectronBackendStartupLogsCaptureInput = Readonly<{
  runRoot: string;
  userDataPath: string;
  runtimeInstanceId: string;
}>;

export type ElectronBackendStartupLogsIssue =
  | 'unsafeRoot' | 'invalidRuntimeIdentity' | 'missing' | 'readFailed'
  | 'unsafeFile' | 'sourceChanged' | 'directoryLimit' | 'fileLimit'
  | 'byteLimit' | 'lineLimit' | 'incompleteLine' | 'invalidEvent';

type ObservedEvent<Name extends BackendOperationalEventName> = Readonly<{
  eventName: Name;
  outcome: OperationalEventOutcome;
}>;

export type ElectronBackendStartupLogsCapture =
  | Readonly<{ status: 'notRequested' }>
  | Readonly<{
      status: 'captured' | 'partial' | 'unavailable';
      issues: readonly ElectronBackendStartupLogsIssue[];
      startup: readonly ObservedEvent<typeof startupNames[number]>[];
      shutdown: readonly ObservedEvent<typeof shutdownNames[number]>[];
    }>;

interface DirectoryIdentity { path: string; metadata: BigIntStats }
interface CaptureState {
  issues: Set<ElectronBackendStartupLogsIssue>;
  observed: Set<BackendOperationalEventName>;
  remainingBytes: number;
}

class CaptureFailure extends Error {
  constructor(readonly issue: ElectronBackendStartupLogsIssue) {
    super('E2E_BACKEND_STARTUP_LOG_CAPTURE_UNAVAILABLE');
  }
}

// The fixture calls once on startup failure, before its cleanup. Missing events
// remain unknown: the writer is best effort and this is not an atomic snapshot.
export function captureElectronBackendStartupLogs(
  input: ElectronBackendStartupLogsCaptureInput,
): ElectronBackendStartupLogsCapture {
  const state: CaptureState = {
    issues: new Set(), observed: new Set(), remainingBytes: maximumTotalBytes,
  };
  try {
    if (typeof input.runtimeInstanceId !== 'string' || !runtimeIdentityPattern.test(input.runtimeInstanceId)) {
      throw new CaptureFailure('invalidRuntimeIdentity');
    }
    const directories = captureDirectoryIdentities(input);
    const backendDirectory = directories[directories.length - 1]!.path;
    const candidates = listCandidates(backendDirectory, state);
    assertDirectoriesUnchanged(directories);
    if (candidates.length === 0 && state.issues.size === 0) {
      state.issues.add('missing');
      return snapshot('unavailable', state);
    }
    if (candidates.length > maximumFiles) state.issues.add('fileLimit');
    for (const name of candidates.slice(0, maximumFiles)) {
      if (state.remainingBytes === 0) {
        state.issues.add('byteLimit');
        break;
      }
      assertDirectoriesUnchanged(directories);
      readCandidate(join(backendDirectory, name), directories, input.runtimeInstanceId, state);
    }
    assertDirectoriesUnchanged(directories);
    return snapshot(state.issues.size === 0 ? 'captured' : 'partial', state);
  } catch (error) {
    state.issues.add(classifyFailure(error));
    state.observed.clear();
    return snapshot('unavailable', state);
  }
}

function captureDirectoryIdentities(input: ElectronBackendStartupLogsCaptureInput): DirectoryIdentity[] {
  if (!isNormalizedAbsolute(input.runRoot) || !isNormalizedAbsolute(input.userDataPath)) {
    throw new CaptureFailure('unsafeRoot');
  }
  const base = join(fs.realpathSync.native(tmpdir()), 'eky-e2e');
  if (comparable(dirname(input.runRoot)) !== comparable(base) ||
      !/^run-[A-Za-z0-9_-]+$/u.test(basename(input.runRoot))) {
    throw new CaptureFailure('unsafeRoot');
  }
  const child = relative(input.runRoot, input.userDataPath);
  if (child === '' || isAbsolute(child) || child.split(sep).includes('..')) {
    throw new CaptureFailure('unsafeRoot');
  }
  const paths = [base, input.runRoot];
  for (const segment of [...child.split(sep), 'runtime', 'logs', 'backend']) {
    paths.push(join(paths[paths.length - 1]!, segment));
  }
  return paths.map((path) => ({ path, metadata: safeDirectory(path) }));
}

function isNormalizedAbsolute(path: string): boolean {
  return typeof path === 'string' && !path.includes('\0') && isAbsolute(path) &&
    comparable(path) === comparable(resolve(path));
}

function comparable(path: string): string {
  return process.platform === 'win32' ? path.toLowerCase() : path;
}

function safeDirectory(path: string): BigIntStats {
  const metadata = fs.lstatSync(path, { bigint: true });
  if (!metadata.isDirectory() || metadata.isSymbolicLink() ||
      comparable(fs.realpathSync.native(path)) !== comparable(path)) {
    throw new CaptureFailure('unsafeRoot');
  }
  return metadata;
}

function assertDirectoriesUnchanged(directories: readonly DirectoryIdentity[]): void {
  for (const directory of directories) {
    if (!sameIdentity(directory.metadata, safeDirectory(directory.path))) {
      throw new CaptureFailure('unsafeRoot');
    }
  }
}

function listCandidates(directoryPath: string, state: CaptureState): string[] {
  const directory = fs.opendirSync(directoryPath, { bufferSize: 1 });
  const names: string[] = [];
  try {
    for (let count = 0; count < maximumDirectoryEntries; count++) {
      const entry = directory.readSync();
      if (entry === null) return names.sort();
      // This test-only selector intentionally does not duplicate writer naming.
      if (entry.name.endsWith('.jsonl')) names.push(entry.name);
    }
    // Do not read a 65th entry just to distinguish exactly full from overflow.
    state.issues.add('directoryLimit');
    return names.sort();
  } finally {
    directory.closeSync();
  }
}

function readCandidate(
  path: string,
  directories: readonly DirectoryIdentity[],
  runtimeInstanceId: string,
  state: CaptureState,
): void {
  let descriptor: number | undefined;
  try {
    const before = fs.lstatSync(path, { bigint: true });
    assertSafeFile(before);
    descriptor = fs.openSync(path, fs.constants.O_RDONLY |
      (fs.constants.O_NOFOLLOW ?? 0) | (fs.constants.O_NONBLOCK ?? 0));
    const opened = fs.fstatSync(descriptor, { bigint: true });
    assertSafeFile(opened);
    if (!sameIdentity(before, opened)) throw new CaptureFailure('unsafeFile');
    assertDirectoriesUnchanged(directories);
    const fileSize = Number(opened.size);
    const byteCount = Math.min(fileSize, maximumFileBytes, state.remainingBytes);
    state.remainingBytes -= byteCount;
    const start = fileSize - byteCount;
    if (start > 0) state.issues.add('byteLimit');
    const buffer = Buffer.alloc(byteCount);
    let bytesRead = 0;
    while (bytesRead < byteCount) {
      const count = fs.readSync(descriptor, buffer, bytesRead, byteCount - bytesRead, start + bytesRead);
      if (count === 0) break;
      bytesRead += count;
    }
    const after = fs.fstatSync(descriptor, { bigint: true });
    const current = fs.lstatSync(path, { bigint: true });
    assertSafeFile(after);
    assertSafeFile(current);
    if (!sameIdentity(opened, after) || !sameIdentity(opened, current)) {
      throw new CaptureFailure('unsafeFile');
    }
    assertDirectoriesUnchanged(directories);
    if (before.size !== opened.size || opened.size !== after.size ||
        after.size !== current.size || bytesRead !== byteCount ||
        opened.mtimeNs !== after.mtimeNs || opened.ctimeNs !== after.ctimeNs) {
      state.issues.add('sourceChanged');
    }
    parseCompleteLines(buffer.subarray(0, bytesRead), start > 0, runtimeInstanceId, state);
  } catch (error) {
    if (error instanceof CaptureFailure && error.issue === 'unsafeRoot') throw error;
    state.issues.add(classifyFailure(error));
  } finally {
    if (descriptor !== undefined) {
      try { fs.closeSync(descriptor); } catch { state.issues.add('readFailed'); }
    }
  }
}

function sameIdentity(left: BigIntStats, right: BigIntStats): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

function assertSafeFile(metadata: BigIntStats): void {
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1n ||
      metadata.size < 0n || metadata.size > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new CaptureFailure('unsafeFile');
  }
}

function parseCompleteLines(
  buffer: Buffer,
  startsInsideFile: boolean,
  runtimeInstanceId: string,
  state: CaptureState,
): void {
  let offset = 0;
  if (startsInsideFile) {
    const firstNewline = buffer.indexOf(10);
    if (firstNewline < 0) {
      state.issues.add('incompleteLine');
      return;
    }
    offset = firstNewline + 1;
  }
  while (offset < buffer.length) {
    const newline = buffer.indexOf(10, offset);
    if (newline < 0) {
      state.issues.add('incompleteLine');
      return;
    }
    const end = newline > offset && buffer[newline - 1] === 13 ? newline - 1 : newline;
    if (end - offset > maximumLineBytes) {
      state.issues.add('lineLimit');
    } else if (end > offset) {
      try {
        const event = validateBackendOperationalEvent(JSON.parse(buffer.toString('utf8', offset, end)) as unknown);
        if (event.runtimeInstanceId === runtimeInstanceId &&
            (startupNames.some((name) => name === event.eventName) ||
             shutdownNames.some((name) => name === event.eventName))) {
          state.observed.add(event.eventName);
        }
      } catch {
        state.issues.add('invalidEvent');
      }
    }
    offset = newline + 1;
  }
}

function classifyFailure(error: unknown): ElectronBackendStartupLogsIssue {
  if (error instanceof CaptureFailure) return error.issue;
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
    ? 'missing' : 'readFailed';
}

function snapshot(
  status: 'captured' | 'partial' | 'unavailable',
  state: CaptureState,
): ElectronBackendStartupLogsCapture {
  const project = <Name extends BackendOperationalEventName>(names: readonly Name[]) =>
    Object.freeze(names.filter((name) => state.observed.has(name)).map((eventName) =>
      Object.freeze({ eventName, outcome: backendOperationalEventSpecs[eventName].outcome })));
  return Object.freeze({
    status,
    issues: Object.freeze([...state.issues].sort()),
    startup: project(startupNames),
    shutdown: project(shutdownNames),
  });
}
