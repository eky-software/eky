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

export interface WorkspaceSwitchStartupSelection {
  readonly mode: WorkspaceSwitchStartupMode;
  readonly workspace: Readonly<LocalWorkspaceRegistryEntryV1>;
  accept(profileId: string): Promise<void>;
  recoverFromFailure(): Promise<'relaunchRequired' | 'notRecovered'>;
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
        await journalStore.write({ ...journal, state: 'recoveryRequired' });
        return 'notRecovered';
      }
      const currentRegistry = await registryPort.read();
      if (
        currentRegistry === undefined ||
        currentRegistry.activeWorkspaceId !== journal.targetWorkspaceId
      ) {
        await journalStore.write({ ...journal, state: 'recoveryRequired' });
        return 'notRecovered';
      }
      await registryPort.write(
        selectActiveWorkspace(
          currentRegistry,
          journal.targetWorkspaceId,
          journal.sourceWorkspaceId,
        ),
      );
      await journalStore.write({ ...journal, state: 'rollbackSelected' });
      return 'relaunchRequired';
    },
  });
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
