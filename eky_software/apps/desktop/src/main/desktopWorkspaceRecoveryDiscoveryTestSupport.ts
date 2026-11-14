import { isDeepStrictEqual } from 'node:util';
import { createDesktopProfilePaths } from '../runtime/desktopProfilePaths.js';
import { createProfileSnapshotRuntimePaths } from '../profileBackup/profileSnapshotRuntimePaths.js';
import { assertProfileRestoreActivationJournalStep } from '../profileBackup/restore/profileRestoreActivationJournal.js';
import { ProfileRestoreActivationJournalStore } from '../profileBackup/restore/profileRestoreActivationJournalStore.js';
import { assertUpdateJournalAuthority } from '../update/updateJournalStore.js';
import type { DesktopBuildInfo } from '../release/desktopBuildInfo.js';
import type { DesktopReleaseInfo } from '../release/desktopReleaseInfo.js';
import { createReadOnlyJournalSlotPaths } from '../workspaces/management/mainOwnedWorkspaceManagementOperationGuard.js';
import { deriveWorkspaceRoot } from '../workspaces/registry/deriveWorkspaceRoot.js';
import { inspectWorkspaceRoot } from '../workspaces/registry/inspectWorkspaceRoot.js';
import { readDesktopWorkspaceRecoveryCensus, readDesktopWorkspaceRecoverySources } from './desktopWorkspaceRecoverySources.js';

export interface RecoveryDiscoveryExperimentAuthority {
  assertCurrent(): void;
  assertOwned(): Promise<void>;
}

