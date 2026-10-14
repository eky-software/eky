import { createHash } from 'node:crypto';
import { promises as fileSystem, type BigIntStats } from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';

import {
  decodeProfileInspectionDocumentBindings, encodeProfileInspectionDocumentBindings, profileInspectionMaximumDocumentBytes,
} from '../../runtime/profileInspectionDocumentBindings.js';
import {
  isProfileInspectionOperationId, parseColdProfileInspectionReceipt, parseProfileInspectionColdSources,
  parseOriginalProfileInspectionReceipt, parseProfileInspectionOriginalSources,
  type ProfileInspectionColdSources, type ProfileInspectionOriginalSources,
} from '../../runtime/profileInspectionMessages.js';
import type { ProfileRestoreColdInspectionResult } from './runProfileRestoreColdInspection.js';
import type { ProfileRestoreOriginalInspectionResult } from './runProfileRestoreOriginalInspection.js';
import { createDesktopProfilePaths } from '../../runtime/desktopProfilePaths.js';

const documentReadBatchSize = 4;

/** Fresh selected bytes only; the owning caller must also assert its journal, census, reservation and lineage. */
export async function assertProfileRestoreColdSourceBytes(input: {
  readonly operationRoot: string;
  readonly sources: ProfileInspectionColdSources;
  readonly result: ProfileRestoreColdInspectionResult;
  readonly signal: AbortSignal;
  readonly deadline: number;
  readonly assertAuthority: () => void;
  readonly assertFinalAuthority?: () => Promise<void>;
}): Promise<void> {
  const sources = parseProfileInspectionColdSources(input.sources);
  const receipt = parseColdProfileInspectionReceipt(input.result.receipt);
  if (sources === undefined || receipt === undefined || sources.databaseSlot !== receipt.databaseSlot ||
      sources.documentsSlot !== receipt.documentsSlot || !isAbsolute(input.operationRoot) ||
      !samePath(resolve(input.operationRoot), input.operationRoot) ||
      !isProfileInspectionOperationId(input.operationRoot.split(/[\\/]/).at(-1)) || !Number.isFinite(input.deadline)) throw invalid();
  const documents = decodeProfileInspectionDocumentBindings(encodeProfileInspectionDocumentBindings(input.result.documents), receipt);
  const activePaths = createDesktopProfilePaths(sources.workspaceRoot);
  const databasePath = sources.databaseSlot === 'active' ? activePaths.databaseFilePath
    : join(input.operationRoot, 'profile.sqlite');
  const documentsRoot = sources.documentsSlot === 'active' ? activePaths.invoiceDocumentStorageRoot
    : join(input.operationRoot, 'activation', 'storage', 'invoices');
  await assertSelectedBytes({ ...input, workspaceRoot: sources.workspaceRoot, databasePath, documentsRoot,
    database: receipt.database, documents });
}

