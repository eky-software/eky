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

export type ActiveWorkspaceStartupPhase =
  | 'registryStateRead'
  | 'legacyAdoption'
  | 'switchRecovery'
  | 'workspaceRootInspection';

export interface ActiveWorkspaceStartupProgress {
  readonly phase: ActiveWorkspaceStartupPhase;
  readonly state: 'started' | 'completed';
}

export interface ActiveWorkspaceStartupOptions {
  readonly reportProgress?: (
    progress: Readonly<ActiveWorkspaceStartupProgress>,
  ) => void;
}

export interface ActiveWorkspaceStartupSelection {
  readonly mode: ActiveWorkspaceStartupMode;
  readonly workspaceId: WorkspaceId;
  readonly workspaceRoot: string;
  accept(profileId: string): Promise<void>;
  recoverFromFailure(): Promise<'relaunchRequired' | 'notRecovered'>;
}

export async function resolveActiveWorkspaceStartup(
  userDataRoot: string,
  options: Readonly<ActiveWorkspaceStartupOptions> = {},
): Promise<Readonly<ActiveWorkspaceStartupSelection>> {
  reportProgress(options, 'registryStateRead', 'started');
  const registry = new WorkspaceRegistryStore({
    installationRoot: userDataRoot,
    filePath: join(userDataRoot, WORKSPACE_REGISTRY_FILE_NAME),
  });
  const adoptionJournal = new WorkspaceLegacyAdoptionJournalStore(userDataRoot);
  const [registryValue, adoptionJournalValue] = await Promise.all([
    registry.read(),
    adoptionJournal.read(),
  ]);
  reportProgress(options, 'registryStateRead', 'completed');

  if (registryValue === undefined || adoptionJournalValue !== undefined) {
    reportProgress(options, 'legacyAdoption', 'started');
    const selection = await resolveWorkspaceLegacyAdoptionStartup({
      journal: adoptionJournal,
      registry,
      rootStore: new NodeWorkspaceLegacyAdoptionRootStore(),
      userDataRoot,
    });
    reportProgress(options, 'legacyAdoption', 'completed');
    return selection;
  }

  reportProgress(options, 'switchRecovery', 'started');
  const switchSelection = await resolveWorkspaceSwitchStartup(
    registry,
    new WorkspaceSwitchJournalStore(userDataRoot),
  );
  reportProgress(options, 'switchRecovery', 'completed');
  const paths = deriveWorkspaceRoot(
    userDataRoot,
    switchSelection.workspace.workspaceId,
    switchSelection.workspace.layoutVersion,
  );
  reportProgress(options, 'workspaceRootInspection', 'started');
  await inspectWorkspaceRoot(paths);
  reportProgress(options, 'workspaceRootInspection', 'completed');
  return Object.freeze({
    mode: switchSelection.mode,
    workspaceId: switchSelection.workspace.workspaceId,
    workspaceRoot: paths.workspaceRoot,
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
