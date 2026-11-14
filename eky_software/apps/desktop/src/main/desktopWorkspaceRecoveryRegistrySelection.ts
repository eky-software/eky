import { isDeepStrictEqual } from 'node:util';
import { assertUpdateJournalAuthority } from '../update/updateJournalStore.js';
import { WorkspaceManagementError } from '../workspaces/management/workspaceManagementError.js';
import type { WorkspaceRegistryStore } from '../workspaces/registry/workspaceRegistryStore.js';

/** Read-only candidate admission; registry recovery retains its original source rules. */
export async function inspectDesktopRecoveryRegistrySelection(input: Readonly<{
  registry: Pick<WorkspaceRegistryStore, 'inspectRecoverySelection' | 'inspectSlots'>;
  assertCurrent(): void;
}>) {
  const authority = input.assertCurrent.bind(input);
  const inspectSource = input.registry.inspectRecoverySelection.bind(input.registry);
  const inspectSlots = input.registry.inspectSlots.bind(input.registry);
  let authorityFailure: { cause: unknown } | undefined;
  const check = () => {
    if (authorityFailure !== undefined) throw authorityFailure.cause;
    try { assertUpdateJournalAuthority(authority); }
    catch (cause) { authorityFailure = { cause }; throw cause; }
  };
  const read = async <T>(work: () => Promise<T>) => {
    check();
    try {
      const value = await work();
      check();
      return value;
    } catch (cause) {
      // The registry maps callback failures too; preserve this owner's original cause.
      if (authorityFailure !== undefined) throw authorityFailure.cause;
      throw cause;
    }
  };
  const fail = (): never => { throw new WorkspaceManagementError('WORKSPACE_MANAGEMENT_RECOVERY_REQUIRED', 'status'); };
  check();
  const source = structuredClone(await read(() => inspectSource(check)));
  check();
  if (source.value === undefined) {
    return Object.freeze({ mode: 'normal' as const, reason: 'missingRegistry' as const,
      source, persistedActiveWorkspaceId: undefined });
  }
  // Do not decode discarded sibling contents merely to decline the new entry.
  if (source.source !== 'current' || source.identities.next !== undefined || source.identities.backup !== undefined) {
    return Object.freeze({ mode: 'normal' as const, reason: 'registryRecovery' as const,
      source, persistedActiveWorkspaceId: source.value.activeWorkspaceId });
  }
  if (source.value.formatVersion !== 2) {
    return Object.freeze({ mode: 'normal' as const, reason: 'legacyRegistry' as const,
      source, persistedActiveWorkspaceId: source.value.activeWorkspaceId });
  }
  const slots = await read(() => inspectSlots(check));
  check();
  for (const slot of ['current', 'backup', 'next'] as const) {
    if (!isDeepStrictEqual(source.identities[slot], slots[slot]?.identity)) fail();
  }
  if (!isDeepStrictEqual(source.bytes, slots.current?.bytes) ||
      !isDeepStrictEqual(source.value, slots.current?.value)) fail();
  return Object.freeze({ mode: 'candidate' as const, source, slots });
}
