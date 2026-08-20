import type { DesktopBuildInfo } from '../release/desktopBuildInfo.js';
import type { DesktopReleaseInfo } from '../release/desktopReleaseInfo.js';
import type { AcceptedBuildMetadata } from './acceptedBuildMetadata.js';
import type { DirectSetupMigrationRecovery } from './directSetupMigrationRecovery.js';
import { compareSemanticVersions } from './semanticVersionComparison.js';
import type { UpdateJournal } from './updateJournal.js';

export type PreWorkspaceBuildAdmission =
  | 'authorizedNewerBuild'
  | 'coordinatedUpdateTarget'
  | 'development'
  | 'exactAcceptedBuild'
  | 'initialInstall';

export type PreWorkspaceBuildRejection =
  | 'downgrade'
  | 'mixedOrUnknownUpdateIdentity'
  | 'sameVersionDifferentRevision';

interface PreWorkspaceBuildAdmissionStores {
  acceptedBuild: {
    read(): Promise<Readonly<AcceptedBuildMetadata> | undefined>;
  };
  directSetupRecovery: {
    read(): Promise<Readonly<DirectSetupMigrationRecovery> | undefined>;
  };
  journal: {
    read(): Promise<Readonly<UpdateJournal> | undefined>;
  };
}

export class PreWorkspaceBuildAdmissionError extends Error {
  readonly errorCode = 'DESKTOP_BUILD_ADMISSION_REJECTED';

  constructor(readonly reason: PreWorkspaceBuildRejection) {
    super('DESKTOP_BUILD_ADMISSION_REJECTED');
    this.name = 'PreWorkspaceBuildAdmissionError';
  }
}

export async function requirePreWorkspaceBuildAdmission(input: {
  buildInfo: Readonly<DesktopBuildInfo>;
  releaseInfo: Readonly<DesktopReleaseInfo> | undefined;
  stores: PreWorkspaceBuildAdmissionStores;
}): Promise<PreWorkspaceBuildAdmission> {
  if (input.releaseInfo === undefined) return 'development';

  const [acceptedBuild, directSetupRecovery, journal] = await Promise.all([
    input.stores.acceptedBuild.read(),
    input.stores.directSetupRecovery.read(),
    input.stores.journal.read(),
  ]);
  const result = classifyPreWorkspaceBuildAdmission({
    acceptedBuild,
    buildInfo: input.buildInfo,
    directSetupRecovery,
    journal,
    releaseInfo: input.releaseInfo,
  });
  if (result.status === 'rejected') {
    throw new PreWorkspaceBuildAdmissionError(result.reason);
  }
  return result.admission;
}

