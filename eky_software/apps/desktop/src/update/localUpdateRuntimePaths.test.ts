import { describe, expect, it } from 'vitest';
import { join } from 'node:path';

import { createLocalUpdateRuntimePaths } from './localUpdateRuntimePaths.js';

describe('local update runtime paths', () => {
  it('keeps authoritative state installation-scoped and identifies legacy state', () => {
    expect(createLocalUpdateRuntimePaths({
      legacyRuntimeRoot: '/private/runtime',
      userDataPath: '/private/user-data',
    })).toEqual({
      acceptedBuildMetadataPath:
        join(
          '/private/user-data',
          'update-state',
          'accepted-build-v1.json',
        ),
      journalPath:
        join(
          '/private/user-data',
          'update-state',
          'local-update-journal-v1.json',
        ),
      legacyAcceptedBuildMetadataPath:
        join(
          '/private/runtime',
          'update-state',
          'accepted-build-v1.json',
        ),
      legacyJournalPath:
        join(
          '/private/runtime',
          'update-state',
          'local-update-journal-v1.json',
        ),
    });
  });
});
