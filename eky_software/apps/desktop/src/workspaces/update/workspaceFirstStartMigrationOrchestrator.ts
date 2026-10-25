import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

import {
  readAcceptedBusinessBaseline,
  type AcceptedBuildMetadata,
} from '../../update/acceptedBuildMetadata.js';
import type {
  PreBackendFirstStartFailureAuthority,
  PreBackendFirstStartFailureResult,
} from '../../update/preBackendFirstStartFailureAuthority.js';
import type { PreWorkspaceBuildAdmission } from '../../update/preWorkspaceBuildAdmission.js';
import type { WorkspaceRegistryInspectionPort } from '../registry/workspaceRegistryPort.js';
import type {
  LocalWorkspaceRegistry,
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
  WorkspaceFirstStartSelectorReturnAuthority,
} from './workspaceFirstStartMigrationOrchestratorTypes.js';
import type { WorkspaceMigrationInventoryCoordinator } from './workspaceMigrationInventoryCoordinator.js';
import {
  readDeferredBusinessAcceptance,
  type WorkspaceFirstStartDeferredBusinessAuthority,
} from './workspaceFirstStartDeferredBusiness.js';

const updateAdmissions = new Set<PreWorkspaceBuildAdmission>([
  'authorizedNewerBuild',
  'coordinatedUpdateTarget',
]);

interface WorkspaceFirstStartMigrationOrchestratorOptions {
  readonly acceptedBuild: WorkspaceFirstStartAcceptedBuildReader;
  readonly admission: PreWorkspaceBuildAdmission;
  readonly deferredBusiness?: WorkspaceFirstStartDeferredBusinessAuthority;
  readonly failureAuthority: Pick<
    PreBackendFirstStartFailureAuthority,
    'recordFailure'
  >;
  readonly inventory: Pick<WorkspaceMigrationInventoryCoordinator, 'inspect'>;
  readonly journal: Pick<WorkspaceFirstStartMigrationJournalPort, 'read' | 'inspect' | 'discardPrepared'>;
  readonly now?: () => Date;
  readonly operationIdFactory?: () => string;
  readonly registry: WorkspaceRegistryInspectionPort;
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
    | Readonly<{ kind: 'rollbackOnly' }>
    | Readonly<{ kind: 'required'; operation: PreparedOperation }>
    | undefined;
  private completed = false;
  private selectorReturnStarted = false;
  private preparationPending = false;
  private registryTransitionStarted = false;

  constructor(
    private readonly options: Readonly<
      WorkspaceFirstStartMigrationOrchestratorOptions
    >,
  ) {}

