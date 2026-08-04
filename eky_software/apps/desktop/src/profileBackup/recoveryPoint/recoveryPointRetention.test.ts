import { describe, expect, it } from 'vitest';

import type {
  RecoveryPointIndexEntry,
  RecoveryPointKind,
} from './recoveryPointIndexStore.js';
import {
  planRecoveryPointRetention,
  recoveryPointRetentionLimits,
} from './recoveryPointRetention.js';

describe('recovery point retention', () => {
  it('keeps the configured newest generations and deletes oldest first', () => {
    const points = [
      ...createPoints('daily', 9, 0),
      ...createPoints('weekly', 6, 20),
      ...createPoints('monthly', 8, 40),
      ...createPoints('preUpdate', 5, 60),
      ...createPoints('preRestore', 4, 80),
      ...createPoints('manual', 5, 100),
    ];

    const plan = planRecoveryPointRetention(points);

    expect(plan.deleteArtifactIds).toHaveLength(
      (9 - recoveryPointRetentionLimits.daily) +
        (6 - recoveryPointRetentionLimits.weekly) +
        (8 - recoveryPointRetentionLimits.monthly) +
        (5 - recoveryPointRetentionLimits.preUpdate) +
        (4 - recoveryPointRetentionLimits.preRestore) +
        (5 - recoveryPointRetentionLimits.manual),
    );
    expect(plan.budgetExceededAfterRotation).toBe(false);
  });

  it('preserves the latest good and newest pre-operation points over budget', () => {
    const points = [
      createPoint('daily', 1, 70),
      createPoint('preRestore', 2, 70),
      createPoint('preUpdate', 3, 70),
    ];

    const plan = planRecoveryPointRetention(points, {
      diskBudgetBytes: 100,
    });

    expect(plan.protectedArtifactIds).toEqual([
      points[2]?.artifactId,
      points[1]?.artifactId,
    ]);
    expect(plan.deleteArtifactIds).toEqual([points[0]?.artifactId]);
    expect(plan.budgetExceededAfterRotation).toBe(true);
    expect(plan.retainedByteSize).toBe(140);
  });

  it('honors an explicitly active point even when a newer replacement exists', () => {
    const points = [
      createPoint('preUpdate', 1, 60),
      createPoint('preUpdate', 2, 60),
      createPoint('daily', 3, 60),
    ];

    const plan = planRecoveryPointRetention(points, {
      activeProtectedArtifactIds: [points[0]!.artifactId],
      diskBudgetBytes: 120,
    });

    expect(plan.protectedArtifactIds).toEqual([
      points[2]!.artifactId,
      points[1]!.artifactId,
      points[0]!.artifactId,
    ]);
    expect(plan.deleteArtifactIds).toEqual([]);
    expect(plan.budgetExceededAfterRotation).toBe(true);
  });
});

function createPoints(
  kind: RecoveryPointKind,
  count: number,
  offset: number,
): RecoveryPointIndexEntry[] {
  return Array.from({ length: count }, (_, index) =>
    createPoint(kind, offset + index + 1, 1),
  );
}

function createPoint(
  kind: RecoveryPointKind,
  sequence: number,
  byteSize: number,
): RecoveryPointIndexEntry {
  const timestamp = new Date(
    Date.UTC(2026, 0, 1, 0, 0, sequence),
  ).toISOString();
  const suffix = sequence.toString(16).padStart(12, '0');
  return {
    artifactId: `11111111-1111-4111-8111-${suffix}`,
    byteSize,
    createdAt: timestamp,
    kind,
    state: 'validatedGood',
    validatedAt: timestamp,
  };
}
