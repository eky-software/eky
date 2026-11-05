import { readAcceptedApplicationBuild, type VersionedAcceptedBuildMetadata } from './acceptedBuildMetadata.js';
import type { UpdateJournal } from './updateJournal.js';

// Terminal installation state is checked against application acceptance,
// never the selector's possibly older business baseline.
export function assertTerminalLocalUpdateJournal(
  metadata: Readonly<VersionedAcceptedBuildMetadata> | undefined,
  journal: Readonly<UpdateJournal> | undefined,
): void {
  if (journal === undefined) return;
  const application = metadata === undefined ? undefined : readAcceptedApplicationBuild(metadata);
  const accepted = journal.state === 'accepted';
  if ((!accepted && journal.state !== 'installerNotApplied' && journal.state !== 'rolledBack') ||
      application === undefined ||
      application.appVersion !== (accepted ? journal.targetVersion : journal.currentVersion) ||
      application.buildRevision !== (accepted ? journal.candidatePackageIdentity : journal.currentPackageIdentity).buildRevision ||
      application.releaseChannel !== journal.releaseChannel) {
    throw new Error('LOCAL_UPDATE_STATE_MIGRATION_CONFLICT');
  }
}
