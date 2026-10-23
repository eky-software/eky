import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, truncateSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createDesktopOperationalEvent } from '../createDesktopOperationalEvent.js';
import { IncidentIndexDesktopLogFailureSink } from './incidentIndexDesktopLogFailureSink.js';
import { JsonLineDesktopOperationalLogger } from './jsonLineDesktopOperationalLogger.js';

const roots: string[] = [];
const identity = { appVersion: '0.0.0', buildRevision: 'development',
  runtimeInstanceId: '11111111-1111-4111-8111-111111111111' };
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe('IncidentIndexDesktopLogFailureSink', () => {
  it('records the real info-writer failure without changing its caller result', () => {
    const { root, sink, logger, notice } = fixture();
    writeFileSync(join(root, 'desktop'), 'synthetic obstruction');
    const businessResult = () => {
      logger.write(createDesktopOperationalEvent({ eventName: 'desktop.started' }, identity));
      return 'completed';
    };
    expect(businessResult()).toBe('completed');
    expect(businessResult()).toBe('completed');
    expect(sink.failureObserved).toBe(true);
    expect(notice).toHaveBeenCalledOnce();
    expect(readIncidents(root)).toEqual([expect.objectContaining({ component: 'desktop',
      errorCode: 'LOG_WRITE_FAILED', eventName: 'operationalLog.writeFailed',
      fingerprint: 'LOG_WRITE_FAILED:desktop-info', outcome: 'failure' })]);
    expect(readFileSync(join(root, 'desktop'), 'utf8')).toBe('synthetic obstruction');
  });

  it('keeps all six code/stream combinations bounded and only notifies once', () => {
    const { root, sink, notice } = fixture();
    for (const errorCode of ['LOG_WRITE_FAILED', 'LOG_CAPACITY_REACHED'] as const) {
      for (const stream of ['desktop-info', 'desktop-warning-error', 'desktop-security'] as const) {
        for (let repeat = 0; repeat < 3; repeat++) sink.recordFailure({ errorCode, stream });
      }
    }
    expect(readIncidents(root)).toHaveLength(6);
    expect(notice).toHaveBeenCalledOnce();
    expect(JSON.stringify(readIncidents(root))).not.toContain(identity.runtimeInstanceId);
    for (const entry of readIncidents(root)) {
      expect(Object.keys(entry).sort()).toEqual(['appVersion', 'buildRevision', 'component',
        'errorCode', 'eventName', 'fingerprint', 'outcome', 'schemaVersion', 'timestamp']);
    }
  });

  it('reports actual capacity without overwriting the existing segments', () => {
    const { root, sink, logger, notice } = fixture();
    mkdirSync(join(root, 'desktop'));
    const month = new Date().toISOString().slice(0, 7);
    for (const segment of ['001', '002', '003', '004']) {
      const file = join(root, 'desktop', `desktop-info-${month}-${segment}.jsonl`);
      writeFileSync(file, '');
      truncateSync(file, 5 * 1024 * 1024);
    }
    expect(() => logger.write(createDesktopOperationalEvent({ eventName: 'desktop.started' }, identity)))
      .not.toThrow();
    expect(sink.failureObserved).toBe(true);
    expect(notice).toHaveBeenCalledOnce();
    expect(readIncidents(root)[0]).toMatchObject({ errorCode: 'LOG_CAPACITY_REACHED',
      eventName: 'operationalLog.capacityReached' });
    expect(existsSync(join(root, 'desktop', `desktop-info-${month}-005.jsonl`))).toBe(false);
  });

  it('retains a failure when the same-disk fallback and notification both fail', () => {
    const { root, sink, logger, notice } = fixture();
    writeFileSync(join(root, 'desktop'), 'synthetic obstruction');
    writeFileSync(join(root, 'incident-index'), 'preserved evidence');
    notice.mockImplementation(() => { throw new Error('synthetic private notification failure'); });
    expect(() => logger.write(createDesktopOperationalEvent({ eventName: 'desktop.started' }, identity)))
      .not.toThrow();
    expect(sink.failureObserved).toBe(true);
    expect(notice).toHaveBeenCalledOnce();
    expect(readFileSync(join(root, 'incident-index'), 'utf8')).toBe('preserved evidence');
  });

  it('does not notify for normal logging and starts a new process scope empty', () => {
    const { root, logger, sink, notice } = fixture();
    logger.write(createDesktopOperationalEvent({ eventName: 'desktop.started' }, identity));
    expect(sink.failureObserved).toBe(false);
    expect(notice).not.toHaveBeenCalled();
    sink.recordFailure({ errorCode: 'LOG_WRITE_FAILED', stream: 'desktop-info' });
    expect(new IncidentIndexDesktopLogFailureSink({ logsRoot: root, operationalIdentity: identity }).failureObserved)
      .toBe(false);
  });

  it('removes only the owned listener and avoids same-failure reentry', () => {
    const { sink, notice } = fixture();
    const removeOld = sink.subscribe(notice);
    const current = vi.fn(() => sink.recordFailure({ errorCode: 'LOG_WRITE_FAILED', stream: 'desktop-info' }));
    const removeCurrent = sink.subscribe(current);
    removeOld();
    sink.recordFailure({ errorCode: 'LOG_WRITE_FAILED', stream: 'desktop-info' });
    expect(current).toHaveBeenCalledOnce();
    expect(notice).not.toHaveBeenCalled();
    removeCurrent();
    sink.recordFailure({ errorCode: 'LOG_CAPACITY_REACHED', stream: 'desktop-info' });
    expect(current).toHaveBeenCalledOnce();
  });
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'eky-h5-log-failure-'));
  roots.push(root);
  const sink = new IncidentIndexDesktopLogFailureSink({ logsRoot: root, operationalIdentity: identity });
  const notice = vi.fn();
  sink.subscribe(notice);
  const logger = new JsonLineDesktopOperationalLogger({ logsRoot: root, failureSink: sink });
  return { root, sink, notice, logger };
}

function readIncidents(root: string): Record<string, unknown>[] {
  return readFileSync(join(root, 'incident-index',
    `desktop-incident-index-${new Date().getUTCFullYear()}.jsonl`), 'utf8').trim().split('\n')
    .map(line => JSON.parse(line) as Record<string, unknown>);
}
