import { test, expect } from '@playwright/test';

import {
  electronE2eBackendStartupStages,
  parseElectronE2eBackendStatus,
  readElectronE2eBackendFailureCode,
} from '../../../desktop/e2e/electronE2eBackendStatus.js';

test('DESK-BACKEND-STATUS-001 @critical exposes only closed safe startup stages', () => {
  for (const stage of electronE2eBackendStartupStages) {
    const status = parseElectronE2eBackendStatus({ stage, type: 'failed' });
    expect(status).toEqual({ stage, type: 'failed' });

    const errorCode = readElectronE2eBackendFailureCode(stage);
    expect(errorCode).toMatch(
      /^DESKTOP_SMOKE_E2E_BACKEND_[A-Z0-9_]{1,80}_FAILED$/,
    );
    expect(errorCode).not.toContain('\\');
    expect(errorCode).not.toContain('/');
  }
});

test('DESK-BACKEND-STATUS-002 @critical rejects unknown and extended status payloads', () => {
  expect(
    parseElectronE2eBackendStatus({
      stage: 'unknownStage',
      type: 'failed',
    }),
  ).toBeUndefined();
  expect(
    parseElectronE2eBackendStatus({
      error: new Error('C:\\Users\\Example\\secret.txt'),
      stage: 'backendStart',
      type: 'failed',
    }),
  ).toBeUndefined();
  expect(
    parseElectronE2eBackendStatus({
      port: 3000,
      stack: 'private stack',
      type: 'ready',
    }),
  ).toBeUndefined();
  expect(
    parseElectronE2eBackendStatus({ port: 3000, type: 'ready' }),
  ).toEqual({ port: 3000, type: 'ready' });
});
