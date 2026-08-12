import { gzipSync } from 'node:zlib';

import { writeExclusiveSyncedFile } from '../localUpdateFileOperations.js';

const errorCodePattern = /^[A-Z][A-Z0-9_]{2,80}$/;
const buildRevisionPattern = /^[0-9a-f]{7,40}$/i;

export interface UpdateRecoverySupportBundleInput {
  appVersion: string;
  architecture: string;
  buildRevision: string;
  createdAt: string;
  electronVersion: string;
  errorCode: string;
  platform: string;
  targetPath: string;
}

export async function createUpdateRecoverySupportBundle(
  input: Readonly<UpdateRecoverySupportBundleInput>,
): Promise<void> {
  if (
    !errorCodePattern.test(input.errorCode) ||
    !buildRevisionPattern.test(input.buildRevision) ||
    !isBoundedText(input.appVersion, 80) ||
    !isBoundedText(input.architecture, 20) ||
    !isBoundedText(input.electronVersion, 40) ||
    !isBoundedText(input.platform, 20) ||
    !isUtcTimestamp(input.createdAt)
  ) {
    throw new Error('UPDATE_RECOVERY_SUPPORT_BUNDLE_INVALID');
  }

  const payload = Object.freeze({
    appVersion: input.appVersion,
    architecture: input.architecture,
    buildRevision: input.buildRevision,
    createdAt: input.createdAt,
    electronVersion: input.electronVersion,
    errorCode: input.errorCode,
    formatVersion: 1,
    platform: input.platform,
  });
  const bytes = gzipSync(Buffer.from(`${JSON.stringify(payload)}\n`, 'utf8'), {
    level: 9,
  });
  await writeExclusiveSyncedFile(input.targetPath, bytes);
}

export function createUpdateRecoverySupportBundleFilename(now: Date): string {
  return `eky-update-recovery-${now.toISOString().slice(0, 10)}.json.gz`;
}

function isBoundedText(value: string, maxLength: number): boolean {
  return value.length >= 1 && value.length <= maxLength;
}

function isUtcTimestamp(value: string): boolean {
  return (
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}
