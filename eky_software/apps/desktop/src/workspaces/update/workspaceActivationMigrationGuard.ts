import { serializeWorkspaceRegistry } from '../registry/workspaceRegistrySerializer.js';
import type { WorkspaceRegistryPort } from '../registry/workspaceRegistryPort.js';
import type { WorkspaceId } from '../registry/workspaceRegistryTypes.js';
import { validateWorkspaceId } from '../registry/workspaceIdValidation.js';
import {
  serializeWorkspaceSwitchJournal,
  type WorkspaceSwitchJournalPort,
} from '../switch/workspaceSwitchJournal.js';
import { validateWorkspaceBackupImportOperationId } from '../import/workspaceBackupImportOperationId.js';
import type { WorkspaceBackupImportOperationId } from '../import/workspaceBackupImportTypes.js';
import { WorkspaceActivationMigrationError } from './workspaceActivationMigrationError.js';

const profileIdPattern = /^[a-f0-9]{64}$/;

export interface WorkspaceActivationMigrationGuardInput {
  readonly expectedProfileId: string;
  readonly operationId: string;
  readonly sourceWorkspaceId: WorkspaceId;
  readonly targetWorkspaceId: WorkspaceId;
}

export interface WorkspaceActivationMigrationProof {
  readonly operationId: WorkspaceBackupImportOperationId;
  readonly profileId: string;
  readonly registrySnapshot: Uint8Array;
  readonly sourceWorkspaceId: WorkspaceId;
  readonly switchJournalSnapshot: Uint8Array;
  readonly targetWorkspaceId: WorkspaceId;
}

export class WorkspaceActivationMigrationGuard {
  constructor(
    private readonly registry: Pick<WorkspaceRegistryPort, 'read'>,
    private readonly switchJournal: Pick<WorkspaceSwitchJournalPort, 'read'>,
  ) {}

  async prove(
    input: Readonly<WorkspaceActivationMigrationGuardInput>,
  ): Promise<Readonly<WorkspaceActivationMigrationProof>> {
    try {
      const operationId = validateWorkspaceBackupImportOperationId(
        input.operationId,
      );
      const sourceWorkspaceId = validateWorkspaceId(
        input.sourceWorkspaceId,
      );
      const targetWorkspaceId = validateWorkspaceId(
        input.targetWorkspaceId,
      );
      if (
        sourceWorkspaceId === targetWorkspaceId ||
        !profileIdPattern.test(input.expectedProfileId)
      ) {
        throw new Error('invalid');
      }

      const [registry, journal] = await Promise.all([
        this.registry.read(),
        this.switchJournal.read(),
      ]);
      if (registry === undefined || journal === undefined) {
        throw new WorkspaceActivationMigrationError(
          'WORKSPACE_ACTIVATION_MIGRATION_RECOVERY_REQUIRED',
        );
      }
      const source = registry.workspaces.filter(
        (entry) => entry.workspaceId === sourceWorkspaceId,
      );
      const target = registry.workspaces.filter(
        (entry) => entry.workspaceId === targetWorkspaceId,
      );
      if (
        registry.activeWorkspaceId !== targetWorkspaceId ||
        source.length !== 1 ||
        target.length !== 1 ||
        source[0]?.lifecycleState !== 'ready' ||
        target[0]?.lifecycleState !== 'ready' ||
        target[0].lineageIdentity.profileId !== input.expectedProfileId ||
        journal.operationId !== operationId ||
        journal.sourceWorkspaceId !== sourceWorkspaceId ||
        journal.targetWorkspaceId !== targetWorkspaceId ||
        journal.state !== 'targetSelected'
      ) {
        throw new WorkspaceActivationMigrationError(
          'WORKSPACE_ACTIVATION_MIGRATION_RECOVERY_REQUIRED',
        );
      }

      return Object.freeze({
        operationId,
        profileId: input.expectedProfileId,
        registrySnapshot: serializeWorkspaceRegistry(registry),
        sourceWorkspaceId,
        switchJournalSnapshot: serializeWorkspaceSwitchJournal(journal),
        targetWorkspaceId,
      });
    } catch (error) {
      if (error instanceof WorkspaceActivationMigrationError) throw error;
      throw new WorkspaceActivationMigrationError(
        'WORKSPACE_ACTIVATION_MIGRATION_FAILED',
      );
    }
  }

  async reprove(
    proof: Readonly<WorkspaceActivationMigrationProof>,
  ): Promise<void> {
    try {
      const [registry, journal] = await Promise.all([
        this.registry.read(),
        this.switchJournal.read(),
      ]);
      if (
        registry === undefined ||
        journal === undefined ||
        !bytesEqual(
          proof.registrySnapshot,
          serializeWorkspaceRegistry(registry),
        ) ||
        !bytesEqual(
          proof.switchJournalSnapshot,
          serializeWorkspaceSwitchJournal(journal),
        )
      ) {
        throw new WorkspaceActivationMigrationError(
          'WORKSPACE_ACTIVATION_MIGRATION_RECOVERY_REQUIRED',
        );
      }
    } catch (error) {
      if (error instanceof WorkspaceActivationMigrationError) throw error;
      throw new WorkspaceActivationMigrationError(
        'WORKSPACE_ACTIVATION_MIGRATION_FAILED',
      );
    }
  }
}

function bytesEqual(first: Uint8Array, second: Uint8Array): boolean {
  return (
    first.byteLength === second.byteLength &&
    first.every((value, index) => value === second[index])
  );
}
