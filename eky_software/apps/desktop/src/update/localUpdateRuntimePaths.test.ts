import { describe, expect, it } from 'vitest';
import { join } from 'node:path';

import { createLocalUpdateRuntimePaths } from './localUpdateRuntimePaths.js';

describe('local update runtime paths', () => {
  it('keeps private update state under the desktop runtime root', () => {
    expect(createLocalUpdateRuntimePaths('/private/runtime')).toEqual({
      acceptedBuildMetadataPath:
        join(
          '/private/runtime',
          'update-state',
          'accepted-build-v1.json',
        ),
      journalPath:
        join(
          '/private/runtime',
          'update-state',
          'local-update-journal-v1.json',
        ),
    });
  });
});
