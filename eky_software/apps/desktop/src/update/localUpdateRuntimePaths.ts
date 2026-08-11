import { join } from 'node:path';

import { acceptedBuildMetadataFileName } from './acceptedBuildMetadataStore.js';
import { updateJournalFileName } from './updateJournalStore.js';

export interface LocalUpdateRuntimePaths {
  acceptedBuildMetadataPath: string;
  journalPath: string;
  legacyAcceptedBuildMetadataPath: string;
  legacyJournalPath: string;
}

export function createLocalUpdateRuntimePaths(
  input: {
    legacyRuntimeRoot: string;
    userDataPath: string;
  },
): LocalUpdateRuntimePaths {
  const stateRoot = join(input.userDataPath, 'update-state');
  const legacyStateRoot = join(input.legacyRuntimeRoot, 'update-state');
  return {
    acceptedBuildMetadataPath: join(
      stateRoot,
      acceptedBuildMetadataFileName,
    ),
    journalPath: join(stateRoot, updateJournalFileName),
    legacyAcceptedBuildMetadataPath: join(
      legacyStateRoot,
      acceptedBuildMetadataFileName,
    ),
    legacyJournalPath: join(legacyStateRoot, updateJournalFileName),
  };
}
