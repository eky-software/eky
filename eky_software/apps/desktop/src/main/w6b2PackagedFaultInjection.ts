import type {
  W6b2PackagedFaultProofConfiguration,
  W6b2PackagedProofConfiguration,
} from './w6b2PackagedProof.js';
import type { UpdateProfileProtection } from '../update/profileProtectionComposition.js';

export class W6b2PackagedFaultInjectedError extends Error {
  constructor() {
    super('The private packaged fault proof injected a failure.');
    this.name = 'W6b2PackagedFaultInjectedError';
  }
}

export interface W6b2PackagedFaultInjection {
  failActiveWorkspaceFirstStartIfRequested(): void;
  failBinaryRollbackLaunchIfRequested(): void;
  failPassiveWorkspaceMigrationIfRequested(): void;
  failPreUpdateRecoveryPointIfRequested(): void;
  interruptAfterRegistryTransitionIfRequested(): Promise<void>;
}

export function createW6b2PackagedFaultInjection(input: {
  readonly configuration: Readonly<W6b2PackagedProofConfiguration>;
  interruptProcess(
    configuration: Readonly<W6b2PackagedFaultProofConfiguration>,
  ): Promise<never>;
}): W6b2PackagedFaultInjection | undefined {
  if (input.configuration.controlFormatVersion !== 2) return undefined;
  const configuration = input.configuration;

  return Object.freeze({
    failActiveWorkspaceFirstStartIfRequested() {
      failIfRequested(
        configuration,
        ['activeWorkspaceFirstStartFailure', 'binaryRollbackFailure'],
        'targetFirstStartFailure',
      );
    },
    failBinaryRollbackLaunchIfRequested() {
      failIfRequested(
        configuration,
        ['binaryRollbackFailure'],
        'binaryRollbackFailure',
      );
    },
    failPassiveWorkspaceMigrationIfRequested() {
      failIfRequested(
        configuration,
        ['passiveWorkspaceMigrationFailure'],
        'passiveWorkspaceMigrationFailure',
      );
    },
    failPreUpdateRecoveryPointIfRequested() {
      failIfRequested(
        configuration,
        ['preUpdateRecoveryPointFailure'],
        'sourceHandoff',
      );
    },
    async interruptAfterRegistryTransitionIfRequested() {
      if (
        configuration.faultScenario === 'acceptanceInterruption' &&
        configuration.phase === 'targetAcceptanceInterruption'
      ) {
        await input.interruptProcess(configuration);
      }
    },
  });
}

export function createW6b2PackagedHandoffProfileProtection(
  profileProtection: UpdateProfileProtection,
  faultInjection: W6b2PackagedFaultInjection | undefined,
): UpdateProfileProtection {
  if (faultInjection === undefined) return profileProtection;

  return Object.freeze({
    createValidatedPreMigrationPoint: () =>
      profileProtection.createValidatedPreMigrationPoint(),
    async createValidatedPreUpdatePoint() {
      faultInjection.failPreUpdateRecoveryPointIfRequested();
      return profileProtection.createValidatedPreUpdatePoint();
    },
    enterMaintenance: (
      operationId: Parameters<UpdateProfileProtection['enterMaintenance']>[0],
    ) =>
      profileProtection.enterMaintenance(operationId),
    leaveMaintenance: (
      operationId: Parameters<UpdateProfileProtection['leaveMaintenance']>[0],
    ) =>
      profileProtection.leaveMaintenance(operationId),
    releaseProtectedPoint: (
      recoveryPointReference: Parameters<
        UpdateProfileProtection['releaseProtectedPoint']
      >[0],
    ) =>
      profileProtection.releaseProtectedPoint(recoveryPointReference),
    restoreRecoveryPoint: (
      input: Parameters<UpdateProfileProtection['restoreRecoveryPoint']>[0],
    ) =>
      profileProtection.restoreRecoveryPoint(input),
    validateActiveProfile: () => profileProtection.validateActiveProfile(),
  });
}

function failIfRequested(
  configuration: Readonly<W6b2PackagedFaultProofConfiguration>,
  scenarios: readonly W6b2PackagedFaultProofConfiguration['faultScenario'][],
  phase: W6b2PackagedFaultProofConfiguration['phase'],
): void {
  if (
    configuration.phase === phase &&
    scenarios.includes(configuration.faultScenario)
  ) {
    throw new W6b2PackagedFaultInjectedError();
  }
}
