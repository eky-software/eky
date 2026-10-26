import { join } from 'node:path';

import { createWorkspaceLegacyAdoptionJournalPaths, WorkspaceLegacyAdoptionJournalStore } from '../adoption/workspaceLegacyAdoptionJournal.js';
import { recoverWorkspaceLegacyAdoption } from '../adoption/workspaceLegacyAdoptionRecovery.js';
import { NodeWorkspaceLegacyAdoptionRootStore } from '../adoption/workspaceLegacyAdoptionRootStore.js';
import { resolveWorkspaceLegacyAdoptionStartup } from '../adoption/workspaceLegacyAdoptionStartup.js';
import { deriveWorkspaceRoot } from '../registry/deriveWorkspaceRoot.js';
import { inspectWorkspaceRoot } from '../registry/inspectWorkspaceRoot.js';
import { WORKSPACE_REGISTRY_FILE_NAME } from '../registry/workspaceRegistryPaths.js';
import { WorkspaceRegistryStore } from '../registry/workspaceRegistryStore.js';
import type { WorkspaceRegistryPort } from '../registry/workspaceRegistryPort.js';
import type { WorkspaceId } from '../registry/workspaceRegistryTypes.js';
import { WorkspaceSwitchJournalStore } from '../switch/workspaceSwitchJournal.js';
import { WorkspaceSwitchError } from '../switch/workspaceSwitchError.js';
import { resolveWorkspaceSwitchStartup } from '../switch/workspaceSwitchStartup.js';
import type { WorkspaceSwitchFailureRecoveryOutcome } from '../switch/workspaceSwitchStartup.js';
import type { WorkspaceSwitchStartupContext } from '../switch/workspaceSwitchStartup.js';
import type { WorkspaceSelectorActivationAuthority } from '../update/workspaceActivationMigrationGuard.js';
import { hasAnyJournalSlot } from '../persistence/readOnlyJournalSlots.js';
import {
  resolveWorkspaceSelectorSwitchStartup,
  type WorkspaceSelectorStartupSelection,
  type WorkspaceSelectorSwitchStartupAuthority,
} from '../switch/workspaceSelectorSwitchStartup.js';

export const ACTIVE_WORKSPACE_STARTUP_RELAUNCH_REQUIRED =
  'ACTIVE_WORKSPACE_STARTUP_RELAUNCH_REQUIRED';

export class ActiveWorkspaceStartupRelaunchRequiredError extends Error {
  readonly code = ACTIVE_WORKSPACE_STARTUP_RELAUNCH_REQUIRED;

  constructor() {
    super(ACTIVE_WORKSPACE_STARTUP_RELAUNCH_REQUIRED);
    this.name = 'ActiveWorkspaceStartupRelaunchRequiredError';
  }
}

export type ActiveWorkspaceStartupMode =
  | 'normal'
  | 'adoption'
  | 'targetValidation'
  | 'rollbackValidation';

export type ActiveWorkspaceStartupPhase =
  | 'registryStateRead'
  | 'legacyAdoptionRecovery'
  | 'legacyAdoption'
  | 'switchRecovery'
  | 'workspaceRootInspection';

export interface ActiveWorkspaceStartupProgress {
  readonly phase: ActiveWorkspaceStartupPhase;
  readonly state: 'started' | 'completed';
}

export interface ActiveWorkspaceSwitchContext
  extends Omit<WorkspaceSwitchStartupContext, 'sourceWorkspaceId'> {
  readonly sourceWorkspaceId: WorkspaceId | null;
  readonly targetProfileId: string;
}

export interface ActiveWorkspaceStartupOptions {
  readonly selectorAuthority?: WorkspaceSelectorSwitchStartupAuthority;
  readonly reportProgress?: (
    progress: Readonly<ActiveWorkspaceStartupProgress>,
  ) => void;
}

export interface ActiveWorkspaceStartupSelection {
  readonly mode: ActiveWorkspaceStartupMode;
  readonly selectorActivationAuthority?: WorkspaceSelectorActivationAuthority;
  readonly switchContext?: Readonly<ActiveWorkspaceSwitchContext>;
  readonly workspaceId: WorkspaceId;
  readonly workspaceRoot: string;
  assertCanAccept(profileId: string): void;
  accept(profileId: string): Promise<void>;
  rejectInvalidTarget?(): Promise<WorkspaceSwitchFailureRecoveryOutcome>;
  requireRecovery?(): Promise<WorkspaceSwitchFailureRecoveryOutcome>;
  recoverFromFailure(): Promise<WorkspaceSwitchFailureRecoveryOutcome>;
}

