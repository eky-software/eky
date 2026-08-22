import {
  findWorkspaceEntry,
  selectActiveWorkspace,
  selectSourceAndRequireTargetRecovery,
} from '../registry/workspaceRegistryMutations.js';
import type { WorkspaceRegistryPort } from '../registry/workspaceRegistryPort.js';
import type {
  LocalWorkspaceRegistryEntryV1,
  LocalWorkspaceRegistryV1,
  WorkspaceId,
} from '../registry/workspaceRegistryTypes.js';
import { WorkspaceSwitchError } from './workspaceSwitchError.js';
import {
  type WorkspaceSwitchJournalPort,
  type WorkspaceSwitchJournalV1,
} from './workspaceSwitchJournal.js';

export type WorkspaceSwitchStartupMode =
  | 'normal'
  | 'targetValidation'
  | 'rollbackValidation';

export type WorkspaceSwitchFailureRecoveryOutcome =
  | 'relaunchRequired'
  | 'recoveryRequired'
  | 'notRecovered';

export interface WorkspaceSwitchStartupContext {
  readonly operationId: string;
  readonly sourceWorkspaceId: WorkspaceId;
  readonly targetWorkspaceId: WorkspaceId;
}

export interface WorkspaceSwitchStartupSelection {
  readonly context: Readonly<WorkspaceSwitchStartupContext> | undefined;
  readonly mode: WorkspaceSwitchStartupMode;
  readonly workspace: Readonly<LocalWorkspaceRegistryEntryV1>;
  assertCanAccept(profileId: string): void;
  accept(profileId: string): Promise<void>;
  rejectInvalidTarget(): Promise<WorkspaceSwitchFailureRecoveryOutcome>;
  requireRecovery(): Promise<WorkspaceSwitchFailureRecoveryOutcome>;
  recoverFromFailure(): Promise<WorkspaceSwitchFailureRecoveryOutcome>;
}

export async function resolveWorkspaceSwitchStartup(
  registryPort: WorkspaceRegistryPort,
  journalStore: WorkspaceSwitchJournalPort,
): Promise<Readonly<WorkspaceSwitchStartupSelection>> {
  const registry = await registryPort.read();
  if (registry === undefined || registry.activeWorkspaceId === null) {
    throw new WorkspaceSwitchError('WORKSPACE_SWITCH_INVALID');
  }
  let journal = await journalStore.read();
  if (journal?.state === 'recoveryRequired') {
    throw new WorkspaceSwitchError('WORKSPACE_SWITCH_RECOVERY_REQUIRED');
  }

  if (journal?.state === 'prepared') {
    if (registry.activeWorkspaceId === journal.sourceWorkspaceId) {
      await journalStore.clear(journal.operationId);
      journal = undefined;
    } else if (registry.activeWorkspaceId === journal.targetWorkspaceId) {
      journal = Object.freeze({ ...journal, state: 'targetSelected' });
      await journalStore.write(journal);
    } else {
      throw new WorkspaceSwitchError('WORKSPACE_SWITCH_RECOVERY_REQUIRED');
    }
  }

  if (
    journal?.state === 'targetSelected' &&
    registry.activeWorkspaceId === journal.sourceWorkspaceId
  ) {
    journal = await reconcileInterruptedRollbackSelection(
      registry,
      journalStore,
      journal,
    );
  }

  const mode = resolveMode(registry, journal);
  const workspace = requireActiveReadyWorkspace(registry);
  const assertCanAccept = (profileId: string): void => {
    if (profileId !== workspace.lineageIdentity.profileId) {
      throw new WorkspaceSwitchError('WORKSPACE_SWITCH_INVALID');
    }
  };
  return Object.freeze({
    context:
      journal === undefined
        ? undefined
        : Object.freeze({
            operationId: journal.operationId,
            sourceWorkspaceId: journal.sourceWorkspaceId,
            targetWorkspaceId: journal.targetWorkspaceId,
          }),
    mode,
    workspace,
    assertCanAccept,
    async accept(profileId: string) {
      assertCanAccept(profileId);
      if (journal !== undefined) {
        await journalStore.clear(journal.operationId);
      }
    },
    async rejectInvalidTarget() {
      if (journal === undefined || mode !== 'targetValidation') {
        return 'notRecovered';
      }
      return recoverInvalidTarget(
        registryPort,
        journalStore,
        journal,
      );
    },
    async requireRecovery() {
      if (journal === undefined || mode === 'normal') {
        return 'notRecovered';
      }
      await persistRecoveryRequired(journalStore, journal);
      return 'recoveryRequired';
    },
    async recoverFromFailure() {
      if (journal === undefined || mode === 'normal') return 'notRecovered';
      if (mode === 'rollbackValidation') {
        await persistRecoveryRequired(journalStore, journal);
        return 'recoveryRequired';
      }
      return recoverTargetValidationFailure(
        registryPort,
        journalStore,
        journal,
      );
    },
  });
}