/** The original role uses fixed layouts, never retargeting a forward receipt. */
export async function assertProfileRestoreOriginalSourceBytes(input: {
  readonly operationRoot: string;
  readonly sources: ProfileInspectionOriginalSources;
  readonly result: ProfileRestoreOriginalInspectionResult;
  readonly signal: AbortSignal;
  readonly deadline: number;
  readonly assertAuthority: () => void;
  readonly assertFinalAuthority: () => Promise<void>;
}): Promise<void> {
  const sources = parseProfileInspectionOriginalSources(input.sources);
  const receipt = parseOriginalProfileInspectionReceipt(input.result.status.result);
  const operationId = input.result.status.operationId;
  if (sources === undefined || receipt === undefined || input.result.status.type !== 'originalCompleted' ||
      !isProfileInspectionOperationId(operationId) || receipt.layout !== sources.layout ||
      receipt.databaseSlot !== sources.databaseSlot || receipt.documentsSlot !== sources.documentsSlot ||
      !isAbsolute(input.operationRoot) || !samePath(resolve(input.operationRoot), input.operationRoot) ||
      basename(input.operationRoot) !== operationId || !Number.isFinite(input.deadline)) throw invalid();
  const activePaths = createDesktopProfilePaths(sources.workspaceRoot);
  let rollbackRoot: string;
  if (sources.layout === 'profileRestore') {
    if (!samePath(input.operationRoot, join(sources.workspaceRoot, 'runtime', 'failed-profile-restores', operationId))) throw invalid();
    rollbackRoot = join(sources.workspaceRoot, 'runtime', 'profile-restore-rollback', operationId);
  } else {
    const installationRoot = dirname(dirname(dirname(dirname(input.operationRoot))));
    if (!samePath(input.operationRoot, join(installationRoot, 'workspace-replacement-operations', 'activation', 'failed', operationId)) ||
        !samePath(dirname(sources.workspaceRoot), join(installationRoot, 'workspaces')) ||
        !isProfileInspectionOperationId(basename(sources.workspaceRoot))) throw invalid();
    rollbackRoot = join(installationRoot, 'workspace-replacement-operations', 'activation', 'rollback', operationId);
  }
  const documentsRoot = sources.documentsSlot === 'absent' ? undefined : sources.documentsSlot === 'active'
    ? activePaths.invoiceDocumentStorageRoot : join(rollbackRoot, 'storage', 'invoices');
  if (receipt.databaseSlot === 'absent') {
    if (input.result.documents !== undefined) throw invalid();
    await assertSelectedBytes({ ...input, workspaceRoot: sources.workspaceRoot, documentsRoot, documents: [] });
    return;
  }
  if (input.result.documents === undefined) throw invalid();
  const documents = decodeProfileInspectionDocumentBindings(encodeProfileInspectionDocumentBindings(input.result.documents), receipt);
  if (documentsRoot === undefined && documents.length !== 0) throw invalid();
  const databasePath = sources.databaseSlot === 'active' ? activePaths.databaseFilePath : join(rollbackRoot, 'data', 'eky.sqlite');
  await assertSelectedBytes({ ...input, workspaceRoot: sources.workspaceRoot, databasePath, documentsRoot,
    database: receipt.database, documents });
}

async function assertSelectedBytes(input: {
  readonly operationRoot: string;
  readonly workspaceRoot: string;
  readonly databasePath?: string;
  readonly database?: { readonly byteSize: number; readonly sha256: string };
  readonly documentsRoot: string | undefined;
  readonly documents: readonly import('../../runtime/profileInspectionDocumentBindings.js').ProfileInspectionDocumentBinding[];
  readonly signal: AbortSignal;
  readonly deadline: number;
  readonly assertAuthority: () => void;
  readonly assertFinalAuthority?: () => Promise<void>;
}): Promise<void> {
  const assertTime = () => {
    if (input.signal.aborted || performance.now() >= input.deadline) throw new Error('PROFILE_INSPECTION_TIMEOUT');
  };
  const assertCurrent = () => {
    assertTime();
    input.assertAuthority();
    assertTime();
  };
  assertCurrent();
  const roots = [...new Set([input.operationRoot, input.workspaceRoot,
    ...(input.databasePath === undefined ? [] : [dirname(input.databasePath)]),
    ...(input.documentsRoot === undefined ? [] : [input.documentsRoot])])];
  const identities = new Map<string, BigIntStats>();
  const files: { path: string; identity: BigIntStats }[] = [];
  for (const root of roots) { assertCurrent(); identities.set(root, await inspectRoot(root)); }
  let batchFailed = false;
  let firstBatchFailure: unknown;
  const captureFailure = (error: unknown) => {
    if (!batchFailed) { batchFailed = true; firstBatchFailure = error; }
  };
  const assertBatchCurrent = () => {
    if (batchFailed) throw firstBatchFailure;
    try { assertCurrent(); }
    catch (error) { captureFailure(error); throw error; }
  };
  for (let offset = 0; offset < input.documents.length; offset += documentReadBatchSize) {
    assertBatchCurrent();
    const outcomes = await Promise.allSettled(input.documents.slice(offset, offset + documentReadBatchSize).map(async document => {
      try {
        assertBatchCurrent();
        if (input.documentsRoot === undefined) throw invalid();
        const path = join(input.documentsRoot, ...document.storagePath.split('/'));
        const identity = await assertFileBytes(path, document, profileInspectionMaximumDocumentBytes,
          assertBatchCurrent, true, captureFailure);
        return { path, identity };
      } catch (error) { captureFailure(error); throw error; }
    }));
    if (batchFailed) {
      const others = [...new Set(outcomes.filter(item => item.status === 'rejected')
        .map(item => item.reason as unknown).filter(error => error !== firstBatchFailure))];
      if (others.length !== 0) throw new AggregateError([firstBatchFailure, ...others], 'PROFILE_INSPECTION_PDF_BATCH_FAILED');
      throw firstBatchFailure;
    }
    for (const outcome of outcomes) {
      if (outcome.status !== 'fulfilled') throw invalid();
      files.push(outcome.value);
    }
  }
  if (input.databasePath !== undefined && input.database !== undefined) {
    files.push({ path: input.databasePath, identity: await assertFileBytes(input.databasePath, input.database, 24 * 1024 ** 3, assertCurrent, false) });
  }
  await input.assertFinalAuthority?.();
  assertCurrent();
  for (const [root, before] of identities) {
    assertCurrent();
    const after = await inspectRoot(root);
    if (before.dev !== after.dev || before.ino !== after.ino) throw invalid();
  }
  assertCurrent();
  // Finish caller callbacks before rebinding every file checked earlier in the loop.
  for (const { path, identity } of files) {
    assertTime();
    assertSameFile(identity, await fileSystem.lstat(path, { bigint: true }));
    if (!samePath(await fileSystem.realpath(path), path)) throw invalid();
  }
  assertTime();
}