export function resolveActiveWorkspaceStartup(
  userDataRoot: string,
  options: Readonly<ActiveWorkspaceStartupOptions & { selectorAuthority: WorkspaceSelectorSwitchStartupAuthority }>,
): Promise<Readonly<ActiveWorkspaceStartupSelection> | WorkspaceSelectorStartupSelection>;
export function resolveActiveWorkspaceStartup(
  userDataRoot: string,
  options?: Readonly<Omit<ActiveWorkspaceStartupOptions, 'selectorAuthority'>>,
): Promise<Readonly<ActiveWorkspaceStartupSelection>>;
export async function resolveActiveWorkspaceStartup(
  userDataRoot: string,
  options: Readonly<ActiveWorkspaceStartupOptions> = {},
): Promise<Readonly<ActiveWorkspaceStartupSelection> | WorkspaceSelectorStartupSelection> {
  reportProgress(options, 'registryStateRead', 'started');
  const registry = new WorkspaceRegistryStore({
    installationRoot: userDataRoot,
    filePath: join(userDataRoot, WORKSPACE_REGISTRY_FILE_NAME),
  });
  const adoptionJournal = new WorkspaceLegacyAdoptionJournalStore(userDataRoot);
  const switchJournal = new WorkspaceSwitchJournalStore(userDataRoot);
  const registryValue = await registry.inspect();
  const switchInspection = await switchJournal.inspectStartup();
  const selectorSwitchPending = switchInspection.mode === 'selector' &&
    Object.values(switchInspection.slots).some(slot => slot?.value.formatVersion === 2);
  const adoptionPending = await hasAnyJournalSlot(createWorkspaceLegacyAdoptionJournalPaths(userDataRoot));
  if (selectorSwitchPending || (!adoptionPending && registryValue?.formatVersion === 2 && registryValue.activeWorkspaceId === null)) {
    const authority = options.selectorAuthority;
    if (authority === undefined) throw new WorkspaceSwitchError('WORKSPACE_SWITCH_RECOVERY_REQUIRED');
    authority.assertCurrent();
    if (adoptionPending) {
      throw new WorkspaceSwitchError('WORKSPACE_SWITCH_RECOVERY_REQUIRED');
    }
    const registrySlots = await registry.inspectSlots();
    const journalSlots = switchInspection.mode === 'selector' ? switchInspection.slots : await switchJournal.inspectSlots();
    authority.assertCurrent();
    reportProgress(options, 'registryStateRead', 'completed');
    reportProgress(options, 'switchRecovery', 'started');
    const selected = await resolveWorkspaceSelectorSwitchStartup({
      registry, journal: switchJournal, authority,
      selection: { journalSlots, registrySlots, readRegistrySlots: () => registry.inspectSlots(),
        assertAuthority: authority.assertCurrent.bind(authority) },
    });
    reportProgress(options, 'switchRecovery', 'completed');
    if (selected.mode === 'selector') return selected;
    const paths = deriveWorkspaceRoot(userDataRoot, selected.workspace.workspaceId, selected.workspace.layoutVersion);
    reportProgress(options, 'workspaceRootInspection', 'started');
    try { await inspectWorkspaceRoot(paths); }
    catch (error) {
      let recovery: WorkspaceSwitchFailureRecoveryOutcome;
      try { recovery = await selected.rejectInvalidTarget(); }
      catch (recoveryError) {
        const failure = new WorkspaceSwitchError('WORKSPACE_SWITCH_RECOVERY_REQUIRED');
        failure.cause = new AggregateError([error, recoveryError], 'WORKSPACE_SWITCH_RECOVERY_REQUIRED');
        throw failure;
      }
      const failure = recovery === 'relaunchRequired'
        ? new ActiveWorkspaceStartupRelaunchRequiredError()
        : new WorkspaceSwitchError('WORKSPACE_SWITCH_RECOVERY_REQUIRED');
      failure.cause = error;
      throw failure;
    }
    authority.assertCurrent();
    reportProgress(options, 'workspaceRootInspection', 'completed');
    return Object.freeze({
      mode: selected.mode,
      selectorActivationAuthority: selected.selectorActivationAuthority,
      switchContext: Object.freeze({ ...selected.context, targetProfileId: selected.workspace.lineageIdentity.profileId }),
      workspaceId: selected.workspace.workspaceId, workspaceRoot: paths.workspaceRoot,
      assertCanAccept: selected.assertCanAccept, accept: selected.accept,
      rejectInvalidTarget: selected.rejectInvalidTarget, requireRecovery: selected.requireRecovery,
      recoverFromFailure: selected.recoverFromFailure,
    });
  }
  const adoptionJournalValue = await adoptionJournal.read();
  reportProgress(options, 'registryStateRead', 'completed');

  const adoptionRootStore = new NodeWorkspaceLegacyAdoptionRootStore();
  if (adoptionJournalValue?.state === 'recoveryRequired') {
    reportProgress(options, 'legacyAdoptionRecovery', 'started');
    const recovery = await recoverWorkspaceLegacyAdoption({
      journal: adoptionJournal,
      registry,
      rootStore: adoptionRootStore,
      userDataRoot,
    });
    reportProgress(options, 'legacyAdoptionRecovery', 'completed');
    if (recovery === 'relaunchRequired') {
      throw new ActiveWorkspaceStartupRelaunchRequiredError();
    }
  }

  if (registryValue === undefined || adoptionJournalValue !== undefined) {
    reportProgress(options, 'legacyAdoption', 'started');
    const selection = await resolveWorkspaceLegacyAdoptionStartup({
      journal: adoptionJournal,
      registry,
      rootStore: adoptionRootStore,
      userDataRoot,
    });
    reportProgress(options, 'legacyAdoption', 'completed');
    return selection;
  }

  reportProgress(options, 'switchRecovery', 'started');
  const inspectedRegistry: WorkspaceRegistryPort = {
    read: () => registry.inspect(),
    write: (value) => registry.write(value),
  };
  const switchSelection = await resolveWorkspaceSwitchStartup(
    inspectedRegistry,
    switchJournal,
  );
  reportProgress(options, 'switchRecovery', 'completed');
  const paths = deriveWorkspaceRoot(
    userDataRoot,
    switchSelection.workspace.workspaceId,
    switchSelection.workspace.layoutVersion,
  );
  reportProgress(options, 'workspaceRootInspection', 'started');
  try {
    await inspectWorkspaceRoot(paths);
  } catch (error) {
    if (switchSelection.mode === 'normal') throw error;
    const recovery = await switchSelection.recoverFromFailure();
    if (recovery === 'relaunchRequired') {
      throw new ActiveWorkspaceStartupRelaunchRequiredError();
    }
    throw new WorkspaceSwitchError('WORKSPACE_SWITCH_RECOVERY_REQUIRED');
  }
  reportProgress(options, 'workspaceRootInspection', 'completed');
  return Object.freeze({
    mode: switchSelection.mode,
    ...(switchSelection.context === undefined
      ? {}
      : {
          switchContext: Object.freeze({
            ...switchSelection.context,
            targetProfileId:
              switchSelection.workspace.lineageIdentity.profileId,
          }),
          rejectInvalidTarget: () =>
            switchSelection.rejectInvalidTarget(),
          requireRecovery: () => switchSelection.requireRecovery(),
        }),
    workspaceId: switchSelection.workspace.workspaceId,
    workspaceRoot: paths.workspaceRoot,
    assertCanAccept: (profileId: string) =>
      switchSelection.assertCanAccept(profileId),
    accept: (profileId: string) => switchSelection.accept(profileId),
    recoverFromFailure: () => switchSelection.recoverFromFailure(),
  });
}

function reportProgress(
  options: Readonly<ActiveWorkspaceStartupOptions>,
  phase: ActiveWorkspaceStartupPhase,
  state: ActiveWorkspaceStartupProgress['state'],
): void {
  try {
    options.reportProgress?.(Object.freeze({ phase, state }));
  } catch {
    // Progress reporting must not change workspace startup behavior.
  }
}