async function reconcileInterruptedRollbackSelection(
  registry: Readonly<LocalWorkspaceRegistryV1>,
  journalStore: WorkspaceSwitchJournalPort,
  journal: Readonly<WorkspaceSwitchJournalV1>,
): Promise<Readonly<WorkspaceSwitchJournalV1>> {
  if (!registryMatchesInterruptedRollbackSelection(registry, journal)) {
    throw new WorkspaceSwitchError('WORKSPACE_SWITCH_RECOVERY_REQUIRED');
  }

  const reconciled = Object.freeze({
    ...journal,
    state: 'rollbackSelected' as const,
  });
  try {
    await journalStore.write(reconciled);
  } catch {
    await persistRecoveryRequired(journalStore, journal);
    throw new WorkspaceSwitchError('WORKSPACE_SWITCH_RECOVERY_REQUIRED');
  }
  return reconciled;
}

function registryMatchesInterruptedRollbackSelection(
  registry: Readonly<LocalWorkspaceRegistryV1>,
  journal: Readonly<WorkspaceSwitchJournalV1>,
): boolean {
  if (
    journal.sourceWorkspaceId === journal.targetWorkspaceId ||
    registry.activeWorkspaceId !== journal.sourceWorkspaceId
  ) {
    return false;
  }
  const sourceEntries = registry.workspaces.filter(
    (entry) => entry.workspaceId === journal.sourceWorkspaceId,
  );
  const targetEntries = registry.workspaces.filter(
    (entry) => entry.workspaceId === journal.targetWorkspaceId,
  );
  return (
    sourceEntries.length === 1 &&
    targetEntries.length === 1 &&
    sourceEntries[0]!.lifecycleState === 'ready' &&
    (targetEntries[0]!.lifecycleState === 'ready' ||
      targetEntries[0]!.lifecycleState === 'recoveryRequired')
  );
}

async function recoverInvalidTarget(
  registryPort: WorkspaceRegistryPort,
  journalStore: WorkspaceSwitchJournalPort,
  journal: Readonly<WorkspaceSwitchJournalV1>,
): Promise<WorkspaceSwitchFailureRecoveryOutcome> {
  let currentRegistry: Readonly<LocalWorkspaceRegistryV1> | undefined;
  try {
    currentRegistry = await registryPort.read();
    if (currentRegistry === undefined) throw new Error('invalid');
  } catch {
    await persistRecoveryRequired(journalStore, journal);
    return 'recoveryRequired';
  }

  let recoveredRegistry: Readonly<LocalWorkspaceRegistryV1>;
  try {
    recoveredRegistry = selectSourceAndRequireTargetRecovery({
      registry: currentRegistry,
      sourceWorkspaceId: journal.sourceWorkspaceId,
      targetWorkspaceId: journal.targetWorkspaceId,
    });
  } catch {
    await persistRecoveryRequired(journalStore, journal);
    return 'recoveryRequired';
  }

  try {
    await registryPort.write(recoveredRegistry);
  } catch {
    let observed: Readonly<LocalWorkspaceRegistryV1> | undefined;
    try {
      observed = await registryPort.read();
    } catch {
      await persistRecoveryRequired(journalStore, journal);
      return 'recoveryRequired';
    }
    if (!registryMatchesInvalidTargetRecovery(observed, journal)) {
      await persistRecoveryRequired(journalStore, journal);
      return 'recoveryRequired';
    }
  }

  try {
    await journalStore.write({ ...journal, state: 'rollbackSelected' });
  } catch {
    await persistRecoveryRequired(journalStore, journal);
    return 'recoveryRequired';
  }
  return 'relaunchRequired';
}

