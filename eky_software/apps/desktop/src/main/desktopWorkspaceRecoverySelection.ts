import { isDeepStrictEqual } from 'node:util';
import { assertUpdateJournalAuthority } from '../update/updateJournalStore.js';
import type { InMemoryWorkspaceMaintenanceLease } from '../workspaces/maintenance/workspaceMaintenanceLease.js';
import { parseWorkspaceRecoveryManagementStatus } from '../workspaces/management/workspaceManagementStatus.js';
import type { WorkspaceManagementStatusReadContext } from '../workspaces/management/workspaceManagementTypes.js';
import { createDesktopRecoveryObservation } from './desktopRecoveryStartup.js';
import { readDesktopWorkspaceRecoveryTarget, type DesktopWorkspaceRecoveryReadAuthority } from './desktopWorkspaceRecoverySources.js';

type SelectionInput = Parameters<typeof readDesktopWorkspaceRecoveryTarget>[0];
type TargetSnapshot = Awaited<ReturnType<typeof readDesktopWorkspaceRecoveryTarget>>;

export type DesktopWorkspaceRecoveryOffer = Extract<Awaited<ReturnType<
  ReturnType<typeof createDesktopWorkspaceRecoverySelection>['discover']>>, { mode: 'offered' }>;
export type DesktopWorkspaceRecoveryOwner = Awaited<ReturnType<DesktopWorkspaceRecoveryOffer['handoff']>>;

const changed = () => new Error('WORKSPACE_MANAGEMENT_RECOVERY_REQUIRED');

/** One selected snapshot's read lifetime; it owns neither a lease nor mutation permission. */
function selectionLifetime(authority: DesktopWorkspaceRecoveryReadAuthority) {
  const current = authority.assertCurrent.bind(authority), proveOwned = authority.assertOwned.bind(authority);
  const pending = new Set<Promise<unknown>>();
  let active = true, admittingReads = true, firstFailure: { cause: unknown } | undefined;
  const retainFailure = (cause: unknown) => { firstFailure ??= { cause }; return firstFailure.cause; };
  const assertActive = () => {
    if (firstFailure !== undefined) throw firstFailure.cause;
    if (!active) throw changed();
  };
  const assertCurrent = () => {
    try {
      assertActive();
      assertUpdateJournalAuthority(current);
      assertActive();
    } catch (cause) { throw retainFailure(cause); }
  };
  const checked = async <T>(work: () => Promise<T>) => {
    try { assertCurrent(); const value = await work(); assertCurrent(); return value; }
    catch (cause) { throw retainFailure(cause); }
  };
  const owned = () => checked(async () => {
    const result: unknown = await proveOwned();
    if (result !== undefined) throw changed();
  });
  const track = <T>(work: () => Promise<T>, sticky: boolean): Promise<T> => {
    assertCurrent();
    if (!admittingReads) throw changed();
    const task = Promise.resolve().then(async () => {
      if (sticky) return checked(work);
      assertCurrent();
      const value = await work();
      assertCurrent();
      return value;
    });
    pending.add(task);
    void task.then(() => pending.delete(task), () => pending.delete(task));
    return task;
  };
  return {
    assertActive, assertCurrent, checked, owned, retainFailure,
    run: <T>(work: () => Promise<T>) => track(work, true),
    runRead: <T>(work: () => Promise<T>) => track(work, false),
    closeReads() { assertCurrent(); if (!admittingReads) throw changed(); admittingReads = false; },
    closeAdmission() { admittingReads = false; active = false; },
    async waitForSettlement() { await Promise.allSettled([...pending]); },
  };
}

