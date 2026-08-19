import { findWorkspaceEntry, selectActiveWorkspace } from '../registry/workspaceRegistryMutations.js';
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

export interface WorkspaceSwitchStartupSelection {
  readonly mode: WorkspaceSwitchStartupMode;
  readonly workspace: Readonly<LocalWorkspaceRegistryEntryV1>;
  accept(profileId: string): Promise<void>;
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

  const mode = resolveMode(registry, journal);
  const workspace = requireActiveReadyWorkspace(registry);
  return Object.freeze({
    mode,
    workspace,
    async accept(profileId: string) {
      if (profileId !== workspace.lineageIdentity.profileId) {
        throw new WorkspaceSwitchError('WORKSPACE_SWITCH_INVALID');
      }
      if (journal !== undefined) {
        await journalStore.clear(journal.operationId);
      }
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
