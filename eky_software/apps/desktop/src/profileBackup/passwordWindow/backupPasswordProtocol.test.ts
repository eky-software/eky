import { describe, expect, it } from 'vitest';

import {
  parseBackupPasswordCancelMessage,
  parseBackupPasswordSubmissionResult,
  parseBackupPasswordSubmitMessage,
} from './backupPasswordProtocol.js';

const operationId = '11111111-1111-4111-8111-111111111111';

describe('backup password protocol', () => {
  it('accepts exact create, enter and cancel messages', () => {
    expect(
      parseBackupPasswordSubmitMessage(
        {
          confirmation: 'synthetic password',
          operationId,
          password: 'synthetic password',
        },
        'create',
      ),
    ).toEqual({
      confirmation: 'synthetic password',
      operationId,
      password: 'synthetic password',
    });
    expect(
      parseBackupPasswordSubmitMessage(
        { operationId, password: 'synthetic password' },
        'enter',
      ),
    ).toEqual({ operationId, password: 'synthetic password' });
    expect(parseBackupPasswordCancelMessage({ operationId })).toEqual({
      operationId,
    });
  });

  it.each([
    null,
    { operationId: null, password: 'synthetic password' },
    { operationId, password: null },
    { operationId, password: 'synthetic password', extra: true },
    {
      confirmation: null,
      operationId,
      password: 'synthetic password',
    },
  ])('rejects malformed and null-bearing messages', (value) => {
    expect(parseBackupPasswordSubmitMessage(value, 'create')).toBeUndefined();
    expect(parseBackupPasswordSubmitMessage(value, 'enter')).toBeUndefined();
  });

  it('accepts only bounded exact submission results', () => {
    expect(parseBackupPasswordSubmissionResult({ accepted: true })).toEqual({
      accepted: true,
    });
    expect(
      parseBackupPasswordSubmissionResult({
        accepted: false,
        errorCode: 'PASSWORD_MISMATCH',
      }),
    ).toEqual({
      accepted: false,
      errorCode: 'PASSWORD_MISMATCH',
    });
    expect(
      parseBackupPasswordSubmissionResult({
        accepted: false,
        errorCode: 'raw-error',
      }),
    ).toBeUndefined();
  });
});

