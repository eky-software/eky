import { randomUUID } from 'node:crypto';

import type { AcceptedBuildMetadata } from '../../update/acceptedBuildMetadata.js';
import type {
  PreBackendFirstStartFailureAuthority,
  PreBackendFirstStartFailureResult,
} from '../../update/preBackendFirstStartFailureAuthority.js';
import type { PreWorkspaceBuildAdmission } from '../../update/preWorkspaceBuildAdmission.js';
import type { WorkspaceRegistryPort } from '../registry/workspaceRegistryPort.js';
import type {
  LocalWorkspaceRegistryV1,
  WorkspaceId,
} from '../registry/workspaceRegistryTypes.js';
import { validateWorkspaceRegistry } from '../registry/workspaceRegistryValidation.js';
import { resolveWorkspaceFirstStartMigrationPlan } from './resolveWorkspaceFirstStartMigrationPlan.js';
import type {
  WorkspaceFirstStartAcceptedBuildReader,
  WorkspaceFirstStartMigrationJournalPort,
  WorkspaceFirstStartMigrationJournalV1,
} from './workspaceFirstStartMigrationJournalTypes.js';
import { WorkspaceFirstStartMigrationOrchestratorError } from './workspaceFirstStartMigrationOrchestratorError.js';
import type {
  WorkspaceFirstStartBuildIdentity,
  WorkspaceFirstStartMigrationPlan,
} from './workspaceFirstStartMigrationPlanTypes.js';
import {
  calculateWorkspaceRegistrySha256,
  markPassiveWorkspacesRecoveryRequired,
} from './workspaceFirstStartMigrationRegistryTransitions.js';
import type { WorkspaceFirstStartMigrationTransitionCoordinator } from './workspaceFirstStartMigrationTransitionCoordinator.js';
import type {
  WorkspaceFirstStartMigrationOrchestration,
  WorkspaceFirstStartPreparationContext,
  WorkspaceFirstStartPreparationOutcome,
  WorkspaceFirstStartRecoveryOutcome,
} from './workspaceFirstStartMigrationOrchestratorTypes.js';
import type { WorkspaceMigrationInventoryCoordinator } from './workspaceMigrationInventoryCoordinator.js';

const updateAdmissions = new Set<PreWorkspaceBuildAdmission>([
  'authorizedNewerBuild',
  'coordinatedUpdateTarget',
]);

interface WorkspaceFirstStartMigrationOrchestratorOptions {
  readonly acceptedBuild: WorkspaceFirstStartAcceptedBuildReader;
  readonly admission: PreWorkspaceBuildAdmission;
  readonly failureAuthority: Pick<
    PreBackendFirstStartFailureAuthority,
    'recordFailure'
  >;
  readonly inventory: Pick<WorkspaceMigrationInventoryCoordinator, 'inspect'>;
  readonly journal: Pick<WorkspaceFirstStartMigrationJournalPort, 'read'>;
  readonly now?: () => Date;
  readonly operationIdFactory?: () => string;
  readonly registry: Pick<WorkspaceRegistryPort, 'read'>;
  readonly runningBuild: Readonly<WorkspaceFirstStartBuildIdentity>;
  readonly transitions: Pick<
    WorkspaceFirstStartMigrationTransitionCoordinator,
    | 'cancelPrepared'
    | 'completeAcceptedTarget'
    | 'prepare'
    | 'recover'
    | 'transitionRegistry'
  >;
}

type PreparedOperation = Readonly<{
  journal: Readonly<WorkspaceFirstStartMigrationJournalV1>;
  registryTransitioned: boolean;
}>;

