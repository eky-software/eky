import { isDeepStrictEqual } from 'node:util';

import {
  parseVersionedAcceptedBuildMetadata,
  type ScopedAcceptedBuildMetadata,
} from '../../update/acceptedBuildMetadata.js';
import type { WorkspaceFirstStartAcceptedBuildReader } from './workspaceFirstStartMigrationJournalTypes.js';
import { WorkspaceFirstStartMigrationOrchestratorError } from './workspaceFirstStartMigrationOrchestratorError.js';
import type { WorkspaceFirstStartBuildIdentity } from './workspaceFirstStartMigrationPlanTypes.js';

// The startup owner binds this to its generation, selected workspace and the
// exact permitted W6 registry transition. It does not confer migration health.
export interface WorkspaceFirstStartDeferredBusinessAuthority {
  readonly acceptedBuild: Readonly<ScopedAcceptedBuildMetadata>;
  assertCurrent(): Promise<void>;
}

export async function readDeferredBusinessAcceptance(
  authority: WorkspaceFirstStartDeferredBusinessAuthority,
  reader: WorkspaceFirstStartAcceptedBuildReader,
  runningBuild: Readonly<WorkspaceFirstStartBuildIdentity>,
): Promise<'source' | 'target'> {
  await authority.assertCurrent();
  const expected = parseVersionedAcceptedBuildMetadata(authority.acceptedBuild);
  if (expected.formatVersion !== 2 || expected.acceptanceScope !== 'selector' ||
    expected.acceptedBuild.appVersion !== runningBuild.appVersion ||
    expected.acceptedBuild.buildRevision !== runningBuild.buildRevision) {
    throw new WorkspaceFirstStartMigrationOrchestratorError('recoveryRequired');
  }
  const value = await reader.read();
  await authority.assertCurrent();
  if (value === undefined) throw new WorkspaceFirstStartMigrationOrchestratorError('recoveryRequired');
  const current = parseVersionedAcceptedBuildMetadata(value);
  if (isDeepStrictEqual(current, expected)) return 'source';
  if (current.formatVersion === 2 && current.acceptanceScope === 'business' &&
    current.acceptedBuild.appVersion === runningBuild.appVersion &&
    current.acceptedBuild.buildRevision === runningBuild.buildRevision) return 'target';
  throw new WorkspaceFirstStartMigrationOrchestratorError('recoveryRequired');
}
