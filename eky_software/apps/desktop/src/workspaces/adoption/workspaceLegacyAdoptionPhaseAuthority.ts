import type { WorkspaceId } from '../registry/workspaceRegistryTypes.js';
import type { WorkspaceLegacyAdoptionSourceKind } from './workspaceLegacyAdoptionJournal.js';
import type { WorkspaceLegacyAdoptionMutationAuthority } from './workspaceLegacyAdoptionMutationAuthority.js';
import type { WorkspaceLegacyAdoptionPaths } from './workspaceLegacyAdoptionPaths.js';

export interface WorkspaceLegacyAdoptionPreparationAuthority extends WorkspaceLegacyAdoptionMutationAuthority {}

export interface WorkspaceLegacyAdoptionContext {
  readonly preparationAuthority: WorkspaceLegacyAdoptionPreparationAuthority;
  readonly operationId: string;
  readonly workspaceId: WorkspaceId;
  readonly sourceKind: WorkspaceLegacyAdoptionSourceKind;
  readonly createdAt: string;
  readonly paths: Readonly<WorkspaceLegacyAdoptionPaths>;
}

interface WorkspaceLegacyAdoptionTerminalAuthority extends Omit<WorkspaceLegacyAdoptionMutationAuthority, 'onUncertain'> {
  readonly context: Readonly<WorkspaceLegacyAdoptionContext>;
}

export interface WorkspaceLegacyAdoptionAcceptanceAuthority extends WorkspaceLegacyAdoptionTerminalAuthority {
  readonly phase: 'acceptance';
  readonly profileId: string;
}

export interface WorkspaceLegacyAdoptionRecoveryAuthority extends WorkspaceLegacyAdoptionTerminalAuthority {
  readonly phase: 'afterExit';
}
