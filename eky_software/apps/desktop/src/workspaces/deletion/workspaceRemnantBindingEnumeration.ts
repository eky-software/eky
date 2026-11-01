import { checkedDeletionAuthority, invalidDeletionData } from './workspaceDeletionDataValidation.js';
import { observeWorkspaceDeletionDirectoryEntries, workspaceDeletionDirectoryReads,
  type WorkspaceDeletionDirectoryReads } from './workspaceDeletionDirectoryEntries.js';
import { workspaceRemnantBindingInvalidCode as invalidCode, type WorkspaceRemnantBindingKey } from './workspaceRemnantBindingCodec.js';
import { inspectWorkspaceRemnantBindingOwnerDirectory } from './workspaceRemnantBindingDirectory.js';
import { createWorkspaceRemnantBindingOwnerDirectoryPaths, parseWorkspaceRemnantBindingSlotName } from './workspaceRemnantBindingPaths.js';
import { assertSameWorkspaceRemnantBindingSelection, WorkspaceRemnantBindingStore,
  type WorkspaceRemnantBindingAuthority } from './workspaceRemnantBindingStore.js';

type PublishedBinding = Extract<Awaited<ReturnType<WorkspaceRemnantBindingStore['inspect']>>, { mode: 'published' }>;
type DirectoryObservation = Awaited<ReturnType<typeof inspectWorkspaceRemnantBindingOwnerDirectory>>;
type BindingObservation = Readonly<{ key: WorkspaceRemnantBindingKey; binding: PublishedBinding }>;
export type WorkspaceRemnantBindingDirectoryObservation =
  | Readonly<{ kind: 'directory'; owner: WorkspaceRemnantBindingKey['owner']; directoryPath: string;
    selection: DirectoryObservation }>
  | Readonly<{ kind: 'binding'; key: WorkspaceRemnantBindingKey; binding: PublishedBinding }>;

// Unfiltered observations, including other companies. Payload pairing and fresh full-census comparison remain mandatory.
export async function* observeWorkspaceRemnantBindings(
  userDataRoot: string, owner: WorkspaceRemnantBindingKey['owner'], authority: WorkspaceRemnantBindingAuthority,
  reads: WorkspaceDeletionDirectoryReads = workspaceDeletionDirectoryReads,
): AsyncGenerator<BindingObservation, void> {
  for await (const row of observeWorkspaceRemnantBindingDirectory(userDataRoot, owner, authority, reads)) {
    if (row.kind === 'binding') yield Object.freeze({ key: row.key, binding: row.binding });
  }
}

// The full source census also needs empty and missing directories, not only published bindings.
export async function* observeWorkspaceRemnantBindingDirectory(
  userDataRoot: string, owner: WorkspaceRemnantBindingKey['owner'], authority: WorkspaceRemnantBindingAuthority,
  reads: WorkspaceDeletionDirectoryReads = workspaceDeletionDirectoryReads,
): AsyncGenerator<WorkspaceRemnantBindingDirectoryObservation, void> {
  const paths = createWorkspaceRemnantBindingOwnerDirectoryPaths(userDataRoot, owner);
  const assertAuthority = checkedDeletionAuthority(authority.assertAuthority.bind(authority), invalidCode);
  const external = authority.assertExternalSelection.bind(authority);
  const readIdentity = reads.directoryIdentity.bind(reads);
  let baseline: DirectoryObservation | undefined;
  const assertSelection = async () => {
    assertAuthority(); await external(); assertAuthority();
    const fresh = await inspectWorkspaceRemnantBindingOwnerDirectory(userDataRoot, owner, assertAuthority, readIdentity);
    assertAuthority();
    if (baseline === undefined) baseline = fresh;
    else if (baseline.present !== fresh.present || baseline.ancestorPath !== fresh.ancestorPath ||
        baseline.ancestorIdentity !== fresh.ancestorIdentity ||
        baseline.identities.some((value, index) => value !== fresh.identities[index])) return invalidDeletionData(invalidCode);
  };
  const guarded = { assertAuthority, assertExternalSelection: assertSelection };
  await assertSelection();
  yield Object.freeze({ kind: 'directory', owner, directoryPath: paths.directoryPath, selection: baseline! });
  await assertSelection();
  if (!baseline!.present) { await assertSelection(); return; }
  let previousStem: string | undefined;
  for await (const name of observeWorkspaceDeletionDirectoryEntries(paths.directoryPath, guarded, reads)) {
    const parsed = parseWorkspaceRemnantBindingSlotName(owner, name);
    if (previousStem === parsed.stem) continue;
    // Sorted canonical current comes before its side slots. Never adopt a current appearing behind the cursor.
    if (parsed.slot !== 'current') return invalidDeletionData(invalidCode);
    const store = new WorkspaceRemnantBindingStore(userDataRoot, parsed.key);
    const original = await store.inspect(guarded);
    assertAuthority();
    if (original.mode !== 'published') return invalidDeletionData(invalidCode);
    const verify = async () => {
      const fresh = await store.inspect(guarded);
      assertAuthority();
      assertSameWorkspaceRemnantBindingSelection(original, fresh);
    };
    await verify();
    previousStem = parsed.stem;
    // Keep the private comparison bytes separate from the consumer's mutable Uint8Array copies.
    const slots = Object.freeze(Object.fromEntries((['current', 'next', 'backup'] as const).map(slot => {
      const value = original.slots[slot];
      return [slot, value === undefined ? undefined : Object.freeze({ ...value, bytes: Uint8Array.from(value.bytes) })];
    })) as PublishedBinding['slots']);
    yield Object.freeze({ kind: 'binding', key: parsed.key, binding: Object.freeze({ ...original, slots }) });
    await verify();
  }
  await assertSelection();
}
