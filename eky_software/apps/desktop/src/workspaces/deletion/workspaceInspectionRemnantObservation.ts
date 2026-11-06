import { invalidDeletionData } from './workspaceDeletionDataValidation.js';
import { deriveWorkspaceInspectionRemnantPaths } from './workspaceInspectionRemnantPaths.js';
import { workspaceRemnantBindingInvalidCode as invalidCode } from './workspaceRemnantBindingCodec.js';
import type { WorkspaceRemnantBindingAuthority } from './workspaceRemnantBindingStore.js';

export interface WorkspaceInspectionRemnantAuthority extends WorkspaceRemnantBindingAuthority {
  // Existing lifecycle/inspection owners prove all started work settled, not merely backend exit.
  assertWritersAbsent(): Promise<void>;
}

export interface WorkspaceInspectionRemnantReads {
  directoryIdentity(path: string, assertCurrent: () => void): Promise<string>;
  assertAbsent(path: string, assertCurrent: () => void): Promise<void>;
}

// A fixed four-location observation, not a complete census or a mutation receipt.
export async function observeWorkspaceInspectionRemnants(
  userDataRoot: string, binding: unknown, assertCurrent: () => void,
  reads: WorkspaceInspectionRemnantReads, requireAbsent: boolean,
) {
  const identity = reads.directoryIdentity.bind(reads);
  const absent = reads.assertAbsent.bind(reads);
  const ancestors = async (paths: readonly string[]) => {
    const chain: (string | null)[] = [];
    let missing = false;
    for (const path of paths) {
      assertCurrent();
      let current: string;
      try { current = await identity(path, assertCurrent); }
      catch (error) {
        assertCurrent();
        if (path === userDataRoot || (error as NodeJS.ErrnoException)?.code !== 'ENOENT') throw error;
        missing = true; chain.push(null); continue;
      }
      assertCurrent();
      if (missing) return invalidDeletionData(invalidCode);
      chain.push(current);
    }
    return Object.freeze(chain);
  };
  const result: Readonly<{ rootIdentity: string | null; ancestors: readonly (string | null)[] }>[] = [];
  for (const location of deriveWorkspaceInspectionRemnantPaths(userDataRoot, binding)) {
    const before = await ancestors(location.ancestors);
    assertCurrent();
    let rootIdentity: string | null = null;
    if (!requireAbsent) {
      try { rootIdentity = await identity(location.rootPath, assertCurrent); }
      catch (error) {
        assertCurrent();
        if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') throw error;
      }
    }
    if (rootIdentity === null) { assertCurrent(); await absent(location.rootPath, assertCurrent); }
    assertCurrent();
    const after = await ancestors(location.ancestors);
    if (before.length !== after.length || before.some((value, index) => value !== after[index]) ||
        (rootIdentity !== null && after.some(value => value === null))) return invalidDeletionData(invalidCode);
    // Preserve the absence owner's leaf-then-ancestor order; present-root selection also pins the root across that await.
    if (!requireAbsent) {
      if (rootIdentity === null) await absent(location.rootPath, assertCurrent);
      else if (await identity(location.rootPath, assertCurrent) !== rootIdentity) return invalidDeletionData(invalidCode);
    }
    assertCurrent();
    result.push(Object.freeze({ rootIdentity, ancestors: after }));
  }
  return Object.freeze(result);
}

export type WorkspaceInspectionRemnantObservation = Awaited<ReturnType<typeof observeWorkspaceInspectionRemnants>>;

export function assertSameWorkspaceInspectionRemnants(
  before: WorkspaceInspectionRemnantObservation, after: WorkspaceInspectionRemnantObservation,
): void {
  if (before.length !== after.length || before.some((value, index) => value.rootIdentity !== after[index]!.rootIdentity ||
      value.ancestors.length !== after[index]!.ancestors.length ||
      value.ancestors.some((identity, position) => identity !== after[index]!.ancestors[position]))) {
    invalidDeletionData(invalidCode);
  }
}
