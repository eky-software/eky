import { join } from 'node:path';

import { WorkspaceLegacyAdoptionJournalStore } from '../adoption/workspaceLegacyAdoptionJournal.js';
import { NodeWorkspaceLegacyAdoptionRootStore } from '../adoption/workspaceLegacyAdoptionRootStore.js';
import { resolveWorkspaceLegacyAdoptionStartup } from '../adoption/workspaceLegacyAdoptionStartup.js';
import { deriveWorkspaceRoot } from '../registry/deriveWorkspaceRoot.js';
import { inspectWorkspaceRoot } from '../registry/inspectWorkspaceRoot.js';
import { WORKSPACE_REGISTRY_FILE_NAME } from '../registry/workspaceRegistryPaths.js';
import { WorkspaceRegistryStore } from '../registry/workspaceRegistryStore.js';
import type { WorkspaceId } from '../registry/workspaceRegistryTypes.js';
import { WorkspaceSwitchJournalStore } from '../switch/workspaceSwitchJournal.js';
import { resolveWorkspaceSwitchStartup } from '../switch/workspaceSwitchStartup.js';

export type ActiveWorkspaceStartupMode =
  | 'normal'
  | 'adoption'
  | 'targetValidation'
  | 'rollbackValidation';

export interface ActiveWorkspaceStartupSelection {
  readonly mode: ActiveWorkspaceStartupMode;
  readonly workspaceId: WorkspaceId;
  readonly workspaceRoot: string;
  accept(profileId: string): Promise<void>;
  recoverFromFailure(): Promise<'relaunchRequired' | 'notRecovered'>;
}

export async function resolveActiveWorkspaceStartup(
  userDataRoot: string,
): Promise<Readonly<ActiveWorkspaceStartupSelection>> {
  const registry = new WorkspaceRegistryStore({
    installationRoot: userDataRoot,
    filePath: join(userDataRoot, WORKSPACE_REGISTRY_FILE_NAME),
  });
  const adoptionJournal = new WorkspaceLegacyAdoptionJournalStore(userDataRoot);
  const [registryValue, adoptionJournalValue] = await Promise.all([
    registry.read(),
    adoptionJournal.read(),
  ]);

  if (registryValue === undefined || adoptionJournalValue !== undefined) {
    return resolveWorkspaceLegacyAdoptionStartup({
      journal: adoptionJournal,
      registry,
      rootStore: new NodeWorkspaceLegacyAdoptionRootStore(),
      userDataRoot,
    });
  }

  const switchSelection = await resolveWorkspaceSwitchStartup(
    registry,
    new WorkspaceSwitchJournalStore(userDataRoot),
  );
  const paths = deriveWorkspaceRoot(
    userDataRoot,
    switchSelection.workspace.workspaceId,
    switchSelection.workspace.layoutVersion,
  );
  await inspectWorkspaceRoot(paths);
  return Object.freeze({
    mode: switchSelection.mode,
    workspaceId: switchSelection.workspace.workspaceId,
    workspaceRoot: paths.workspaceRoot,
    accept: (profileId: string) => switchSelection.accept(profileId),
    recoverFromFailure: () => switchSelection.recoverFromFailure(),
  });
}
