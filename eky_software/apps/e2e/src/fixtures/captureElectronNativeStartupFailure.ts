import fs, { type BigIntStats } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

import { electronE2eBackendStartupStages, parseElectronE2eBackendFailureObservation, readElectronE2eBackendFailureCode, type ElectronE2eBackendFailureObservation } from '../../../desktop/e2e/electronE2eBackendStatus.js';
import { readSafeStartupFailureCode } from '../../../desktop/src/main/earlyStartup.js';
import { electronNativeObservationsPath } from '../environment/electronNativeObservationsPath.js';

const maximumBytes = 64 * 1024;
const maximumRecords = 128;
const backendFailureCodes = new Set<string>(
  electronE2eBackendStartupStages.map(readElectronE2eBackendFailureCode),
);
const errorBoxReasons = ['backendUnexpectedExit', 'other', 'startupFailed', 'uiLoadFailed'] as const;
type ErrorBoxReason = typeof errorBoxReasons[number];

export type ElectronNativeStartupFailureCapture =
  | Readonly<{ status: 'notRequested' | 'missing' | 'invalid' | 'tooLarge' | 'sourceChanged' | 'readFailed' }>
  | Readonly<{
      status: 'captured';
      startupFailureCodes: readonly string[];
      errorBoxReasons: readonly ErrorBoxReason[];
      backendFailure?: ElectronE2eBackendFailureObservation;
    }>;

// Each generation has its own fixed file. Capture before cleanup; a missing
// record does not prove that startup succeeded or that no error box occurred.
export function captureElectronNativeStartupFailure(input: {
  runRoot: string;
  artifactsRoot: string;
  runtimeInstanceId: string;
}): ElectronNativeStartupFailureCapture {
  let descriptor: number | undefined;
  try {
    const path = electronNativeObservationsPath(input.artifactsRoot, input.runtimeInstanceId);
    const directories = captureDirectories(input.runRoot, input.artifactsRoot);
    const unchangedDirectories = () => directories.every(({ path: directory, metadata }) =>
      sameIdentity(metadata, safeDirectory(directory)));
    const before = fs.lstatSync(path, { bigint: true });
    assertSafeFile(before);
    descriptor = fs.openSync(path, fs.constants.O_RDONLY |
      (fs.constants.O_NOFOLLOW ?? 0) | (fs.constants.O_NONBLOCK ?? 0));
    const opened = fs.fstatSync(descriptor, { bigint: true });
    assertSafeFile(opened);
    if (!sameIdentity(before, opened) || !unchangedDirectories()) return { status: 'invalid' };
    if (opened.size > BigInt(maximumBytes)) return { status: 'tooLarge' };
    const buffer = Buffer.alloc(Number(opened.size));
    let bytes = 0;
    while (bytes < buffer.length) {
      const count = fs.readSync(descriptor, buffer, bytes, buffer.length - bytes, bytes);
      if (count === 0) break;
      bytes += count;
    }
    const after = fs.fstatSync(descriptor, { bigint: true });
    const current = fs.lstatSync(path, { bigint: true });
    assertSafeFile(after);
    assertSafeFile(current);
    if (!sameIdentity(opened, after) || !sameIdentity(opened, current) || !unchangedDirectories()) {
      return { status: 'invalid' };
    }
    if (bytes !== buffer.length || !sameContents(before, opened) ||
        !sameContents(opened, after) || !sameContents(after, current)) return { status: 'sourceChanged' };
    return parseRecords(buffer.toString('utf8'));
  } catch (error) {
    return Object.freeze({ status: error instanceof Error && 'code' in error && error.code === 'ENOENT'
      ? 'missing' : error instanceof UnsafeObservation ? 'invalid' : 'readFailed' });
  } finally {
    if (descriptor !== undefined) {
      try { fs.closeSync(descriptor); } catch { /* Diagnostic failure cannot replace launch failure. */ }
    }
  }
}

