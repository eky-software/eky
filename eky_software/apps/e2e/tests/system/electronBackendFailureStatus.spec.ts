import { expect, test } from '@playwright/test';

import {
  electronE2eBackendBrokers,
  electronE2eBackendFailureReasons,
} from '../../../desktop/e2e/electronE2eBackendFailure.js';
import {
  electronE2eBackendLogStages,
  electronE2eBackendStartupStages,
  parseElectronE2eBackendFailureObservation,
  parseElectronE2eBackendStatus,
} from '../../../desktop/e2e/electronE2eBackendStatus.js';

const failure = {
  type: 'failed', stage: 'backendStart', reason: 'SQLITE_BUSY', brokerCleanupFailures: [],
};

test.describe('SYS-ELECTRON-BACKEND-FAILURE-STATUS-001 @critical @security', () => {
  test('accepts each closed failure stage and reason with mandatory cleanup results', () => {
    for (const stage of electronE2eBackendStartupStages) {
      expect(parseElectronE2eBackendStatus({ ...failure, stage }))
        .toEqual({ ...failure, stage });
    }
    for (const reason of electronE2eBackendFailureReasons) {
      expect(parseElectronE2eBackendStatus({ ...failure, reason }))
        .toEqual({ ...failure, reason });
    }
    expect(parseElectronE2eBackendStatus({ type: 'ready', port: 43127 }))
      .toEqual({ type: 'ready', port: 43127 });
  });

  test('copies and freezes cleanup failures in the owner catalog order', () => {
    const input = {
      ...failure, brokerCleanupFailures: [...electronE2eBackendBrokers].reverse(),
    };
    const parsed = parseElectronE2eBackendStatus(input);
    expect(parsed).toEqual({ ...failure, brokerCleanupFailures: electronE2eBackendBrokers });
    expect(parsed).not.toBe(input);
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(parsed?.type).toBe('failed');
    if (parsed?.type !== 'failed') throw new Error('EXPECTED_BACKEND_FAILURE_STATUS');
    expect(parsed.brokerCleanupFailures).not.toBe(input.brokerCleanupFailures);
    expect(Object.isFrozen(parsed.brokerCleanupFailures)).toBe(true);
    input.brokerCleanupFailures.length = 0;
    input.reason = 'synthetic-private-mutation';
    expect(parsed.reason).toBe('SQLITE_BUSY');
    expect(parsed.brokerCleanupFailures).toEqual(electronE2eBackendBrokers);
  });

  test('rejects missing and extra keys including legacy two-field status and private metadata', () => {
    for (const value of [
      undefined, null, [], 'failed', {},
      { type: 'failed', stage: 'backendStart' },
      { type: 'failed', stage: 'backendStart', reason: 'SQLITE_BUSY' },
      { type: 'failed', stage: 'backendStart', brokerCleanupFailures: [] },
      { stage: 'backendStart', reason: 'SQLITE_BUSY', brokerCleanupFailures: [] },
      { type: 'failed', reason: 'SQLITE_BUSY', brokerCleanupFailures: [] },
      { ...failure, type: 'progress' },
    ]) expect(parseElectronE2eBackendStatus(value)).toBeUndefined();
    for (const key of ['message', 'error', 'stack', 'path', 'session', 'companyId', 'port', 'backendAttempt']) {
      expect(parseElectronE2eBackendStatus({ ...failure, [key]: 'synthetic-private-value' }))
        .toBeUndefined();
    }
  });

  test('rejects observation-only stages, approximate reasons and invalid broker catalogs', () => {
    for (const stage of [...electronE2eBackendLogStages, 'unknownStage', 'backendStart private', null]) {
      expect(parseElectronE2eBackendStatus({ ...failure, stage })).toBeUndefined();
    }
    for (const reason of ['sqlite_busy', 'SQLITE_BUSY_TIMEOUT', 'ENOENT private', null, {}, 1]) {
      expect(parseElectronE2eBackendStatus({ ...failure, reason })).toBeUndefined();
    }
    for (const brokerCleanupFailures of [
      undefined, null, 'secretBroker', {}, [null], [1], ['privateBroker'],
      ['secretBroker', 'secretBroker'],
      [...electronE2eBackendBrokers, 'secretBroker'],
      ['secretBroker', { message: 'synthetic-private-error' }],
    ]) {
      expect(parseElectronE2eBackendStatus({ ...failure, brokerCleanupFailures })).toBeUndefined();
    }
  });

  test('rejects a sparse cleanup list rather than dropping an unvalidated slot', () => {
    const brokerCleanupFailures = new Array<string>(1);
    expect(parseElectronE2eBackendStatus({ ...failure, brokerCleanupFailures })).toBeUndefined();
  });

  test('unreadable status payloads return no status without throwing', () => {
    const hostile = new Proxy({}, {
      get() { throw new Error('synthetic-private-property-error'); },
    });
    const hostileKeys = new Proxy({ ...failure }, {
      ownKeys() { throw new Error('synthetic-private-key-error'); },
    });
    const revoked = Proxy.revocable({}, {});
    revoked.revoke();
    for (const value of [hostile, hostileKeys, revoked.proxy]) {
      expect(parseElectronE2eBackendStatus(value)).toBeUndefined();
      expect(parseElectronE2eBackendFailureObservation(value)).toBeUndefined();
    }
  });

  test('the observation accepts only a positive safe backend attempt and a strict failure', () => {
    for (const backendAttempt of [1, 2, Number.MAX_SAFE_INTEGER]) {
      const input = { backendAttempt, status: { ...failure, brokerCleanupFailures: ['secretBroker'] } };
      const parsed = parseElectronE2eBackendFailureObservation(input);
      expect(parsed).toEqual(input);
      expect(Object.isFrozen(parsed)).toBe(true);
      expect(Object.isFrozen(parsed?.status)).toBe(true);
      expect(Object.isFrozen(parsed?.status.brokerCleanupFailures)).toBe(true);
      input.backendAttempt = 0;
      input.status.brokerCleanupFailures.length = 0;
      expect(parsed?.backendAttempt).toBe(backendAttempt);
      expect(parsed?.status.brokerCleanupFailures).toEqual(['secretBroker']);
    }
    for (const backendAttempt of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '1', null]) {
      expect(parseElectronE2eBackendFailureObservation({ backendAttempt, status: failure })).toBeUndefined();
    }
  });

  test('the observation rejects ready status, unvalidated nested status and business identity', () => {
    for (const value of [
      undefined, null, [], 'failure', {},
      { status: failure }, { backendAttempt: 1 },
      { backendAttempt: 1, status: { type: 'ready', port: 43127 } },
      { backendAttempt: 1, status: { type: 'failed', stage: 'backendStart' } },
      { backendAttempt: 1, status: { ...failure, message: 'synthetic-private-error' } },
      { backendAttempt: 1, status: failure, companyId: 'synthetic-company' },
      { backendAttempt: 1, status: failure, attempt: 0 },
      { backendAttempt: 1, status: failure, stack: 'synthetic-private-stack' },
    ]) expect(parseElectronE2eBackendFailureObservation(value)).toBeUndefined();
  });
});
