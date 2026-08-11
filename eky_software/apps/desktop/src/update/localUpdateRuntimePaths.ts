import { join } from 'node:path';

import { acceptedBuildMetadataFileName } from './acceptedBuildMetadataStore.js';
import { updateJournalFileName } from './updateJournalStore.js';

export interface LocalUpdateRuntimePaths {
  acceptedBuildMetadataPath: string;
  journalPath: string;
}

export function createLocalUpdateRuntimePaths(
  runtimeRoot: string,
): LocalUpdateRuntimePaths {
  const stateRoot = join(runtimeRoot, 'update-state');
  return {
    acceptedBuildMetadataPath: join(
      stateRoot,
      acceptedBuildMetadataFileName,
    ),
    journalPath: join(stateRoot, updateJournalFileName),
  };
}