export class WorkspaceFirstStartMigrationOrchestrator
  implements WorkspaceFirstStartMigrationOrchestration
{
  private recoveryCompleted = false;
  private resumedJournal:
    | Readonly<WorkspaceFirstStartMigrationJournalV1>
    | undefined;
  private preparation:
    | Readonly<{ kind: 'notRequired' }>
    | Readonly<{ kind: 'required'; operation: PreparedOperation }>
    | undefined;
  private completed = false;

  constructor(
    private readonly options: Readonly<
      WorkspaceFirstStartMigrationOrchestratorOptions
    >,
  ) {}

  async recoverBeforeWorkspaceResolution(): Promise<WorkspaceFirstStartRecoveryOutcome> {
    if (this.recoveryCompleted) return invalidOrchestration();
    const journalBeforeRecovery = await this.options.journal.read();
    let result;
    try {
      result = await this.options.transitions.recover(
        this.options.runningBuild,
      );
    } catch {
      return recoveryRequired();
    }

    this.recoveryCompleted = true;
    if (result.kind === 'noJournal') return 'noJournal';
    if (
      journalBeforeRecovery === undefined ||
      journalBeforeRecovery.operationId !== result.operationId
    ) {
      return recoveryRequired();
    }
    if (result.kind === 'recoveryRequired') return recoveryRequired();
    if (result.kind === 'recoveredSource') return 'recoveredSource';
    if (result.kind === 'acceptedTarget') {
      if (
        !buildsAreEqual(
          this.options.runningBuild,
          journalBeforeRecovery.targetBuild,
        )
      ) {
        return recoveryRequired();
      }
      return 'acceptedTarget';
    }

    if (
      buildsAreEqual(
        this.options.runningBuild,
        journalBeforeRecovery.targetBuild,
      ) &&
      updateAdmissions.has(this.options.admission)
    ) {
      this.resumedJournal = journalBeforeRecovery;
      return 'resumable';
    }
    if (
      buildsAreEqual(
        this.options.runningBuild,
        journalBeforeRecovery.sourceBuild,
      ) &&
      this.options.admission === 'exactAcceptedBuild'
    ) {
      try {
        await this.options.transitions.cancelPrepared(result.operationId);
      } catch {
        return recoveryRequired();
      }
      return 'preparedCancelled';
    }
    return recoveryRequired();
  }

  async prepareBeforeBackend(
    context: Readonly<WorkspaceFirstStartPreparationContext>,
  ): Promise<WorkspaceFirstStartPreparationOutcome> {
    if (!this.recoveryCompleted || this.preparation !== undefined) {
      return invalidOrchestration();
    }

    if (!updateAdmissions.has(this.options.admission)) {
      this.preparation = Object.freeze({ kind: 'notRequired' });
      return 'notRequired';
    }

    try {
      if (context.workspaceState === 'legacyAdoptionPendingAcceptance') {
        await this.assertLegacyAdoptionHasNoPassiveRegistryState(
          context.activeWorkspaceId,
        );
        this.preparation = Object.freeze({ kind: 'notRequired' });
        return 'notRequired';
      }
      const registry = await this.readRequiredRegistry();
      const sourceBuild = await this.resolveSourceBuild();
      const inventory = await this.options.inventory.inspect();
      const plan = resolveWorkspaceFirstStartMigrationPlan({
        admission: this.options.admission,
        ...(inventory === undefined ? {} : { inventory }),
        registry,
        sourceBuild,
        targetBuild: this.options.runningBuild,
      });

      if (this.resumedJournal !== undefined) {
        this.assertResumedPlan(
          this.resumedJournal,
          plan,
          registry,
          sourceBuild,
        );
        this.preparation = Object.freeze({
          kind: 'required',
          operation: Object.freeze({
            journal: this.resumedJournal,
            registryTransitioned: false,
          }),
        });
        return 'resumed';
      }

      if (plan.kind === 'notRequired') {
        this.preparation = Object.freeze({ kind: 'notRequired' });
        return 'notRequired';
      }
      if (sourceBuild === null) return invalidOrchestration();
      const journal = await this.options.transitions.prepare({
        createdAt: this.now(),
        operationId: (this.options.operationIdFactory ?? randomUUID)(),
        plan,
        sourceBuild,
        targetBuild: this.options.runningBuild,
      });
      this.preparation = Object.freeze({
        kind: 'required',
        operation: Object.freeze({
          journal,
          registryTransitioned: false,
        }),
      });
      return 'prepared';
    } catch {
      return this.failBeforeBackend();
    }
  }

  async transitionRegistryAfterActiveWorkspaceAcceptance(): Promise<void> {
    const preparation = this.requirePreparation();
    if (preparation.kind === 'notRequired') return;
    if (preparation.operation.registryTransitioned) {
      return invalidOrchestration();
    }
    const journal = preparation.operation.journal;
    await this.options.transitions.transitionRegistry({
      operationId: journal.operationId,
      sourceBuild: journal.sourceBuild,
      targetBuild: journal.targetBuild,
      updatedAt: this.now(),
    });
    this.preparation = Object.freeze({
      kind: 'required',
      operation: Object.freeze({
        journal,
        registryTransitioned: true,
      }),
    });
  }

  async completeAfterTargetAcceptance(): Promise<void> {
    const preparation = this.requirePreparation();
    if (this.completed) return invalidOrchestration();
    if (preparation.kind === 'notRequired') {
      this.completed = true;
      return;
    }
    if (!preparation.operation.registryTransitioned) {
      return invalidOrchestration();
    }
    const journal = preparation.operation.journal;
    await this.options.transitions.completeAcceptedTarget({
      operationId: journal.operationId,
      sourceBuild: journal.sourceBuild,
      targetBuild: journal.targetBuild,
    });
    this.completed = true;
  }

  private async resolveSourceBuild(): Promise<
    Readonly<WorkspaceFirstStartBuildIdentity> | null
  > {
    if (
      this.options.admission === 'development' ||
      this.options.admission === 'initialInstall'
    ) {
      return null;
    }
    const acceptedBuild = await this.options.acceptedBuild.read();
    if (acceptedBuild === undefined) return invalidOrchestration();
    return toBuildIdentity(acceptedBuild);
  }

  private async readRequiredRegistry(): Promise<
    Readonly<LocalWorkspaceRegistryV1>
  > {
    const registry = await this.options.registry.read();
    if (registry === undefined) return invalidOrchestration();
    return validateWorkspaceRegistry(registry);
  }

  private async assertLegacyAdoptionHasNoPassiveRegistryState(
    activeWorkspaceId: WorkspaceId,
  ): Promise<void> {
    if (this.resumedJournal !== undefined) return invalidOrchestration();
    const registryValue = await this.options.registry.read();
    if (registryValue === undefined) return;
    const registry = validateWorkspaceRegistry(registryValue);
    if (
      registry.activeWorkspaceId !== activeWorkspaceId ||
      registry.workspaces.length !== 1 ||
      registry.workspaces[0]?.workspaceId !== activeWorkspaceId ||
      registry.workspaces[0].lifecycleState !== 'ready'
    ) {
      return invalidOrchestration();
    }
  }

  private assertResumedPlan(
    journal: Readonly<WorkspaceFirstStartMigrationJournalV1>,
    plan: Readonly<WorkspaceFirstStartMigrationPlan>,
    registry: Readonly<LocalWorkspaceRegistryV1>,
    sourceBuild: Readonly<WorkspaceFirstStartBuildIdentity> | null,
  ): void {
    if (
      sourceBuild === null ||
      plan.activeWorkspace === null ||
      !buildsAreEqual(sourceBuild, journal.sourceBuild) ||
      !buildsAreEqual(this.options.runningBuild, journal.targetBuild) ||
      plan.activeWorkspace.workspaceId !== journal.activeWorkspaceId ||
      !workspaceIdsAreEqual(
        plan.passiveRecoveryWorkspaceIds,
        journal.passiveRecoveryWorkspaceIds,
      ) ||
      calculateWorkspaceRegistrySha256(registry) !==
        journal.sourceRegistrySha256
    ) {
      return invalidOrchestration();
    }
    const transitioned = markPassiveWorkspacesRecoveryRequired(
      registry,
      journal.activeWorkspaceId,
      journal.passiveRecoveryWorkspaceIds,
    );
    if (
      calculateWorkspaceRegistrySha256(transitioned) !==
      journal.transitionedRegistrySha256
    ) {
      return invalidOrchestration();
    }
  }

  private requirePreparation(): NonNullable<
    WorkspaceFirstStartMigrationOrchestrator['preparation']
  > {
    if (this.preparation === undefined) return invalidOrchestration();
    return this.preparation;
  }

  private async failBeforeBackend(): Promise<never> {
    let result: PreBackendFirstStartFailureResult;
    try {
      result = await this.options.failureAuthority.recordFailure(
        this.options.admission,
      );
    } catch {
      throw new WorkspaceFirstStartMigrationOrchestratorError('failed');
    }
    if (result.kind === 'rollbackRequired') {
      throw new WorkspaceFirstStartMigrationOrchestratorError(
        'rollbackRequired',
      );
    }
    if (result.kind === 'directSetupRecoveryRequired') {
      throw new WorkspaceFirstStartMigrationOrchestratorError(
        'recoveryRequired',
      );
    }
    throw new WorkspaceFirstStartMigrationOrchestratorError('failed');
  }

  private now(): string {
    return (this.options.now ?? (() => new Date()))().toISOString();
  }
}

function toBuildIdentity(
  value: Readonly<AcceptedBuildMetadata>,
): Readonly<WorkspaceFirstStartBuildIdentity> {
  return Object.freeze({
    appVersion: value.appVersion,
    buildRevision: value.buildRevision,
  });
}

function buildsAreEqual(
  first: Readonly<WorkspaceFirstStartBuildIdentity>,
  second: Readonly<WorkspaceFirstStartBuildIdentity>,
): boolean {
  return (
    first.appVersion === second.appVersion &&
    first.buildRevision === second.buildRevision
  );
}

function workspaceIdsAreEqual(
  first: readonly string[],
  second: readonly string[],
): boolean {
  return (
    first.length === second.length &&
    first.every((value, index) => value === second[index])
  );
}

function invalidOrchestration(): never {
  throw new WorkspaceFirstStartMigrationOrchestratorError('failed');
}

function recoveryRequired(): never {
  throw new WorkspaceFirstStartMigrationOrchestratorError(
    'recoveryRequired',
  );
}
