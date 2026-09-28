import { describe, expect, it, vi } from 'vitest';

import { createBackendOperationalEvent } from '../src/observability/createOperationalEvent.js';
import type { BackendOperationalEvent } from '../src/observability/operationalEvent.js';
import type { OperationalLogger } from '../src/observability/operationalLogger.js';
import { observeE2eStartupLogs, type E2eStartupLogStage } from './e2eStartupLogObserver.js';

const identity = {
  appVersion: '0.0.0-e2e',
  buildRevision: 'development',
  runtimeInstanceId: '11111111-1111-4111-8111-111111111111',
};
const events = [
  createBackendOperationalEvent({ eventName: 'migration.started', stage: 'startup' }, identity),
  createBackendOperationalEvent({ eventName: 'migration.completed', durationMs: 17 }, identity),
  createBackendOperationalEvent({
    eventName: 'migration.failed', completedMigrationCount: 2,
    errorCode: 'SYNTHETIC_MIGRATION_FAILED', failureStage: 'migrationExecution',
    sideEffectState: 'unknown', durationMs: 19,
  }, identity),
] as const;

describe('E2E startup log observer', () => {
  it('returns the original logger unchanged when no observer is supplied', () => {
    const delegate = { write: vi.fn() };
    expect(observeE2eStartupLogs(delegate)).toBe(delegate);
  });

  for (const event of events) {
    it(`observes only the write boundary for ${event.eventName}`, () => {
      const stages: E2eStartupLogStage[] = [];
      const delegate = {
        write: vi.fn(function (this: OperationalLogger, received: BackendOperationalEvent) {
          expect(this).toBe(delegate);
          expect(received).toBe(event);
          expect(stages).toEqual([`${event.eventName}.log.entered`]);
        }),
      };
      observeE2eStartupLogs(delegate, (stage) => stages.push(stage)).write(event);
      expect(delegate.write).toHaveBeenCalledExactlyOnceWith(event);
      expect(stages).toEqual([
        `${event.eventName}.log.entered`, `${event.eventName}.log.returned`,
      ]);
    });

    it(`preserves the exact thrown value and receiver for ${event.eventName}`, () => {
      for (const original of [new Error('synthetic private failure'), { code: 'PRIVATE_CODE' }, undefined]) {
        const stages: E2eStartupLogStage[] = [];
        const delegate = {
          write: vi.fn(function (this: OperationalLogger, received: BackendOperationalEvent) {
            expect(this).toBe(delegate);
            expect(received).toBe(event);
            expect(stages).toEqual([`${event.eventName}.log.entered`]);
            throw original;
          }),
        };
        let threw = false;
        try {
          observeE2eStartupLogs(delegate, (stage) => stages.push(stage)).write(event);
        } catch (error) {
          threw = true;
          expect(error).toBe(original);
        }
        expect(threw).toBe(true);
        expect(delegate.write).toHaveBeenCalledExactlyOnceWith(event);
        expect(stages).toEqual([
          `${event.eventName}.log.entered`, `${event.eventName}.log.threw`,
        ]);
      }
    });
  }

  it('ignores observer exceptions at entered, returned and threw', () => {
    const event = events[0];
    const original = new Error('synthetic original logger failure');
    for (const fails of [false, true]) {
      const delegate = { write: vi.fn(() => { if (fails) throw original; }) };
      const observer = vi.fn(() => { throw new Error('synthetic observer failure'); });
      const logger = observeE2eStartupLogs(delegate, observer);
      if (fails) {
        let caught: unknown;
        try { logger.write(event); } catch (error) { caught = error; }
        expect(caught).toBe(original);
      } else {
        expect(() => logger.write(event)).not.toThrow();
      }
      expect(delegate.write).toHaveBeenCalledExactlyOnceWith(event);
      expect(observer.mock.calls).toEqual([
        ['migration.started.log.entered'],
        [fails ? 'migration.started.log.threw' : 'migration.started.log.returned'],
      ]);
    }
  });

  it('does not read or expose event payloads, identity, codes or error data', () => {
    const forbiddenRead = vi.fn(() => { throw new Error('private field must not be read'); });
    const event = { ...events[2] };
    for (const key of ['errorCode', 'data', 'runtimeInstanceId', 'durationMs', 'failureStage']) {
      Object.defineProperty(event, key, { get: forbiddenRead });
    }
    const delegate = { write: vi.fn() };
    const observer = vi.fn();
    observeE2eStartupLogs(delegate, observer).write(event);
    expect(forbiddenRead).not.toHaveBeenCalled();
    expect(delegate.write.mock.calls[0]?.[0]).toBe(event);
    expect(observer.mock.calls).toEqual([
      ['migration.failed.log.entered'], ['migration.failed.log.returned'],
    ]);
  });

  it('delegates unselected events without observations, including failures', () => {
    const event = createBackendOperationalEvent({ eventName: 'database.opened' }, identity);
    const observer = vi.fn();
    const original = new Error('synthetic unselected failure');
    for (const fails of [false, true]) {
      const delegate = { write: vi.fn(function (this: OperationalLogger, received: BackendOperationalEvent) {
        expect(this).toBe(delegate);
        expect(received).toBe(event);
        if (fails) throw original;
      }) };
      const logger = observeE2eStartupLogs(delegate, observer);
      if (fails) {
        let caught: unknown;
        try { logger.write(event); } catch (error) { caught = error; }
        expect(caught).toBe(original);
      } else {
        expect(() => logger.write(event)).not.toThrow();
      }
      expect(delegate.write).toHaveBeenCalledExactlyOnceWith(event);
    }
    expect(observer).not.toHaveBeenCalled();
  });
});