async function assertFileBytes(
  path: string, expected: { readonly byteSize: number; readonly sha256: string }, maximumBytes: number,
  assertCurrent: () => void, pdf: boolean, observeFailure: (error: unknown) => void = () => {},
): Promise<BigIntStats> {
  assertCurrent();
  const before = await fileSystem.lstat(path, { bigint: true });
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1n || before.ino <= 0n ||
      before.size !== BigInt(expected.byteSize) || before.size > BigInt(maximumBytes) ||
      !samePath(await fileSystem.realpath(path), path)) throw invalid();
  assertCurrent();
  const handle = await fileSystem.open(path, 'r');
  let firstFailure: unknown;
  try {
    assertSameFile(before, await handle.stat({ bigint: true }));
    const hash = createHash('sha256');
    const buffer = Buffer.alloc(64 * 1024);
    let position = 0;
    let signature = Buffer.alloc(0);
    while (true) {
      assertCurrent();
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
      assertCurrent();
      if (bytesRead === 0) break;
      const bytes = buffer.subarray(0, bytesRead);
      if (pdf && signature.length < 5) signature = Buffer.concat([signature, bytes.subarray(0, 5 - signature.length)]);
      position += bytesRead;
      if (position > expected.byteSize) throw invalid();
      hash.update(bytes);
    }
    assertSameFile(before, await fileSystem.lstat(path, { bigint: true }));
    assertSameFile(before, await handle.stat({ bigint: true }));
    if (position !== expected.byteSize || hash.digest('hex') !== expected.sha256 ||
        (pdf && !signature.equals(Buffer.from('%PDF-', 'ascii'))) || !samePath(await fileSystem.realpath(path), path)) throw invalid();
    assertCurrent();
    return before;
  } catch (error) {
    firstFailure = error;
    // Stop sibling reads before an awaited close can delay the original failure.
    observeFailure(error);
    throw error;
  }
  finally {
    try { await handle.close(); }
    catch (error) { throw new AggregateError([...(firstFailure === undefined ? [] : [firstFailure]), error], 'PROFILE_INSPECTION_FILE_CLOSE_FAILED'); }
  }
}

async function inspectRoot(path: string): Promise<BigIntStats> {
  const metadata = await fileSystem.lstat(path, { bigint: true });
  if (!metadata.isDirectory() || metadata.isSymbolicLink() || metadata.ino <= 0n ||
      (process.platform !== 'win32' && (metadata.mode & 0o077n) !== 0n) || !samePath(await fileSystem.realpath(path), path)) throw invalid();
  return metadata;
}
function assertSameFile(first: BigIntStats, second: BigIntStats): void {
  if (!second.isFile() || second.isSymbolicLink() || second.nlink !== 1n || first.dev !== second.dev || first.ino !== second.ino ||
      first.size !== second.size || first.mtimeNs !== second.mtimeNs || first.ctimeNs !== second.ctimeNs) throw invalid();
}
function samePath(first: string, second: string): boolean { return process.platform === 'win32' ? first.toLowerCase() === second.toLowerCase() : first === second; }
function invalid(): Error { return new Error('PROFILE_INSPECTION_PROTOCOL_INVALID'); }