function parseRecords(text: string): ElectronNativeStartupFailureCapture {
  if (text !== '' && !text.endsWith('\n')) return { status: 'invalid' };
  const lines = text.split('\n').filter((line) => line !== '');
  if (lines.length > maximumRecords) return { status: 'tooLarge' };
  const codes = new Set<string>();
  const reasons = new Set<ErrorBoxReason>();
  let firstStartupFailure = true;
  let backendFailure: ElectronE2eBackendFailureObservation | undefined;
  for (const line of lines) {
    let value: unknown;
    try { value = JSON.parse(line) as unknown; } catch { return { status: 'invalid' }; }
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return { status: 'invalid' };
    const record = value as Record<string, unknown>;
    if (record.operation === 'startupFailure') {
      if (typeof record.errorCode !== 'string') return { status: 'invalid' };
      const code = readSafeStartupFailureCode(new Error(record.errorCode));
      // Only the test backend's closed catalog may retain a smoke suffix.
      codes.add(code.startsWith('DESKTOP_SMOKE_') && !backendFailureCodes.has(code)
        ? 'PACKAGED_SMOKE_FAILED' : code);
      if (record.backendFailure !== undefined) {
        const parsed = parseElectronE2eBackendFailureObservation(record.backendFailure);
        if (parsed === undefined || code !== readElectronE2eBackendFailureCode(parsed.status.stage)) {
          return { status: 'invalid' };
        }
        if (firstStartupFailure) backendFailure = parsed;
      }
      firstStartupFailure = false;
    } else if (record.operation === 'showErrorBox') {
      const reason = errorBoxReasons.find((candidate) => candidate === record.reason);
      if (reason === undefined) return { status: 'invalid' };
      reasons.add(reason);
    }
  }
  return Object.freeze({
    status: 'captured',
    startupFailureCodes: Object.freeze([...codes].sort()),
    errorBoxReasons: Object.freeze(errorBoxReasons.filter((reason) => reasons.has(reason))),
    ...(backendFailure === undefined ? {} : { backendFailure }),
  });
}

class UnsafeObservation extends Error {}

function captureDirectories(runRoot: string, artifactsRoot: string) {
  const comparable = (path: string) => process.platform === 'win32' ? path.toLowerCase() : path;
  for (const path of [runRoot, artifactsRoot]) {
    if (!isAbsolute(path) || path.includes('\0') || comparable(resolve(path)) !== comparable(path)) {
      throw new UnsafeObservation();
    }
  }
  const base = join(fs.realpathSync.native(tmpdir()), 'eky-e2e');
  if (comparable(dirname(runRoot)) !== comparable(base) || !/^run-[A-Za-z0-9_-]+$/u.test(basename(runRoot))) {
    throw new UnsafeObservation();
  }
  const child = relative(runRoot, artifactsRoot);
  if (child === '' || isAbsolute(child) || child.split(sep).includes('..')) throw new UnsafeObservation();
  const paths = [base, runRoot];
  for (const part of child.split(sep)) paths.push(join(paths[paths.length - 1]!, part));
  return paths.map((path) => ({ path, metadata: safeDirectory(path) }));
}

function safeDirectory(path: string): BigIntStats {
  const metadata = fs.lstatSync(path, { bigint: true });
  const canonical = fs.realpathSync.native(path);
  if (!metadata.isDirectory() || metadata.isSymbolicLink() ||
      (process.platform === 'win32' ? canonical.toLowerCase() !== path.toLowerCase() : canonical !== path)) {
    throw new UnsafeObservation();
  }
  return metadata;
}

function assertSafeFile(metadata: BigIntStats): void {
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1n || metadata.size < 0n) {
    throw new UnsafeObservation();
  }
}

function sameIdentity(left: BigIntStats, right: BigIntStats): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

function sameContents(left: BigIntStats, right: BigIntStats): boolean {
  return left.size === right.size && left.mtimeNs === right.mtimeNs && left.ctimeNs === right.ctimeNs;
}
