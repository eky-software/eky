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
import type { ReadOnlyJournalSlots } from '../persistence/readOnlyJournalSlots.js';
import { serializeVersionedWorkspaceSwitchJournal, type WorkspaceSwitchJournal } from '../switch/workspaceSwitchJournalCodec.js';
import { captureWorkspaceSelectorSwitchSelection, type WorkspaceSelectorSwitchSelection } from '../switch/workspaceSelectorSwitchSelection.js';
import { planWorkspaceSelectorSwitchSlots } from '../switch/workspaceSelectorSwitchSlots.js';

const profileIdPattern = /^[a-f0-9]{64}$/;

export interface WorkspaceActivationMigrationGuardInput {
  readonly expectedProfileId: string;
  readonly operationId: string;
  readonly sourceWorkspaceId: WorkspaceId | null;
  readonly targetWorkspaceId: WorkspaceId;
}

export interface WorkspaceActivationMigrationProof {
  readonly operationId: WorkspaceBackupImportOperationId;
  readonly profileId: string;
  readonly registrySnapshot: Uint8Array;
  readonly sourceWorkspaceId: WorkspaceId | null;
  readonly switchJournalSnapshot: Uint8Array;
  readonly targetWorkspaceId: WorkspaceId;
}

export interface WorkspaceSelectorActivationAuthority {
  readonly selection: WorkspaceSelectorSwitchSelection;
  readJournalSlots(): Promise<ReadOnlyJournalSlots<WorkspaceSwitchJournal>>;
}

export class WorkspaceActivationMigrationGuard {
  private readonly selector: ReturnType<typeof captureWorkspaceSelectorSwitchSelection> | undefined;
  private readonly readSelectorJournal: WorkspaceSelectorActivationAuthority['readJournalSlots'] | undefined;
  private readonly selectorProofs = new WeakSet<Readonly<WorkspaceActivationMigrationProof>>();

  constructor(
    private readonly registry: Pick<WorkspaceRegistryPort, 'read'>,
    private readonly switchJournal: Pick<WorkspaceSwitchJournalPort, 'read'>,
    selectorAuthority?: WorkspaceSelectorActivationAuthority,
  ) {
    try {
      this.selector = selectorAuthority === undefined ? undefined :
        captureWorkspaceSelectorSwitchSelection(selectorAuthority.selection);
      this.readSelectorJournal = selectorAuthority?.readJournalSlots.bind(selectorAuthority);
    } catch {
      throw new WorkspaceActivationMigrationError('WORKSPACE_ACTIVATION_MIGRATION_RECOVERY_REQUIRED');
    }
  }

  async prove(
    input: Readonly<WorkspaceActivationMigrationGuardInput>,
  ): Promise<Readonly<WorkspaceActivationMigrationProof>> {
    try {
      if (input.sourceWorkspaceId === null) return await this.proveSelector(input);
      if (this.selector !== undefined) this.selectorRecoveryRequired();
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
      if (proof.sourceWorkspaceId === null || this.selector !== undefined) {
        if (!this.selectorProofs.has(proof)) this.selectorRecoveryRequired();
        const current = await this.readSelectorProof({
          expectedProfileId: proof.profileId,
          operationId: proof.operationId,
          sourceWorkspaceId: proof.sourceWorkspaceId,
          targetWorkspaceId: proof.targetWorkspaceId,
        });
        if (!bytesEqual(current.registrySnapshot, proof.registrySnapshot) ||
          !bytesEqual(current.switchJournalSnapshot, proof.switchJournalSnapshot)) this.selectorRecoveryRequired();
        return;
      }
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

  private async proveSelector(input: Readonly<WorkspaceActivationMigrationGuardInput>): Promise<Readonly<WorkspaceActivationMigrationProof>> {
    const proof = await this.readSelectorProof(input);
    this.selectorProofs.add(proof);
    return proof;
  }

  private async readSelectorProof(input: Readonly<WorkspaceActivationMigrationGuardInput>): Promise<Readonly<WorkspaceActivationMigrationProof>> {
    const expectedProfileId = input.expectedProfileId;
    try {
      const selector = this.selector;
      const readJournal = this.readSelectorJournal;
      if (selector === undefined || readJournal === undefined || input.sourceWorkspaceId !== null) this.selectorRecoveryRequired();
      const { guard, journalSlots, registrySlots } = selector;
      guard.assertAuthority();
      // Only a fully published selection may start an inspection process.
      // Interrupted slots belong to startup recovery, never to this guard.
      if (journalSlots.current === undefined || registrySlots.current === undefined ||
        journalSlots.next !== undefined || journalSlots.backup !== undefined ||
        registrySlots.next !== undefined || registrySlots.backup !== undefined) this.selectorRecoveryRequired();
      const plan = planWorkspaceSelectorSwitchSlots(journalSlots, registrySlots);
      const operationId = validateWorkspaceBackupImportOperationId(input.operationId);
      const targetWorkspaceId = validateWorkspaceId(input.targetWorkspaceId);
      const target = plan.registry.workspaces.find(entry => entry.workspaceId === targetWorkspaceId);
      if (plan.mode !== 'validateTarget' || plan.journal.operationId !== operationId ||
        plan.journal.targetWorkspaceId !== targetWorkspaceId || target?.lifecycleState !== 'ready' ||
        !profileIdPattern.test(expectedProfileId) || target.lineageIdentity.profileId !== expectedProfileId) {
        this.selectorRecoveryRequired();
      }
      await guard.assertExternalSelection();
      selector.assertJournalSelection(await readJournal());
      await guard.assertExternalSelection();
      selector.assertJournalSelection(await readJournal());
      return Object.freeze({
        operationId, profileId: expectedProfileId,
        registrySnapshot: serializeWorkspaceRegistry(plan.registry), sourceWorkspaceId: null,
        switchJournalSnapshot: serializeVersionedWorkspaceSwitchJournal(plan.journal), targetWorkspaceId,
      });
    } catch {
      this.selectorRecoveryRequired();
    }
  }

  private selectorRecoveryRequired(): never {
    throw new WorkspaceActivationMigrationError('WORKSPACE_ACTIVATION_MIGRATION_RECOVERY_REQUIRED');
  }
}

function bytesEqual(first: Uint8Array, second: Uint8Array): boolean {
  return (
    first.byteLength === second.byteLength &&
    first.every((value, index) => value === second[index])
  );
}
