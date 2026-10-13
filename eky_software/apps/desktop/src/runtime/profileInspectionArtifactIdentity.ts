import { createHash } from 'node:crypto';

export interface ProfileSnapshotArtifactIdentityItem {
  readonly byteSize: number;
  readonly logicalPath: string;
  readonly sha256: string;
}

/** Utility protocol identity, independent of catalog order and document naming. */
export function createProfileSnapshotArtifactIdentity(
  artifacts: readonly ProfileSnapshotArtifactIdentityItem[],
): string {
  const hash = createHash('sha256').update('eky-profile-artifacts-v1\n');
  const ordered = [...artifacts].sort((first, second) =>
    first.logicalPath < second.logicalPath ? -1 : first.logicalPath === second.logicalPath ? 0 : 1,
  );
  let previousPath: string | undefined;
  for (const artifact of ordered) {
    if (typeof artifact.logicalPath !== 'string' || artifact.logicalPath.length === 0 ||
        artifact.logicalPath === previousPath || !Number.isSafeInteger(artifact.byteSize) ||
        artifact.byteSize < 0 || !/^[a-f0-9]{64}$/.test(artifact.sha256)) {
      throw new Error('PROFILE_SNAPSHOT_ARTIFACTS_INVALID');
    }
    hash.update(JSON.stringify([artifact.logicalPath, artifact.byteSize, artifact.sha256]) + '\n');
    previousPath = artifact.logicalPath;
  }
  return hash.digest('hex');
}