function registryMatchesInvalidTargetRecovery(
  registry: Readonly<LocalWorkspaceRegistryV1> | undefined,
  journal: Readonly<WorkspaceSwitchJournalV1>,
): boolean {
  return (
    registry?.activeWorkspaceId === journal.sourceWorkspaceId &&
    findWorkspaceEntry(registry, journal.sourceWorkspaceId)
      ?.lifecycleState === 'ready' &&
    findWorkspaceEntry(registry, journal.targetWorkspaceId)
      ?.lifecycleState === 'recoveryRequired'
  );
}

async function recoverTargetValidationFailure(
  registryPort: WorkspaceRegistryPort,
  journalStore: WorkspaceSwitchJournalPort,
  journal: Readonly<WorkspaceSwitchJournalV1>,
): Promise<WorkspaceSwitchFailureRecoveryOutcome> {
  let currentRegistry: Readonly<LocalWorkspaceRegistryV1> | undefined;
  try {
    currentRegistry = await registryPort.read();
  } catch {
    await persistRecoveryRequired(journalStore, journal);
    return 'recoveryRequired';
  }
  if (
    currentRegistry === undefined ||
    currentRegistry.activeWorkspaceId !== journal.targetWorkspaceId
  ) {
    await persistRecoveryRequired(journalStore, journal);
    return 'recoveryRequired';
  }

  let sourceRegistry: Readonly<LocalWorkspaceRegistryV1>;
  try {
    sourceRegistry = selectActiveWorkspace(
      currentRegistry,
      journal.targetWorkspaceId,
      journal.sourceWorkspaceId,
    );
  } catch {
    await persistRecoveryRequired(journalStore, journal);
    return 'recoveryRequired';
  }

  try {
    await registryPort.write(sourceRegistry);
  } catch {
    let observedRegistry: Readonly<LocalWorkspaceRegistryV1> | undefined;
    try {
      observedRegistry = await registryPort.read();
    } catch {
      await persistRecoveryRequired(journalStore, journal);
      return 'recoveryRequired';
    }
    if (observedRegistry?.activeWorkspaceId !== journal.sourceWorkspaceId) {
      await persistRecoveryRequired(journalStore, journal);
      return 'recoveryRequired';
    }
  }

  try {
    await journalStore.write({ ...journal, state: 'rollbackSelected' });
  } catch {
    await persistRecoveryRequired(journalStore, journal);
    return 'recoveryRequired';
  }
  return 'relaunchRequired';
}

async function persistRecoveryRequired(
  journalStore: WorkspaceSwitchJournalPort,
  journal: Readonly<WorkspaceSwitchJournalV1>,
): Promise<void> {
  try {
    const current = await journalStore.read();
    if (current === undefined || current.operationId !== journal.operationId) {
      throw new WorkspaceSwitchError('WORKSPACE_SWITCH_RECOVERY_REQUIRED');
    }
    await journalStore.write({ ...current, state: 'recoveryRequired' });
  } catch {
    throw new WorkspaceSwitchError('WORKSPACE_SWITCH_RECOVERY_REQUIRED');
  }
}

function resolveMode(
  registry: Readonly<LocalWorkspaceRegistryV1>,
  journal: Readonly<WorkspaceSwitchJournalV1> | undefined,
): WorkspaceSwitchStartupMode {
  if (journal === undefined) return 'normal';
  if (
    journal.state === 'targetSelected' &&
    registry.activeWorkspaceId === journal.targetWorkspaceId
  ) {
    return 'targetValidation';
  }
  if (
    journal.state === 'rollbackSelected' &&
    registry.activeWorkspaceId === journal.sourceWorkspaceId
  ) {
    return 'rollbackValidation';
  }
  throw new WorkspaceSwitchError('WORKSPACE_SWITCH_RECOVERY_REQUIRED');
}

function requireActiveReadyWorkspace(
  registry: Readonly<LocalWorkspaceRegistryV1>,
): Readonly<LocalWorkspaceRegistryEntryV1> {
  const activeWorkspaceId = registry.activeWorkspaceId as WorkspaceId;
  const workspace = findWorkspaceEntry(registry, activeWorkspaceId);
  if (workspace === undefined || workspace.lifecycleState !== 'ready') {
    throw new WorkspaceSwitchError('WORKSPACE_SWITCH_RECOVERY_REQUIRED');
  }
  return workspace;
}