// Test-only composition. No supplied target, inventory header, repair or mutation port.
export async function discoverRecoveryTargetExperiment(input: Readonly<{
  root: string;
  buildInfo: Readonly<DesktopBuildInfo>;
  releaseInfo: Readonly<DesktopReleaseInfo> | undefined;
  authority: RecoveryDiscoveryExperimentAuthority;
  localRestoreSelection?: 'normalSourceTrial';
}>) {
  const changed = () => new Error('SYNTHETIC_RECOVERY_DISCOVERY_CHANGED');
  const localRestoreSelection = input.localRestoreSelection;
  const profilePaths = (root: string) => createReadOnlyJournalSlotPaths(
    createProfileSnapshotRuntimePaths(createDesktopProfilePaths(root).runtimeRoot).restoreActivationJournalPath);

  function lifetime(authority: RecoveryDiscoveryExperimentAuthority) {
    let active = true, firstFailure: { cause: unknown } | undefined;
    let admittingReads = true;
    const pendingReads = new Set<Promise<unknown>>();
    const assertCurrent = () => {
      if (firstFailure !== undefined) throw firstFailure.cause;
      try { if (!active) throw changed(); authority.assertCurrent(); }
      catch (cause) { firstFailure ??= { cause }; throw firstFailure.cause; }
    };
    const checked = async <T>(work: () => Promise<T>) => {
      try { assertCurrent(); const value = await work(); assertCurrent(); return value; }
      catch (cause) { firstFailure ??= { cause }; throw firstFailure.cause; }
    };
    const owned = () => checked(() => authority.assertOwned());
    return { assertCurrent, checked, owned,
      async run<T>(work: () => Promise<T>) {
        assertCurrent();
        if (!admittingReads) return Promise.reject(changed());
        const task = checked(work);
        pendingReads.add(task);
        void task.then(() => pendingReads.delete(task), () => pendingReads.delete(task));
        return task;
      },
      runRead<T>(work: () => Promise<T>) {
        assertCurrent();
        if (!admittingReads) return Promise.reject(changed());
        // Track settlement without adopting a request-local failure as the owner's failure.
        const task = Promise.resolve().then(() => { assertCurrent(); return work(); });
        pendingReads.add(task);
        void task.then(() => pendingReads.delete(task), () => pendingReads.delete(task));
        return task;
      },
      closeReads() { assertCurrent(); if (!admittingReads) throw changed(); admittingReads = false; },
      async drainReads() { await Promise.allSettled([...pendingReads]); },
      retainFailure(cause: unknown) { firstFailure ??= { cause }; return firstFailure.cause; },
      revoke() { admittingReads = false; active = false; },
    };
  }
  type Lifetime = ReturnType<typeof lifetime>;
  const read = async (owner: Lifetime) => {
    const { checked, assertCurrent, owned } = owner;
    await owned();
    const source = await checked(() => readDesktopWorkspaceRecoverySources({
      root: input.root, buildInfo: input.buildInfo, releaseInfo: input.releaseInfo,
      authority: { assertCurrent, assertOwned: owned },
    }));
    const evidence = [...source.evidence], selectedRegistry = source.registry;
    const candidateEntries = [...source.candidateEntries], owners = [...source.owners];
    let reason = source.reason;
    const remember = <T>(value: T): T => { evidence.push(structuredClone(value)); return value; };
    if (source.mode === 'normal') {
      await owned();
      return { evidence, target: undefined, owners, reason,
        persistedActiveWorkspaceId: selectedRegistry?.activeWorkspaceId };
    }
    if (selectedRegistry === undefined) throw changed();
    const census = await checked(() => readDesktopWorkspaceRecoveryCensus({
      root: input.root, registry: selectedRegistry, authority: { assertCurrent, assertOwned: owned },
    }));
    evidence.push(...census.evidence);
    for (const { entry, observation } of census.localRestores) {
      const root = deriveWorkspaceRoot(input.root, entry.workspaceId, entry.layoutVersion);
      if (localRestoreSelection === 'normalSourceTrial') {
        candidateEntries.push(entry); owners.push('localRestore');
        continue;
      }
      // The historical strict-local experiment stays test-only, not production admission.
      const local = new ProfileRestoreActivationJournalStore(profilePaths(root.workspaceRoot).currentPath);
      const slots = remember(await checked(() => local.inspectDeletionSlots(assertCurrent)));
      for (const slot of ['current', 'backup', 'next'] as const) {
        if (!isDeepStrictEqual(observation.identities[slot], slots[slot]?.identity)) throw changed();
      }
      if (observation.source === undefined ||
          !isDeepStrictEqual(observation.bytes, slots[observation.source]?.bytes)) throw changed();
      const present = [slots.backup, slots.current, slots.next].filter(value => value !== undefined);
      if (present.length === 0 || present.length > 2 || present.some(slot => slot.identity === undefined)) throw changed();
      if (present[1] !== undefined) assertProfileRestoreActivationJournalStep(present[0]!.value, present[1].value);
      await checked(() => inspectWorkspaceRoot(root));
      candidateEntries.push(entry); owners.push('localRestore');
    }
    const unique = new Set(candidateEntries.map(entry => entry.workspaceId));
    if (unique.size > 1) reason ??= 'multipleTargets';
    if (census.otherRecoveryPresent) reason ??= 'otherRecoveryOwner';
    await owned();
    return { evidence, target: candidateEntries[0], owners, reason: reason ?? (unique.size === 0 ? 'noJournalTarget' : undefined),
      persistedActiveWorkspaceId: selectedRegistry?.activeWorkspaceId };
  };
  const startup = lifetime(input.authority);
  const capture = async (owner: Lifetime, expected?: Awaited<ReturnType<typeof read>>) => {
    const current = await read(owner);
    if (expected !== undefined && !isDeepStrictEqual(current, expected)) throw changed();
    return current;
  };
  try {
    const expected = await startup.checked(() => capture(startup));
    await startup.checked(() => capture(startup, expected));
    if (expected.reason !== undefined || expected.target === undefined) {
      startup.closeReads();
      await startup.drainReads();
      await startup.owned();
      startup.revoke(); return Object.freeze({ mode: 'notOffered' as const, reason: expected.reason });
    }
    const requestRead = async <T>(owner: Lifetime, authority: RecoveryDiscoveryExperimentAuthority,
      work: (reader: Lifetime) => Promise<T>) => {
      const assertRead = authority.assertCurrent.bind(authority);
      const reader = lifetime({
        assertCurrent() { owner.assertCurrent(); assertUpdateJournalAuthority(assertRead); },
        assertOwned: authority.assertOwned.bind(authority),
      });
      return owner.runRead(async () => {
        try { return await reader.run(() => work(reader)); }
        finally { reader.revoke(); await reader.drainReads(); }
      });
    };
    const receipt = (owner: Lifetime) => Object.freeze({
      target: Object.freeze(structuredClone(expected.target!)),
      owners: Object.freeze([...expected.owners]), persistedActiveWorkspaceId: expected.persistedActiveWorkspaceId,
      assertCurrent: owner.assertCurrent,
      assertSelected: () => owner.run(() => capture(owner, expected)).then(() => undefined),
      async readSelected(authority: RecoveryDiscoveryExperimentAuthority) {
        await requestRead(owner, authority, reader => capture(reader, expected));
      },
      revoke: owner.revoke,
    });
    return Object.freeze({ mode: 'offered' as const, ...receipt(startup),
      async handoff(authority: RecoveryDiscoveryExperimentAuthority) {
        const service = lifetime(authority);
        try {
          startup.closeReads();
          await startup.drainReads(); startup.assertCurrent();
          await startup.checked(() => service.checked(() => capture(service, expected)));
          startup.assertCurrent(); service.assertCurrent();
          startup.revoke();
          return receipt(service);
        } catch (cause) {
          const firstFailure = startup.retainFailure(cause);
          service.revoke(); startup.revoke();
          await startup.drainReads();
          throw firstFailure;
        }
      },
    });
  } catch (cause) { startup.revoke(); throw cause; }
}
