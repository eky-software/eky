import { lstat, realpath } from 'node:fs/promises';
import { basename, resolve } from 'node:path';

import { validateWorkspaceId } from '../registry/workspaceIdValidation.js';
import { WorkspaceLegacyAdoptionError } from './workspaceLegacyAdoptionError.js';
import { deriveWorkspaceLegacyAdoptionPaths, type WorkspaceLegacyAdoptionPaths } from './workspaceLegacyAdoptionPaths.js';

export interface WorkspaceLegacyAdoptionMutationAuthority {
  assertCurrent(): Promise<void>;
  assertMutationCurrent(): void;
  onUncertain(error: unknown): void;
}

export interface WorkspaceLegacyAdoptionRootReceiptSelection {
  assertCurrent(): Promise<void>;
  acknowledgeCreatedDirectory(path: string): Promise<void>;
  acknowledgePublishedCandidate?(): Promise<void>;
  acknowledgeRemovedRoot?(path: string): Promise<void>;
}

export function captureAdoptionMutationAuthority(authority: WorkspaceLegacyAdoptionMutationAuthority | undefined) {
  if (authority === undefined) return undefined;
  if (authority === null || typeof authority.assertCurrent !== 'function' ||
      typeof authority.assertMutationCurrent !== 'function' || typeof authority.onUncertain !== 'function') invalid();
  return Object.freeze({ assertCurrent: authority.assertCurrent.bind(authority),
    assertMutationCurrent: authority.assertMutationCurrent.bind(authority), onUncertain: authority.onUncertain.bind(authority) });
}

export function assertAdoptionMutationCurrent(authority: WorkspaceLegacyAdoptionMutationAuthority | undefined): void {
  if (authority === undefined) return;
  const result: unknown = authority.assertMutationCurrent();
  if (result !== undefined) {
    void Promise.resolve(result).catch(() => undefined);
    invalid();
  }
}

// This call's exact directory selection, not a new process or lifecycle owner.
export async function captureAdoptionRootSelection(
  input: Readonly<WorkspaceLegacyAdoptionPaths>, target: 'operation' | 'published' | 'preparation',
  authority: WorkspaceLegacyAdoptionMutationAuthority | undefined,
) {
  if (authority === undefined) return undefined;
  assertAdoptionMutationCurrent(authority);
  const paths = captureAdoptionRootPaths(input);
  const names = target === 'published'
    ? [paths.userDataRoot, paths.workspacesRoot, paths.finalRoot]
    : [paths.userDataRoot, paths.operationsRoot, paths.operationRoot, paths.candidateRoot,
      ...(target === 'preparation' ? [paths.candidateRuntimeRoot] : [])];
  const entries: { path: string; identity: Awaited<ReturnType<typeof directoryIdentity>> }[] = [];
  for (const path of names) {
    const identity = await directoryIdentity(path, path !== paths.userDataRoot);
    assertAdoptionMutationCurrent(authority);
    if (path === paths.userDataRoot && identity === undefined) invalid();
    entries.push({ path, identity });
  }
  const selection = { async assertCurrent() {
    for (const entry of entries) {
      const current = await directoryIdentity(entry.path, entry.path !== paths.userDataRoot);
      assertAdoptionMutationCurrent(authority);
      if (entry.identity === undefined ? current !== undefined : current === undefined ||
          current.dev !== entry.identity.dev || current.ino !== entry.identity.ino) invalid();
    }
  }, async acknowledgeCreatedDirectory(path: string) {
    const entry = entries.find(value => samePath(value.path, path));
    if (entry === undefined || entry.identity !== undefined) invalid();
    const identity = await directoryIdentity(entry.path, true);
    assertAdoptionMutationCurrent(authority);
    if (identity === undefined) invalid();
    entry.identity = identity;
    await selection.assertCurrent();
  } };
  return Object.freeze(selection);
}

export function observeAdoptionMutationFailure(authority: WorkspaceLegacyAdoptionMutationAuthority | undefined, error: unknown): void {
  try {
    const result: unknown = authority?.onUncertain(error);
    if (result !== undefined) void Promise.resolve(result).catch(() => undefined);
  } catch { /* Optional notification cannot replace the original failure. */ }
}

export function captureAdoptionRootPaths(input: Readonly<WorkspaceLegacyAdoptionPaths>) {
  const paths = deriveWorkspaceLegacyAdoptionPaths(input.userDataRoot, basename(input.operationRoot),
    validateWorkspaceId(basename(input.finalRoot)));
  if (Object.entries(paths).some(([key, value]) => !samePath(value, input[key as keyof WorkspaceLegacyAdoptionPaths]))) invalid();
  return paths;
}

export async function directoryIdentity(path: string, privateMode: boolean,
  authority?: WorkspaceLegacyAdoptionMutationAuthority) {
  let observed = false;
  try {
    const metadata = await lstat(path, { bigint: true });
    observed = true;
    assertAdoptionMutationCurrent(authority);
    if (!metadata.isDirectory() || metadata.isSymbolicLink() || metadata.ino === 0n ||
        (privateMode && process.platform !== 'win32' && (metadata.mode & 0o077n) !== 0n) ||
        !samePath(await realpath(path), path)) invalid();
    assertAdoptionMutationCurrent(authority);
    return Object.freeze({ dev: metadata.dev, ino: metadata.ino });
  } catch (error) {
    if (!observed && error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined;
    throw error;
  }
}

export function samePath(left: string, right: string) {
  return process.platform === 'win32' ? resolve(left).toLowerCase() === resolve(right).toLowerCase()
    : resolve(left) === resolve(right);
}

function invalid(): never { throw new WorkspaceLegacyAdoptionError('WORKSPACE_ADOPTION_RECOVERY_REQUIRED'); }
