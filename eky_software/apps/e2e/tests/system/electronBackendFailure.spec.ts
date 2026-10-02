import { expect, test } from '@playwright/test';

import {
  classifyElectronE2eBackendFailure,
  electronE2eBackendBrokers,
  electronE2eBackendFailureReasons,
  isElectronE2eBackendFailureReason,
  reportElectronE2eBackendFailure,
} from '../../../desktop/e2e/electronE2eBackendFailure.js';
import {
  parseElectronE2eBackendStatus,
  type ElectronE2eBackendFailureStatus,
} from '../../../desktop/e2e/electronE2eBackendStatus.js';

test.describe('SYS-ELECTRON-BACKEND-FAILURE-001 @critical @security @fault', () => {
  test('projects exact own codes without copying private error fields', () => {
    for (const reason of electronE2eBackendFailureReasons) {
      const error = Object.assign(new Error('synthetic-private-message'), {
        code: reason, stack: 'synthetic-private-stack',
        session: 'synthetic-private-session', path: 'synthetic-private-path',
      });
      expect(classifyElectronE2eBackendFailure(error)).toBe(reason);
      expect(isElectronE2eBackendFailureReason(reason)).toBe(true);
    }
    for (const code of [
      'eaddrinuse', 'EADDRINUSE synthetic-private-message', 'SQLITE_BUSY_TIMEOUT',
      '', null, 1, {}, ['ENOENT'],
    ]) {
      expect(isElectronE2eBackendFailureReason(code)).toBe(false);
      expect(classifyElectronE2eBackendFailure({ code })).toBe('unknown');
    }
  });

  test('only exact internal sentinel messages classify, never message substrings or stacks', () => {
    const sentinel = 'ELECTRON_E2E_BACKEND_MODULE_INVALID';
    for (const reason of electronE2eBackendFailureReasons) {
      expect(classifyElectronE2eBackendFailure(new Error(reason)))
        .toBe(reason.startsWith('ELECTRON_E2E_') ? reason : 'unknown');
    }
    for (const value of [
      undefined, null, true, 7, 'ENOENT', [],
      new Error(`synthetic-private-prefix ${sentinel}`),
      new Error(`${sentinel} synthetic-private-suffix`),
      new Error('connect EADDRINUSE at synthetic-private-path'),
      { stack: `Error: ${sentinel}\nsynthetic-private-stack` },
      Object.create({ code: 'ENOENT', message: sentinel, cause: { code: 'EACCES' } }),
    ]) expect(classifyElectronE2eBackendFailure(value)).toBe('unknown');
    expect(classifyElectronE2eBackendFailure({ code: 'EACCES', message: sentinel }))
      .toBe('EACCES');
  });

  test('walks at most four distinct error objects and prefers the nearest known reason', () => {
    const leaf = { code: 'SQLITE_CANTOPEN' };
    const fourth = { cause: { cause: { cause: leaf } } };
    expect(classifyElectronE2eBackendFailure(fourth)).toBe('SQLITE_CANTOPEN');
    expect(classifyElectronE2eBackendFailure({ cause: fourth })).toBe('unknown');
    expect(classifyElectronE2eBackendFailure({ code: 'unknown', cause: leaf }))
      .toBe('SQLITE_CANTOPEN');
    expect(classifyElectronE2eBackendFailure({ code: 'PRIVATE_CODE', cause: leaf }))
      .toBe('SQLITE_CANTOPEN');
    expect(classifyElectronE2eBackendFailure({ code: 'EIO', cause: leaf })).toBe('EIO');
    const cyclic: { cause?: unknown } = {};
    const second: { cause?: unknown; code?: string } = { cause: cyclic };
    cyclic.cause = second;
    expect(classifyElectronE2eBackendFailure(cyclic)).toBe('unknown');
    second.code = 'SQLITE_LOCKED';
    expect(classifyElectronE2eBackendFailure(cyclic)).toBe('SQLITE_LOCKED');
  });

  test('never calls getters or coerces private values while classifying', () => {
    const reads: string[] = [];
    const error = {};
    for (const key of ['code', 'message', 'cause', 'stack']) {
      Object.defineProperty(error, key, {
        enumerable: true,
        get() { reads.push(key); throw new Error('synthetic-private-accessor'); },
      });
    }
    expect(classifyElectronE2eBackendFailure(error)).toBe('unknown');
    const unsafeValue = {
      toString() { reads.push('toString'); throw new Error('synthetic-private-coercion'); },
      [Symbol.toPrimitive]() { reads.push('toPrimitive'); return 'ENOENT'; },
    };
    expect(classifyElectronE2eBackendFailure({ code: unsafeValue, message: unsafeValue }))
      .toBe('unknown');
    expect(classifyElectronE2eBackendFailure({ cause: error })).toBe('unknown');
    expect(reads).toEqual([]);
  });

  test('unreadable descriptors fail closed without leaking or throwing their error', () => {
    const hostile = new Proxy({}, {
      getOwnPropertyDescriptor() { throw new Error('synthetic-private-proxy-error'); },
    });
    const revoked = Proxy.revocable({}, {});
    revoked.revoke();
    expect(classifyElectronE2eBackendFailure(hostile)).toBe('unknown');
    expect(classifyElectronE2eBackendFailure(revoked.proxy)).toBe('unknown');
  });

  test('classifies before cleanup, tries every broker and sends one immutable strict status', () => {
    const original = { code: 'SQLITE_BUSY', message: 'synthetic-private-startup-error' };
    const calls: string[] = [];
    const sent: ElectronE2eBackendFailureStatus[] = [];
    reportElectronE2eBackendFailure({
      error: original, stage: 'backendStart',
      brokers: {
        secretBroker: { close() {
          calls.push('secretBroker');
          original.code = 'ENOENT';
          throw new Error('synthetic-private-cleanup-error');
        } },
        invoicePdfArchiveBroker: { close() { calls.push('invoicePdfArchiveBroker'); } },
        profileSnapshotBroker: { close() {
          calls.push('profileSnapshotBroker');
          throw new Error('synthetic-private-second-cleanup-error');
        } },
      },
      send(status) { calls.push('send'); sent.push(status); },
    });
    expect(calls).toEqual([...electronE2eBackendBrokers, 'send']);
    expect(sent).toEqual([{
      type: 'failed', stage: 'backendStart', reason: 'SQLITE_BUSY',
      brokerCleanupFailures: ['secretBroker', 'profileSnapshotBroker'],
    }]);
    expect(Object.isFrozen(sent[0])).toBe(true);
    expect(Object.isFrozen(sent[0]?.brokerCleanupFailures)).toBe(true);
    expect(parseElectronE2eBackendStatus(sent[0])).toEqual(sent[0]);
    expect(JSON.stringify(sent)).not.toContain('synthetic-private');
  });

  for (const broker of electronE2eBackendBrokers) {
    test(`isolates ${broker} cleanup failure without skipping any other broker`, () => {
      const calls: string[] = [];
      const sent: ElectronE2eBackendFailureStatus[] = [];
      const close = (name: typeof broker) => () => {
        calls.push(name);
        if (name === broker) throw new Error('synthetic-private-cleanup-error');
      };
      reportElectronE2eBackendFailure({
        error: { code: 'EADDRINUSE' }, stage: 'backendStart',
        brokers: {
          secretBroker: { close: close('secretBroker') },
          invoicePdfArchiveBroker: { close: close('invoicePdfArchiveBroker') },
          profileSnapshotBroker: { close: close('profileSnapshotBroker') },
        },
        send(status) { sent.push(status); },
      });
      expect(calls).toEqual(electronE2eBackendBrokers);
      expect(sent).toEqual([{
        type: 'failed', stage: 'backendStart', reason: 'EADDRINUSE',
        brokerCleanupFailures: [broker],
      }]);
    });
  }

  test('missing brokers are not cleanup failures and unknown remains an explicit reason', () => {
    const sent: ElectronE2eBackendFailureStatus[] = [];
    reportElectronE2eBackendFailure({
      error: new Error('synthetic-private-unknown-error'), stage: 'boundaryValidation',
      brokers: {}, send(status) { sent.push(status); },
    });
    expect(sent).toEqual([{
      type: 'failed', stage: 'boundaryValidation', reason: 'unknown', brokerCleanupFailures: [],
    }]);
    expect(JSON.stringify(sent)).not.toContain('synthetic-private');
  });

  test('send failure cannot escape and replace the original startup failure', () => {
    const original = Object.assign(new Error('synthetic-private-original'), { code: 'ENOENT' });
    const calls: string[] = [];
    const sent: ElectronE2eBackendFailureStatus[] = [];
    const runFailurePath = () => {
      try { throw original; } catch (error) {
        reportElectronE2eBackendFailure({
          error, stage: 'moduleImport',
          brokers: { secretBroker: { close() {
            calls.push('close');
            throw new Error('synthetic-private-cleanup');
          } } },
          send(status) {
            calls.push('send');
            sent.push(status);
            throw new Error('synthetic-private-send');
          },
        });
        throw error;
      }
    };
    let caught: unknown;
    try { runFailurePath(); } catch (error) { caught = error; }
    expect(caught).toBe(original);
    expect(calls).toEqual(['close', 'send']);
    expect(sent).toEqual([{
      type: 'failed', stage: 'moduleImport', reason: 'ENOENT', brokerCleanupFailures: ['secretBroker'],
    }]);
    expect(JSON.stringify(sent)).not.toContain('synthetic-private');
  });
});