  async recoverBeforeWorkspaceResolution(): Promise<WorkspaceFirstStartRecoveryOutcome> {
    if (this.recoveryCompleted) return invalidOrchestration();
    if (this.options.deferredBusiness !== undefined) await this.assertDeferredAcceptance();
    const journalBeforeRecovery = await this.readJournal();
    let result;
    try {
      result = await this.options.transitions.recover(
        this.options.runningBuild,
      );
    } catch (error) {
      if (this.options.deferredBusiness !== undefined) {
        throw new WorkspaceFirstStartMigrationOrchestratorError('recoveryRequired', { cause: error });
      }
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
      (updateAdmissions.has(this.options.admission) || this.options.deferredBusiness !== undefined)
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
    if (!this.recoveryCompleted || this.preparation !== undefined || this.preparationPending || this.selectorReturnStarted) {
      return invalidOrchestration();
    }
    this.preparationPending = true;
    try { return await this.prepare(context); }
    finally { this.preparationPending = false; }
  }

  private async prepare(context: Readonly<WorkspaceFirstStartPreparationContext>): Promise<WorkspaceFirstStartPreparationOutcome> {

    if (context.rollbackOnly !== undefined) {
      if (this.options.deferredBusiness !== undefined) return invalidOrchestration();
      await context.rollbackOnly.assertCurrent();
      if (this.options.admission !== 'coordinatedUpdateTarget') return invalidOrchestration();
      const registry = await this.readRequiredRegistry();
      const sourceBuild = await this.resolveSourceBuild();
      const journal = await this.readJournal();
      await context.rollbackOnly.assertCurrent();
      if (sourceBuild === null || !buildsAreEqual(sourceBuild, context.rollbackOnly.sourceBuild) ||
          registry.activeWorkspaceId !== context.activeWorkspaceId ||
          registry.workspaces.find(entry => entry.workspaceId === context.activeWorkspaceId)?.lifecycleState !== 'ready' ||
          !isDeepStrictEqual(journal, this.resumedJournal)) return invalidOrchestration();
      if (journal !== undefined && (journal.state !== 'prepared' ||
          !buildsAreEqual(journal.sourceBuild, sourceBuild) ||
          !buildsAreEqual(journal.targetBuild, this.options.runningBuild) ||
          journal.activeWorkspaceId !== context.activeWorkspaceId ||
          calculateWorkspaceRegistrySha256(registry) !== journal.sourceRegistrySha256 ||
          calculateWorkspaceRegistrySha256(markPassiveWorkspacesRecoveryRequired(registry,
            journal.activeWorkspaceId, journal.passiveRecoveryWorkspaceIds)) !== journal.transitionedRegistrySha256)) {
        return recoveryRequired();
      }
      this.preparation = Object.freeze({ kind: 'rollbackOnly' });
      return 'rollbackOnly';
    }

    if (!updateAdmissions.has(this.options.admission) && this.options.deferredBusiness === undefined) {
      this.preparation = Object.freeze({ kind: 'notRequired' });
      return 'notRequired';
    }

    try {
      if (this.options.deferredBusiness !== undefined) {
        await this.assertDeferredAcceptance('source');
        if (context.workspaceState !== 'publishedRegistry') return invalidOrchestration();
      }
      if (context.workspaceState === 'legacyAdoptionPendingAcceptance') {
        await this.assertLegacyAdoptionHasNoPassiveRegistryState(
          context.activeWorkspaceId,
        );
        this.preparation = Object.freeze({ kind: 'notRequired' });
        return 'notRequired';
      }
      const registry = await this.readRequiredRegistry();
      if (this.options.deferredBusiness !== undefined &&
        registry.activeWorkspaceId !== context.activeWorkspaceId) return invalidOrchestration();
      const sourceBuild = await this.resolveSourceBuild();
      const inventory = await this.options.inventory.inspect();
      if (this.options.deferredBusiness !== undefined) {
        await this.assertDeferredAcceptance('source');
        if (!isDeepStrictEqual(registry, await this.readRequiredRegistry())) return invalidOrchestration();
        if (!isDeepStrictEqual(this.resumedJournal, await this.readJournal())) return recoveryRequired();
        await this.assertDeferredAcceptance('source');
      }
      const plan = resolveWorkspaceFirstStartMigrationPlan({
        admission: this.options.deferredBusiness === undefined ? this.options.admission : 'deferredBusiness',
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
    } catch (error) {
      return this.failBeforeBackend(error);
    }
  }

  async transitionRegistryAfterActiveWorkspaceAcceptance(): Promise<void> {
    const preparation = this.requirePreparation();
    if (preparation.kind === 'rollbackOnly') return invalidOrchestration();
    this.registryTransitionStarted = true;
    if (this.options.deferredBusiness !== undefined) await this.assertDeferredAcceptance('source');
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
    if (preparation.kind === 'rollbackOnly') return invalidOrchestration();
    if (this.completed) return invalidOrchestration();
    if (this.options.deferredBusiness !== undefined) await this.assertDeferredAcceptance('target');
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

  async cancelBeforeSelectorReturn(authority: WorkspaceFirstStartSelectorReturnAuthority): Promise<void> {
    if (this.options.deferredBusiness === undefined || !this.recoveryCompleted || this.preparationPending ||
        this.registryTransitionStarted || this.completed || this.selectorReturnStarted ||
        this.preparation?.kind === 'rollbackOnly') return invalidOrchestration();
    // Even a lost cancellation reply seals this instance. Restart rereads durable state.
    this.selectorReturnStarted = true;
    const assertCurrent = authority.assertCurrent.bind(authority);
    const assertTerminal = authority.assertTerminal.bind(authority);
    const expected = this.preparation?.kind === 'required'
      ? this.preparation.operation.journal : this.resumedJournal;
    const assertExternalSelection = async () => {
      assertCurrent();
      await assertTerminal();
      await this.assertDeferredAcceptance('source');
      const registry = await this.readRequiredRegistry();
      if (expected !== undefined && (expected.state !== 'prepared' ||
          calculateWorkspaceRegistrySha256(registry) !== expected.sourceRegistrySha256)) return recoveryRequired();
      await assertTerminal();
      assertCurrent();
    };
    await assertExternalSelection();
    const actual = await this.options.journal.inspect();
    await assertExternalSelection();
    if (!isDeepStrictEqual(actual?.value, expected)) return recoveryRequired();
    if (expected !== undefined && actual !== undefined) {
      await this.options.journal.discardPrepared(expected.operationId, {
        selected: actual, assertCurrent, assertExternalSelection,
      });
    }
    await assertExternalSelection();
    if (await this.options.journal.inspect() !== undefined) return recoveryRequired();
    await assertExternalSelection();
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
    if (this.options.deferredBusiness !== undefined) await this.options.deferredBusiness.assertCurrent();
    const acceptedBuild = await this.options.acceptedBuild.read();
    if (acceptedBuild === undefined) return invalidOrchestration();
    return toBuildIdentity(readAcceptedBusinessBaseline(acceptedBuild));
  }

  private async readRequiredRegistry(): Promise<
    Readonly<LocalWorkspaceRegistry>
  > {
    const registry = await this.options.registry.inspect();
    if (registry === undefined) return invalidOrchestration();
    return validateWorkspaceRegistry(registry);
  }

  private async readJournal(): Promise<Readonly<WorkspaceFirstStartMigrationJournalV1> | undefined> {
    if (this.options.deferredBusiness !== undefined) await this.options.deferredBusiness.assertCurrent();
    return this.options.journal.read();
  }

  private async assertLegacyAdoptionHasNoPassiveRegistryState(
    activeWorkspaceId: WorkspaceId,
  ): Promise<void> {
    if (this.resumedJournal !== undefined) return invalidOrchestration();
    const registryValue = await this.options.registry.inspect();
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
    registry: Readonly<LocalWorkspaceRegistry>,
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
    if (this.preparation === undefined || this.selectorReturnStarted) return invalidOrchestration();
    return this.preparation;
  }

  private async failBeforeBackend(error: unknown): Promise<never> {
    if (this.options.deferredBusiness !== undefined) {
      // Copy activation owns rollback; do not create a second C/Setup recovery.
      throw new WorkspaceFirstStartMigrationOrchestratorError('failed', { cause: error });
    }
    let result: PreBackendFirstStartFailureResult;
    try {
      result = await this.options.failureAuthority.recordFailure(
        this.options.admission,
      );
    } catch {
      throw new WorkspaceFirstStartMigrationOrchestratorError('failed', { cause: error });
    }
    if (result.kind === 'rollbackRequired') {
      throw new WorkspaceFirstStartMigrationOrchestratorError(
        'rollbackRequired',
        { cause: error },
      );
    }
    if (result.kind === 'directSetupRecoveryRequired') {
      throw new WorkspaceFirstStartMigrationOrchestratorError(
        'recoveryRequired',
        { cause: error },
      );
    }
    throw new WorkspaceFirstStartMigrationOrchestratorError('failed', { cause: error });
  }

  private now(): string {
    return (this.options.now ?? (() => new Date()))().toISOString();
  }

  private async assertDeferredAcceptance(expected?: 'source' | 'target'): Promise<void> {
    const authority = this.options.deferredBusiness;
    if (authority === undefined || this.options.admission !== 'exactAcceptedBuild') return invalidOrchestration();
    const state = await readDeferredBusinessAcceptance(authority, this.options.acceptedBuild, this.options.runningBuild);
    if (expected !== undefined && state !== expected) return invalidOrchestration();
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