export function classifyPreWorkspaceBuildAdmission(input: {
  acceptedBuild: Readonly<AcceptedBuildMetadata> | undefined;
  buildInfo: Readonly<DesktopBuildInfo>;
  directSetupRecovery: Readonly<DirectSetupMigrationRecovery> | undefined;
  journal: Readonly<UpdateJournal> | undefined;
  releaseInfo: Readonly<DesktopReleaseInfo>;
}):
  | { admission: Exclude<PreWorkspaceBuildAdmission, 'development'>; status: 'allowed' }
  | { reason: PreWorkspaceBuildRejection; status: 'rejected' } {
  const running = {
    appVersion: input.releaseInfo.appVersion,
    buildRevision: input.releaseInfo.buildRevision,
  };
  if (
    input.buildInfo.buildDirty ||
    input.buildInfo.appVersion !== running.appVersion ||
    input.buildInfo.buildRevision !== running.buildRevision
  ) {
    return reject('mixedOrUnknownUpdateIdentity');
  }

  const activeJournal =
    input.journal?.state === 'accepted' ? undefined : input.journal;
  if (
    input.journal?.state === 'accepted' &&
    (input.acceptedBuild === undefined ||
      !matchesIdentity(input.acceptedBuild, {
        appVersion: input.journal.targetVersion,
        buildRevision:
          input.journal.candidatePackageIdentity.buildRevision,
      }))
  ) {
    return reject('mixedOrUnknownUpdateIdentity');
  }

  if (input.acceptedBuild === undefined) {
    return activeJournal === undefined && input.directSetupRecovery === undefined
      ? allow('initialInstall')
      : reject('mixedOrUnknownUpdateIdentity');
  }

  const versionComparison = compareSemanticVersions(
    running.appVersion,
    input.acceptedBuild.appVersion,
  );
  if (versionComparison < 0) return reject('downgrade');
  if (
    versionComparison === 0 &&
    input.acceptedBuild.buildRevision !== running.buildRevision
  ) {
    return reject('sameVersionDifferentRevision');
  }

  if (versionComparison === 0) {
    if (
      activeJournal !== undefined &&
      (!matchesJournalCurrent(activeJournal, running) ||
        !matchesJournalCurrent(activeJournal, input.acceptedBuild))
    ) {
      return reject('mixedOrUnknownUpdateIdentity');
    }
    if (
      input.directSetupRecovery !== undefined &&
      !matchesAcceptedDirectSetupRecovery(
        input.directSetupRecovery,
        input.acceptedBuild,
        running,
      )
    ) {
      return reject('mixedOrUnknownUpdateIdentity');
    }
    return allow('exactAcceptedBuild');
  }

  if (activeJournal !== undefined) {
    return matchesJournalTarget(activeJournal, running) &&
      matchesJournalCurrent(activeJournal, input.acceptedBuild) &&
      input.directSetupRecovery === undefined
      ? allow('coordinatedUpdateTarget')
      : reject('mixedOrUnknownUpdateIdentity');
  }
  if (
    input.directSetupRecovery !== undefined &&
    !matchesDirectSetupRecovery(
      input.directSetupRecovery,
      input.acceptedBuild,
      running,
    )
  ) {
    return reject('mixedOrUnknownUpdateIdentity');
  }
  return allow('authorizedNewerBuild');
}

function matchesAcceptedDirectSetupRecovery(
  recovery: Readonly<DirectSetupMigrationRecovery>,
  acceptedBuild: Readonly<AcceptedBuildMetadata>,
  running: Readonly<{ appVersion: string; buildRevision: string }>,
): boolean {
  return (
    recovery.state === 'accepted' &&
    matchesIdentity(recovery.runningTargetBuildIdentity, running) &&
    matchesIdentity(acceptedBuild, running)
  );
}

function matchesDirectSetupRecovery(
  recovery: Readonly<DirectSetupMigrationRecovery>,
  acceptedBuild: Readonly<AcceptedBuildMetadata>,
  running: Readonly<{ appVersion: string; buildRevision: string }>,
): boolean {
  return (
    matchesIdentity(recovery.previousAcceptedBuildIdentity, acceptedBuild) &&
    matchesIdentity(recovery.runningTargetBuildIdentity, running)
  );
}

function matchesJournalCurrent(
  journal: Readonly<UpdateJournal>,
  identity: Readonly<{ appVersion: string; buildRevision: string }>,
): boolean {
  return (
    journal.currentVersion === identity.appVersion &&
    journal.currentPackageIdentity.buildRevision === identity.buildRevision
  );
}

function matchesJournalTarget(
  journal: Readonly<UpdateJournal>,
  identity: Readonly<{ appVersion: string; buildRevision: string }>,
): boolean {
  return (
    journal.targetVersion === identity.appVersion &&
    journal.candidatePackageIdentity.buildRevision === identity.buildRevision
  );
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

function allow<
  Admission extends Exclude<PreWorkspaceBuildAdmission, 'development'>,
>(admission: Admission): { admission: Admission; status: 'allowed' } {
  return { admission, status: 'allowed' };
}

function reject(
  reason: PreWorkspaceBuildRejection,
): { reason: PreWorkspaceBuildRejection; status: 'rejected' } {
  return { reason, status: 'rejected' };
}