/** Synchronous startup handle, registered before discover's first I/O. */
export function createDesktopWorkspaceRecoverySelection(input: Readonly<SelectionInput>) {
  const root = input.root, buildInfo = structuredClone(input.buildInfo);
  const releaseInfo = input.releaseInfo === undefined ? undefined : structuredClone(input.releaseInfo);
  const startupScope = createDesktopRecoveryObservation();
  const startupCurrent = input.authority.assertCurrent.bind(input.authority);
  const startupOwned = input.authority.assertOwned.bind(input.authority);
  const startup = selectionLifetime({
    assertCurrent() { startupScope.assertCurrent(); assertUpdateJournalAuthority(startupCurrent); },
    assertOwned: startupOwned,
  });
  let started = false;

  // An awaited source error is the composition's primary failure, not a second close failure.
  const trackStartup = async <T>(work: () => Promise<T>): Promise<T> => {
    let failure: { cause: unknown } | undefined;
    try {
      const outcome = await startupScope.run(async () => {
        try { return { status: 'fulfilled' as const, value: await work() }; }
        catch (cause) { failure = { cause }; return { status: 'rejected' as const, cause }; }
      });
      if (outcome.status === 'rejected') throw outcome.cause;
      return outcome.value;
    } catch (cause) { throw failure === undefined ? cause : failure.cause; }
  };
  const capture = async (owner: ReturnType<typeof selectionLifetime>, expected?: TargetSnapshot) => {
    const snapshot = await owner.checked(() => readDesktopWorkspaceRecoveryTarget({ root, buildInfo, releaseInfo,
      authority: { assertCurrent: owner.assertCurrent, assertOwned: owner.owned } }));
    if (expected !== undefined && !isDeepStrictEqual(snapshot, expected)) throw changed();
    return snapshot;
  };
  const requestRead = async <T>(owner: ReturnType<typeof selectionLifetime>, authority: DesktopWorkspaceRecoveryReadAuthority,
    work: (reader: ReturnType<typeof selectionLifetime>) => Promise<T>) => {
    const current = authority.assertCurrent.bind(authority), proveOwned = authority.assertOwned.bind(authority);
    const assertRead = () => {
      owner.assertCurrent(); assertUpdateJournalAuthority(current); owner.assertCurrent();
    };
    const reader = selectionLifetime({
      assertCurrent: assertRead,
      async assertOwned() {
        await owner.owned();
        assertRead();
        const result = await proveOwned();
        assertRead();
        return result;
      },
    });
    return owner.runRead(async () => {
      try { return await reader.run(() => work(reader)); }
      finally { reader.closeAdmission(); await reader.waitForSettlement(); }
    });
  };
  const receipt = (owner: ReturnType<typeof selectionLifetime>, expected: TargetSnapshot & { mode: 'candidate' },
    original = owner) =>
    Object.freeze({
      target: Object.freeze({ ...expected.target, lineageIdentity: Object.freeze({ ...expected.target.lineageIdentity }) }),
      owners: Object.freeze([...expected.owners]), persistedActiveWorkspaceId: expected.persistedActiveWorkspaceId,
      assertCurrent: owner.assertCurrent,
      async assertSelected() { owner.assertCurrent(); await original.run(() => capture(original, expected)); },
      async readSelected(authority: DesktopWorkspaceRecoveryReadAuthority) {
        owner.assertCurrent();
        await requestRead(original, authority, reader => capture(reader, expected));
      },
      async readStatus(input: Readonly<{
        context: Readonly<WorkspaceManagementStatusReadContext>;
        maintenance: Pick<InMemoryWorkspaceMaintenanceLease, 'captureStatusObservation'>;
        authority: DesktopWorkspaceRecoveryReadAuthority;
        runtimeAbsence: DesktopWorkspaceRecoveryReadAuthority;
      }>) {
        owner.assertCurrent();
        const phase = input.context, operationState = phase.operationState;
        const assertPhase = phase.assertCurrent.bind(phase);
        const maintenance = input.maintenance.captureStatusObservation();
        const assertMaintenance = maintenance.assertCurrent.bind(maintenance), maintenanceState = maintenance.state;
        const busy = operationState === 'busy' || maintenanceState === 'busy';
        const requestCurrent = input.authority.assertCurrent.bind(input.authority), requestOwned = input.authority.assertOwned.bind(input.authority);
        const absent = input.runtimeAbsence.assertCurrent.bind(input.runtimeAbsence), proveAbsent = input.runtimeAbsence.assertOwned.bind(input.runtimeAbsence);
        let firstFailure: { cause: unknown } | undefined;
        const assertCurrent = () => {
          if (firstFailure !== undefined) throw firstFailure.cause;
          try {
            owner.assertCurrent(); assertUpdateJournalAuthority(requestCurrent); assertUpdateJournalAuthority(absent);
            assertUpdateJournalAuthority(assertPhase); assertUpdateJournalAuthority(assertMaintenance); owner.assertActive();
            if (!busy) original.assertCurrent();
          } catch (cause) { firstFailure ??= { cause }; throw firstFailure.cause; }
        };
        const assertRuntimeAbsent = async () => {
          assertCurrent();
          const result: unknown = await proveAbsent();
          assertCurrent();
          if (result !== undefined) throw changed();
        };
        return requestRead(busy ? owner : original, { assertCurrent, assertOwned: requestOwned }, async reader => {
          await reader.owned(); await reader.checked(assertRuntimeAbsent);
          const common = { formatVersion: 2, mode: 'recoveryManagement', runtimeState: 'absent', maintenanceState };
          let value: ReturnType<typeof parseWorkspaceRecoveryManagementStatus>;
          if (busy) {
            value = parseWorkspaceRecoveryManagementStatus({ ...common, operationState: 'busy' });
          } else {
            await capture(reader, expected);
            value = parseWorkspaceRecoveryManagementStatus({ ...common, operationState: 'idle',
              persistedActiveWorkspaceId: expected.persistedActiveWorkspaceId,
              target: { workspaceId: expected.target.workspaceId, workspaceLabel: expected.target.workspaceLabel } });
          }
          await reader.checked(assertRuntimeAbsent); await reader.owned();
          assertCurrent();
          return Object.freeze({ value, assertCurrent });
        });
      },
      closeAdmission() { original.closeAdmission(); owner.closeAdmission(); },
      async waitForSettlement() { await Promise.all([original.waitForSettlement(), owner.waitForSettlement()]); },
    });
  const mainReceipt = (main: ReturnType<typeof selectionLifetime>, expected: TargetSnapshot & { mode: 'candidate' }) => {
    const original = selectionLifetime({ assertCurrent: main.assertCurrent, assertOwned: main.owned });
    const selected = receipt(main, expected, original);
    let transferring = false, transferWork: Promise<unknown> | undefined;
    return Object.freeze({ ...selected,
      transferSourceSelection<Replacement extends Readonly<{ assertCurrent(): void; assertSelected(): Promise<void> }>>(
        captureReplacement: (authority: DesktopWorkspaceRecoveryReadAuthority) => Promise<Replacement>,
      ): Promise<Replacement> {
        if (transferring) return Promise.reject(changed());
        transferring = true;
        let sealFailure: { cause: unknown } | undefined;
        // Register the transfer before a current-authority callback can re-enter shutdown.
        const work = Promise.resolve().then(async () => {
          try {
            await original.waitForSettlement();
            if (sealFailure !== undefined) throw sealFailure.cause;
            original.assertCurrent(); main.assertCurrent();
            await original.checked(() => capture(original, expected));
            const replacement = await main.checked(() => captureReplacement(Object.freeze({
              assertCurrent: main.assertCurrent, assertOwned: main.owned,
            })));
            const current = replacement.assertCurrent.bind(replacement), proveSelected = replacement.assertSelected.bind(replacement);
            original.assertCurrent(); main.assertCurrent(); assertUpdateJournalAuthority(current);
            await original.checked(() => capture(original, expected));
            await main.checked(async () => {
              const result: unknown = await proveSelected();
              if (result !== undefined) throw changed();
              assertUpdateJournalAuthority(current);
            });
            original.assertCurrent(); main.assertCurrent();
            original.assertActive(); main.assertActive();
            original.closeAdmission();
            return replacement;
          } catch (cause) {
            const first = main.retainFailure(cause);
            original.retainFailure(first);
            original.closeAdmission();
            await original.waitForSettlement();
            throw first;
          }
        });
        transferWork = work;
        try { original.closeReads(); }
        catch (cause) { sealFailure = { cause }; original.closeAdmission(); }
        void work.catch(() => undefined);
        return work;
      },
      async waitForSettlement() { await Promise.allSettled([selected.waitForSettlement(), transferWork]); },
    });
  };
  return Object.freeze({
    signal: startupScope.signal,
    // The permanently closed scope blocks old admission with its exact cancellation reason.
    closeAdmission() { startupScope.closeAdmission(); },
    async waitForSettlement() {
      const results = await Promise.allSettled([
        Promise.resolve().then(() => startupScope.waitForSettlement()), startup.waitForSettlement(),
      ]);
      for (const result of results) if (result.status === 'rejected') throw result.reason;
    },
    async discover() {
      if (started) throw changed();
      started = true;
      try {
        return await trackStartup(async () => {
          const expected = await startup.run(() => capture(startup));
          await startup.run(() => capture(startup, expected));
          if (expected.mode === 'notOffered') return Object.freeze({ mode: 'notOffered' as const, reason: expected.reason });
          let handingOff = false;
          return Object.freeze({ mode: 'offered' as const, ...receipt(startup, expected),
            async handoff(authority: DesktopWorkspaceRecoveryReadAuthority) {
              if (handingOff) throw changed();
              handingOff = true;
              const main = selectionLifetime(authority);
              try {
                const transferred = await trackStartup(async () => {
                  startup.closeReads();
                  await startup.waitForSettlement();
                  startup.assertCurrent(); main.assertCurrent();
                  // Every source boundary still observes both lifetimes and the original bytes.
                  const bridge = selectionLifetime({
                    assertCurrent() { startup.assertCurrent(); main.assertCurrent(); },
                    async assertOwned() { await startup.owned(); await main.owned(); },
                  });
                  try { await bridge.run(() => capture(bridge, expected)); }
                  finally { bridge.closeAdmission(); await bridge.waitForSettlement(); }
                  startup.assertCurrent(); main.assertCurrent();
                  return mainReceipt(main, expected);
                });
                startup.assertCurrent(); main.assertCurrent();
                // No external callback or await may invalidate either owner after this point.
                startup.assertActive(); main.assertActive(); startupScope.assertCurrent();
                startup.closeAdmission();
                return transferred;
              } catch (cause) {
                const first = startup.retainFailure(cause);
                main.closeAdmission(); startup.closeAdmission();
                await Promise.all([main.waitForSettlement(), startup.waitForSettlement()]);
                throw first;
              }
            },
          });
        });
      } catch (cause) {
        startup.closeAdmission();
        await startup.waitForSettlement();
        throw cause;
      }
    },
  });
}
