import type { AcceptedBuildMetadata } from '../../update/acceptedBuildMetadata.js';
import type { WorkspaceRegistryPort } from '../registry/workspaceRegistryPort.js';
import type { LocalWorkspaceRegistryV1 } from '../registry/workspaceRegistryTypes.js';
import { validateWorkspaceRegistry } from '../registry/workspaceRegistryValidation.js';
import {
  validateWorkspaceFirstStartBuildIdentity,
  validateWorkspaceFirstStartMigrationJournal,
} from './workspaceFirstStartMigrationJournalCodec.js';
import { WorkspaceFirstStartMigrationTransitionError } from './workspaceFirstStartMigrationJournalError.js';
import type {
  WorkspaceFirstStartAcceptedBuildReader,
  WorkspaceFirstStartMigrationJournalPort,
  WorkspaceFirstStartMigrationJournalV1,
  WorkspaceFirstStartMigrationRecoveryResult,
} from './workspaceFirstStartMigrationJournalTypes.js';
import type {
  WorkspaceFirstStartBuildIdentity,
  WorkspaceFirstStartMigrationPlan,
} from './workspaceFirstStartMigrationPlanTypes.js';
import {
  calculateWorkspaceRegistrySha256,
  markPassiveWorkspacesRecoveryRequired,
  restoreJournaledPassiveWorkspacesReady,
} from './workspaceFirstStartMigrationRegistryTransitions.js';

export interface WorkspaceFirstStartMigrationTransitionCoordinatorOptions {
  readonly acceptedBuild: WorkspaceFirstStartAcceptedBuildReader;
  readonly journal: WorkspaceFirstStartMigrationJournalPort;
  readonly registry: Pick<WorkspaceRegistryPort, 'read' | 'write'>;
}

export class WorkspaceFirstStartMigrationTransitionCoordinator {
  constructor(
    private readonly options: Readonly<
      WorkspaceFirstStartMigrationTransitionCoordinatorOptions
    >,
  ) {}

  async prepare(input: {
    readonly operationId: string;
    readonly plan: Readonly<WorkspaceFirstStartMigrationPlan>;
    readonly sourceBuild: Readonly<WorkspaceFirstStartBuildIdentity>;
    readonly targetBuild: Readonly<WorkspaceFirstStartBuildIdentity>;
    readonly createdAt: string;
  }): Promise<Readonly<WorkspaceFirstStartMigrationJournalV1>> {
    if (input.plan.kind !== 'required' || input.plan.activeWorkspace === null) {
      return invalidTransition();
    }
    const registry = await this.readRequiredRegistry();
    if (
      registry.activeWorkspaceId !== input.plan.activeWorkspace.workspaceId
    ) {
      return invalidTransition();
    }
    const transitionedRegistry = markPassiveWorkspacesRecoveryRequired(
      registry,
      input.plan.activeWorkspace.workspaceId,
      input.plan.passiveRecoveryWorkspaceIds,
    );
    const journal = validateWorkspaceFirstStartMigrationJournal({
      formatVersion: 1,
      operationId: input.operationId,
      state: 'prepared',
      sourceBuild: input.sourceBuild,
      targetBuild: input.targetBuild,
      activeWorkspaceId: input.plan.activeWorkspace.workspaceId,
      passiveRecoveryWorkspaceIds: input.plan.passiveRecoveryWorkspaceIds,
      sourceRegistrySha256: calculateWorkspaceRegistrySha256(registry),
      transitionedRegistrySha256:
        calculateWorkspaceRegistrySha256(transitionedRegistry),
      createdAt: input.createdAt,
      updatedAt: input.createdAt,
    });
    await this.options.journal.write(journal);
    return journal;
  }

  async transitionRegistry(input: {
    readonly operationId: string;
    readonly sourceBuild: Readonly<WorkspaceFirstStartBuildIdentity>;
    readonly targetBuild: Readonly<WorkspaceFirstStartBuildIdentity>;
    readonly updatedAt: string;
  }): Promise<Readonly<WorkspaceFirstStartMigrationJournalV1>> {
    const journal = await this.readRequiredJournal(input.operationId);
    assertBuildsMatch(journal.sourceBuild, input.sourceBuild);
    assertBuildsMatch(journal.targetBuild, input.targetBuild);
    const registry = await this.readRequiredRegistry();
    const registrySha256 = calculateWorkspaceRegistrySha256(registry);
    if (journal.state === 'registryTransitioned') {
      if (registrySha256 !== journal.transitionedRegistrySha256) {
        return recoveryRequired();
      }
      return journal;
    }

    if (registrySha256 === journal.sourceRegistrySha256) {
      const transitioned = markPassiveWorkspacesRecoveryRequired(
        registry,
        journal.activeWorkspaceId,
        journal.passiveRecoveryWorkspaceIds,
      );
      if (
        calculateWorkspaceRegistrySha256(transitioned) !==
        journal.transitionedRegistrySha256
      ) {
        return recoveryRequired();
      }
      if (
        journal.sourceRegistrySha256 !== journal.transitionedRegistrySha256
      ) {
        await this.options.registry.write(transitioned);
      }
    } else if (registrySha256 !== journal.transitionedRegistrySha256) {
      return recoveryRequired();
    }

    const transitionedJournal = validateWorkspaceFirstStartMigrationJournal({
      ...journal,
      state: 'registryTransitioned',
      updatedAt: input.updatedAt,
    });
    await this.options.journal.write(transitionedJournal);
    return transitionedJournal;
  }

  async cancelPrepared(operationId: string): Promise<void> {
    const journal = await this.readRequiredJournal(operationId);
    if (journal.state !== 'prepared') return invalidTransition();
    const registry = await this.readRequiredRegistry();
    if (
      calculateWorkspaceRegistrySha256(registry) !==
      journal.sourceRegistrySha256
    ) {
      return recoveryRequired();
    }
    await this.options.journal.discardPrepared(operationId);
  }

