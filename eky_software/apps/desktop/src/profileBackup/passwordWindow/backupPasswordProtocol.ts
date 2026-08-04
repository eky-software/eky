import type {
  BackupPasswordSubmissionResult,
  BackupPasswordWindowMode,
} from './backupPasswordTypes.js';

export const backupPasswordSubmitIpcChannel =
  'eky:profile-backup-password:submit';
export const backupPasswordCancelIpcChannel =
  'eky:profile-backup-password:cancel';

const operationIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const maximumPasswordUtf16Length = 1_024;

export interface BackupPasswordSubmitMessage {
  confirmation?: string;
  operationId: string;
  password: string;
}

export interface BackupPasswordCancelMessage {
  operationId: string;
}

export function parseBackupPasswordSubmitMessage(
  value: unknown,
  mode: BackupPasswordWindowMode,
): BackupPasswordSubmitMessage | undefined {
  if (
    !isRecord(value) ||
    !operationIdPattern.test(readString(value.operationId)) ||
    !isBoundedPasswordString(value.password)
  ) {
    return undefined;
  }
  const operationId = readString(value.operationId);

  if (mode === 'create') {
    return hasExactKeys(value, [
      'confirmation',
      'operationId',
      'password',
    ]) && isBoundedPasswordString(value.confirmation)
      ? {
          confirmation: value.confirmation,
          operationId,
          password: value.password,
        }
      : undefined;
  }

  return hasExactKeys(value, ['operationId', 'password'])
    ? {
        operationId,
        password: value.password,
      }
    : undefined;
}

export function parseBackupPasswordCancelMessage(
  value: unknown,
): BackupPasswordCancelMessage | undefined {
  return isRecord(value) &&
    hasExactKeys(value, ['operationId']) &&
    operationIdPattern.test(readString(value.operationId))
    ? { operationId: readString(value.operationId) }
    : undefined;
}

export function parseBackupPasswordSubmissionResult(
  value: unknown,
): BackupPasswordSubmissionResult | undefined {
  if (!isRecord(value) || typeof value.accepted !== 'boolean') {
    return undefined;
  }

  if (value.accepted) {
    return hasExactKeys(value, ['accepted'])
      ? { accepted: true }
      : undefined;
  }

  return hasExactKeys(value, ['accepted', 'errorCode']) &&
    (value.errorCode === 'PASSWORD_INVALID' ||
      value.errorCode === 'PASSWORD_MISMATCH')
    ? {
        accepted: false,
        errorCode: value.errorCode,
      }
    : undefined;
}

function isBoundedPasswordString(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length <= maximumPasswordUtf16Length
  );
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  expectedKeys: readonly string[],
): boolean {
  const actualKeys = Object.keys(value).sort();
  return (
    actualKeys.length === expectedKeys.length &&
    expectedKeys
      .slice()
      .sort()
      .every((key, index) => actualKeys[index] === key)
  );
}
