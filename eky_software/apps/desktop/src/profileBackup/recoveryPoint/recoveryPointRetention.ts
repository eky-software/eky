import type {
  RecoveryPointIndexEntry,
  RecoveryPointKind,
} from './recoveryPointIndexStore.js';

export const recoveryPointDiskBudgetBytes = 2 * 1024 * 1024 * 1024;

const retentionLimits = Object.freeze({
  daily: 7,
  manual: 3,
  monthly: 6,
  preRestore: 2,
  preUpdate: 3,
  weekly: 4,
} satisfies Readonly<Record<RecoveryPointKind, number>>);

export interface RecoveryPointRetentionPlan {
  budgetExceededAfterRotation: boolean;
  deleteArtifactIds: readonly string[];
  protectedArtifactIds: readonly string[];
  retainedByteSize: number;
}

export function planRecoveryPointRetention(
  points: readonly RecoveryPointIndexEntry[],
  options: {
    activeProtectedArtifactIds?: readonly string[];
    diskBudgetBytes?: number;
  } = {},
): RecoveryPointRetentionPlan {
  const diskBudgetBytes =
    options.diskBudgetBytes ?? recoveryPointDiskBudgetBytes;
  if (
    !Number.isSafeInteger(diskBudgetBytes) ||
    diskBudgetBytes < 1
  ) {
    throw new Error('RECOVERY_POINT_RETENTION_INVALID');
  }

  const newestFirst = [...points].sort(compareNewestFirst);
  const knownIds = new Set(newestFirst.map(({ artifactId }) => artifactId));
  const protectedIds = new Set(
    (options.activeProtectedArtifactIds ?? []).filter((id) =>
      knownIds.has(id),
    ),
  );
  const latest = newestFirst[0];
  if (latest !== undefined) {
    protectedIds.add(latest.artifactId);
  }
  protectNewestKind(newestFirst, protectedIds, 'preRestore');
  protectNewestKind(newestFirst, protectedIds, 'preUpdate');

  const deleteIds = new Set<string>();
  for (const kind of Object.keys(
    retentionLimits,
  ) as RecoveryPointKind[]) {
    const kindPoints = newestFirst.filter(
      (point) => point.kind === kind,
    );
    for (const point of kindPoints.slice(retentionLimits[kind])) {
      if (!protectedIds.has(point.artifactId)) {
        deleteIds.add(point.artifactId);
      }
    }
  }

  let retainedByteSize = newestFirst.reduce(
    (sum, point) =>
      deleteIds.has(point.artifactId) ? sum : sum + point.byteSize,
    0,
  );
  if (retainedByteSize > diskBudgetBytes) {
    const oldestFirst = [...newestFirst].reverse();
    for (const point of oldestFirst) {
      if (
        retainedByteSize <= diskBudgetBytes ||
        deleteIds.has(point.artifactId) ||
        protectedIds.has(point.artifactId)
      ) {
        continue;
      }
      deleteIds.add(point.artifactId);
      retainedByteSize -= point.byteSize;
    }
  }

  return {
    budgetExceededAfterRotation: retainedByteSize > diskBudgetBytes,
    deleteArtifactIds: newestFirst
      .filter(({ artifactId }) => deleteIds.has(artifactId))
      .reverse()
      .map(({ artifactId }) => artifactId),
    protectedArtifactIds: newestFirst
      .filter(({ artifactId }) => protectedIds.has(artifactId))
      .map(({ artifactId }) => artifactId),
    retainedByteSize,
  };
}

function protectNewestKind(
  points: readonly RecoveryPointIndexEntry[],
  protectedIds: Set<string>,
  kind: 'preRestore' | 'preUpdate',
): void {
  const newest = points.find((point) => point.kind === kind);
  if (newest !== undefined) {
    protectedIds.add(newest.artifactId);
  }
}

function compareNewestFirst(
  first: RecoveryPointIndexEntry,
  second: RecoveryPointIndexEntry,
): number {
  return (
    Date.parse(second.validatedAt) - Date.parse(first.validatedAt) ||
    Date.parse(second.createdAt) - Date.parse(first.createdAt) ||
    second.artifactId.localeCompare(first.artifactId, 'en')
  );
}

export const recoveryPointRetentionLimits = retentionLimits;