  async recover(
    runningBuildInput: Readonly<WorkspaceFirstStartBuildIdentity>,
  ): Promise<Readonly<WorkspaceFirstStartMigrationRecoveryResult>> {
    const journal = await this.options.journal.read();
    if (journal === undefined) return Object.freeze({ kind: 'noJournal' });

    const runningBuild = validateWorkspaceFirstStartBuildIdentity(
      runningBuildInput,
    );
    if (
      !buildsAreEqual(runningBuild, journal.sourceBuild) &&
      !buildsAreEqual(runningBuild, journal.targetBuild)
    ) {
      return frozenRecoveryRequired(journal.operationId);
    }
    const registryValue = await this.options.registry.read();
    if (registryValue === undefined) {
      return frozenRecoveryRequired(journal.operationId);
    }
    const registry = validateWorkspaceRegistry(registryValue);
    const registrySha256 = calculateWorkspaceRegistrySha256(registry);
    const acceptedBuild = await this.options.acceptedBuild.read();
    const accepted = classifyAcceptedBuild(acceptedBuild, journal);

    if (journal.state === 'prepared') {
      if (
        accepted === 'source' &&
        registrySha256 === journal.sourceRegistrySha256
      ) {
        return Object.freeze({
          kind: 'resumable',
          operationId: journal.operationId,
        });
      }
      if (
        accepted === 'source' &&
        registrySha256 === journal.transitionedRegistrySha256
      ) {
        await this.restoreSourceRegistry(registry, journal);
        await this.options.journal.discardPrepared(journal.operationId);
        return Object.freeze({
          kind: 'recoveredSource',
          operationId: journal.operationId,
        });
      }
      if (
        accepted === 'target' &&
        registrySha256 === journal.transitionedRegistrySha256
      ) {
        await this.options.journal.discardPrepared(journal.operationId);
        return Object.freeze({
          kind: 'acceptedTarget',
          operationId: journal.operationId,
        });
      }
      return frozenRecoveryRequired(journal.operationId);
    }

    if (accepted === 'source') {
      if (registrySha256 === journal.transitionedRegistrySha256) {
        await this.restoreSourceRegistry(registry, journal);
      } else if (registrySha256 !== journal.sourceRegistrySha256) {
        return frozenRecoveryRequired(journal.operationId);
      }
      await this.options.journal.removeTransitioned(journal.operationId);
      return Object.freeze({
        kind: 'recoveredSource',
        operationId: journal.operationId,
      });
    }
    if (
      accepted === 'target' &&
      registrySha256 === journal.transitionedRegistrySha256
    ) {
      await this.options.journal.removeTransitioned(journal.operationId);
      return Object.freeze({
        kind: 'acceptedTarget',
        operationId: journal.operationId,
      });
    }
    return frozenRecoveryRequired(journal.operationId);
  }

  private async restoreSourceRegistry(
    registry: Readonly<LocalWorkspaceRegistryV1>,
    journal: Readonly<WorkspaceFirstStartMigrationJournalV1>,
  ): Promise<void> {
    const restored = restoreJournaledPassiveWorkspacesReady({
      registry,
      expectedActiveWorkspaceId: journal.activeWorkspaceId,
      passiveRecoveryWorkspaceIds: journal.passiveRecoveryWorkspaceIds,
      sourceRegistrySha256: journal.sourceRegistrySha256,
      transitionedRegistrySha256: journal.transitionedRegistrySha256,
    });
    if (
      calculateWorkspaceRegistrySha256(registry) !==
      journal.sourceRegistrySha256
    ) {
      await this.options.registry.write(restored);
    }
  }

  private async readRequiredRegistry(): Promise<
    Readonly<LocalWorkspaceRegistryV1>
  > {
    const value = await this.options.registry.read();
    if (value === undefined) return invalidTransition();
    try {
      return validateWorkspaceRegistry(value);
    } catch {
      return invalidTransition();
    }
  }

  private async readRequiredJournal(
    operationId: string,
  ): Promise<Readonly<WorkspaceFirstStartMigrationJournalV1>> {
    const journal = await this.options.journal.read();
    if (journal === undefined || journal.operationId !== operationId) {
      return invalidTransition();
    }
    return journal;
  }
}

function classifyAcceptedBuild(
  acceptedBuild: Readonly<AcceptedBuildMetadata> | undefined,
  journal: Readonly<WorkspaceFirstStartMigrationJournalV1>,
): 'source' | 'target' | 'other' {
  if (acceptedBuild === undefined) return 'other';
  if (buildsAreEqual(acceptedBuild, journal.sourceBuild)) return 'source';
  if (buildsAreEqual(acceptedBuild, journal.targetBuild)) return 'target';
  return 'other';
}

function assertBuildsMatch(
  expected: Readonly<WorkspaceFirstStartBuildIdentity>,
  value: Readonly<WorkspaceFirstStartBuildIdentity>,
): void {
  let validated: Readonly<WorkspaceFirstStartBuildIdentity>;
  try {
    validated = validateWorkspaceFirstStartBuildIdentity(value);
  } catch {
    return invalidTransition();
  }
  if (!buildsAreEqual(expected, validated)) return invalidTransition();
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

function frozenRecoveryRequired(
  operationId: string,
): Readonly<WorkspaceFirstStartMigrationRecoveryResult> {
  return Object.freeze({ kind: 'recoveryRequired', operationId });
}

function invalidTransition(): never {
  throw new WorkspaceFirstStartMigrationTransitionError('invalid');
}

function recoveryRequired(): never {
  throw new WorkspaceFirstStartMigrationTransitionError('recoveryRequired');
}
