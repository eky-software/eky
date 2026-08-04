import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { createProfileSnapshotRuntimePaths } from './profileSnapshotRuntimePaths.js';

describe('profile snapshot runtime paths', () => {
  it('keeps private staging below the trusted desktop runtime root', () => {
    const runtimeRoot = resolve('desktop-runtime');

    expect(createProfileSnapshotRuntimePaths(runtimeRoot)).toEqual({
      stagingRoot: join(runtimeRoot, 'private-backup-staging'),
    });
  });
});
