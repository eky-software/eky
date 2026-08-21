import type { DesktopReleaseInfo } from '../release/desktopReleaseInfo.js';
import type { AcceptedBuildMetadata } from './acceptedBuildMetadata.js';
import {
  transitionDirectSetupMigrationRecovery,
  type DirectSetupMigrationRecovery,
} from './directSetupMigrationRecovery.js';
import type { PreWorkspaceBuildAdmission } from './preWorkspaceBuildAdmission.js';
import {
  transitionUpdateJournal,
  type UpdateJournal,
} from './updateJournal.js';

interface PreBackendFirstStartFailureAuthorityDependencies {
  acceptedBuildStore: {
    read(): Promise<Readonly<AcceptedBuildMetadata> | undefined>;
  };
  directSetupRecoveryStore: {
    read(): Promise<Readonly<DirectSetupMigrationRecovery> | undefined>;
    write(value: Readonly<DirectSetupMigrationRecovery>): Promise<void>;
  };
  journalStore: {
    read(): Promise<Readonly<UpdateJournal> | undefined>;
    write(value: Readonly<UpdateJournal>): Promise<void>;
  };
  now?(): Date;
  releaseInfo: Readonly<DesktopReleaseInfo> | undefined;
}

export type PreBackendFirstStartFailureResult = Readonly<
  | { kind: 'directSetupRecoveryRequired' }
  | { kind: 'directSetupFailedSafe' }
  | { kind: 'failedSafeWithoutRecovery' }
  | { kind: 'notApplicable' }
  | { kind: 'rollbackRequired' }
>;

export class PreBackendFirstStartFailureAuthorityError extends Error {
  readonly errorCode = 'DESKTOP_PRE_BACKEND_FIRST_START_FAILURE_INVALID';

  constructor() {
    super('DESKTOP_PRE_BACKEND_FIRST_START_FAILURE_INVALID');
    this.name = 'PreBackendFirstStartFailureAuthorityError';
  }
}

export class PreBackendFirstStartFailureAuthority {
  constructor(
    private readonly dependencies: Readonly<
      PreBackendFirstStartFailureAuthorityDependencies
    >,
  ) {}

  async recordFailure(
    admission: PreWorkspaceBuildAdmission,
  ): Promise<PreBackendFirstStartFailureResult> {
    if (admission === 'coordinatedUpdateTarget') {
      return this.recordCoordinatedFailure();
    }
    if (admission === 'authorizedNewerBuild') {
      return this.recordDirectSetupFailure();
    }
    return Object.freeze({ kind: 'notApplicable' });
  }

  private async recordCoordinatedFailure(): Promise<
    PreBackendFirstStartFailureResult
  > {
    const releaseInfo = this.requireReleaseInfo();
    const [acceptedBuild, directSetupRecovery, journal] = await Promise.all([
      this.dependencies.acceptedBuildStore.read(),
      this.dependencies.directSetupRecoveryStore.read(),
      this.dependencies.journalStore.read(),
    ]);
    if (
      acceptedBuild === undefined ||
      directSetupRecovery !== undefined ||
      journal === undefined ||
      (journal.state !== 'awaitingFirstStart' &&
        journal.state !== 'firstStartValidating') ||
      !matchesIdentity(acceptedBuild, {
        appVersion: journal.currentVersion,
        buildRevision: journal.currentPackageIdentity.buildRevision,
      }) ||
      !matchesIdentity(releaseInfo, {
        appVersion: journal.targetVersion,
        buildRevision: journal.candidatePackageIdentity.buildRevision,
      })
    ) {
      throw new PreBackendFirstStartFailureAuthorityError();
    }

    await this.dependencies.journalStore.write(
      transitionUpdateJournal(journal, {
        at: this.now(),
        state: 'rollbackRequired',
      }),
    );
    return Object.freeze({ kind: 'rollbackRequired' });
  }

  private async recordDirectSetupFailure(): Promise<
    PreBackendFirstStartFailureResult
  > {
    const releaseInfo = this.requireReleaseInfo();
    const [acceptedBuild, directSetupRecovery, journal] = await Promise.all([
      this.dependencies.acceptedBuildStore.read(),
      this.dependencies.directSetupRecoveryStore.read(),
      this.dependencies.journalStore.read(),
    ]);
    if (
      acceptedBuild === undefined ||
      (journal !== undefined &&
        (journal.state !== 'accepted' ||
          !matchesIdentity(acceptedBuild, {
            appVersion: journal.targetVersion,
            buildRevision: journal.candidatePackageIdentity.buildRevision,
          })))
    ) {
      throw new PreBackendFirstStartFailureAuthorityError();
    }
    if (directSetupRecovery === undefined) {
      return Object.freeze({ kind: 'failedSafeWithoutRecovery' });
    }
    if (
      !matchesIdentity(
        directSetupRecovery.previousAcceptedBuildIdentity,
        acceptedBuild,
      ) ||
      !matchesIdentity(
        directSetupRecovery.runningTargetBuildIdentity,
        releaseInfo,
      ) ||
      directSetupRecovery.state === 'accepted'
    ) {
      throw new PreBackendFirstStartFailureAuthorityError();
    }
    if (directSetupRecovery.state === 'recoveryRequired') {
      return Object.freeze({ kind: 'directSetupRecoveryRequired' });
    }
    if (directSetupRecovery.state === 'failedSafe') {
      return Object.freeze({ kind: 'directSetupFailedSafe' });
    }

    await this.dependencies.directSetupRecoveryStore.write(
      transitionDirectSetupMigrationRecovery(directSetupRecovery, {
        at: this.now(),
        state: 'recoveryRequired',
      }),
    );
    return Object.freeze({ kind: 'directSetupRecoveryRequired' });
  }

  private requireReleaseInfo(): Readonly<DesktopReleaseInfo> {
    if (this.dependencies.releaseInfo === undefined) {
      throw new PreBackendFirstStartFailureAuthorityError();
    }
    return this.dependencies.releaseInfo;
  }

  private now(): string {
    return (this.dependencies.now ?? (() => new Date()))().toISOString();
  }
}

function matchesIdentity(
  left: Readonly<{ appVersion: string; buildRevision: string }>,
  right: Readonly<{ appVersion: string; buildRevision: string }>,
): boolean {
  return (
    left.appVersion === right.appVersion &&
    left.buildRevision === right.buildRevision
  );
}
