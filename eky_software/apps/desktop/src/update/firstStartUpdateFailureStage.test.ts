import { describe, expect, it } from 'vitest';

import { FirstStartUpdateError } from './firstStartUpdateCoordinator.js';
import {
  firstStartPreMigrationFailureStages,
  readFirstStartPreMigrationFailureStage,
} from './firstStartUpdateFailureStage.js';
import { packagedUpdateSmokeFailureStages } from './packagedUpdateSmoke.js';

describe('first-start update failure stage', () => {
  it.each(firstStartPreMigrationFailureStages)(
    'preserves the allowlisted %s stage',
    (failureStage) => {
      expect(
        readFirstStartPreMigrationFailureStage(
          new FirstStartUpdateError(failureStage),
        ),
      ).toBe(failureStage);
    },
  );

  it.each(firstStartPreMigrationFailureStages)(
    'keeps the %s stage in the packaged smoke contract',
    (failureStage) => {
      expect(packagedUpdateSmokeFailureStages).toContain(failureStage);
    },
  );

  it('does not expose acceptance, cache, raw or forged failure values', () => {
    expect(
      readFirstStartPreMigrationFailureStage(
        new FirstStartUpdateError('acceptance'),
      ),
    ).toBeUndefined();
    expect(
      readFirstStartPreMigrationFailureStage(
        new FirstStartUpdateError('packageCacheRotation'),
      ),
    ).toBeUndefined();
    expect(
      readFirstStartPreMigrationFailureStage(
        new Error('C:\\private\\profile'),
      ),
    ).toBeUndefined();

    const forgedError = new FirstStartUpdateError();
    Object.defineProperty(forgedError, 'failureStage', {
      value: 'C:\\private\\profile',
    });
    expect(
      readFirstStartPreMigrationFailureStage(forgedError),
    ).toBeUndefined();
  });
});
