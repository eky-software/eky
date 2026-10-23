import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { IncidentIndexDesktopLogFailureSink } from '../observability/infrastructure/incidentIndexDesktopLogFailureSink.js';
import { getOperationalLogFailureStatusIpcChannel, operationalLogFailureObservedIpcChannel } from './desktopDiagnosticsTypes.js';
import { createOperationalLogFailureCapability } from './operationalLogFailureCapability.js';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe('operational log failure capability', () => {
  it('returns only the retained snapshot and sends one value-free notification', () => {
    const f = fixture();
    expect(f.invoke(f.event)).toEqual({ failureObserved: false });
    f.sink.recordFailure({ errorCode: 'LOG_WRITE_FAILED', stream: 'desktop-info' });
    f.sink.recordFailure({ errorCode: 'LOG_CAPACITY_REACHED', stream: 'desktop-security' });
    expect(f.invoke(f.event)).toEqual({ failureObserved: true });
    expect(f.send).toHaveBeenCalledExactlyOnceWith(operationalLogFailureObservedIpcChannel);
    f.capability.dispose();
    expect(f.removeHandler).toHaveBeenLastCalledWith(getOperationalLogFailureStatusIpcChannel);
    expect(() => f.invoke(f.event)).toThrow('OPERATIONAL_LOG_FAILURE_STATUS_FORBIDDEN');
  });

  it.each(['otherWindow', 'subframe', 'destroyed', 'argument'] as const)('rejects %s', invalid => {
    const f = fixture();
    if (invalid === 'destroyed') f.isDestroyed.mockReturnValue(true);
    const event = { ...f.event,
      ...(invalid === 'otherWindow' ? { sender: {} } : {}),
      ...(invalid === 'subframe' ? { senderFrame: {} } : {}),
    };
    expect(() => f.invoke(event, ...(invalid === 'argument' ? [undefined] : [])))
      .toThrow('OPERATIONAL_LOG_FAILURE_STATUS_FORBIDDEN');
    expect(f.send).not.toHaveBeenCalled();
    f.capability.dispose();
  });

  it('keeps the startup failure available when no renderer was subscribed', () => {
    const f = fixture(true);
    expect(f.invoke(f.event)).toEqual({ failureObserved: true });
    expect(f.send).not.toHaveBeenCalled();
    f.capability.dispose();
  });

  it('contains a send failure and retains the true snapshot without retries', () => {
    const f = fixture();
    f.send.mockImplementation(() => { throw new Error('synthetic private send failure'); });
    expect(() => f.sink.recordFailure({ errorCode: 'LOG_WRITE_FAILED', stream: 'desktop-info' })).not.toThrow();
    expect(f.invoke(f.event)).toEqual({ failureObserved: true });
    f.sink.recordFailure({ errorCode: 'LOG_WRITE_FAILED', stream: 'desktop-info' });
    expect(f.send).toHaveBeenCalledOnce();
    f.capability.dispose();
    f.capability.dispose();
  });
});

function fixture(failedBeforeWindow = false) {
  const root = mkdtempSync(join(tmpdir(), 'eky-h5-capability-'));
  roots.push(root);
  const sink = new IncidentIndexDesktopLogFailureSink({ logsRoot: root, operationalIdentity: {
    appVersion: '0.0.0', buildRevision: 'development', runtimeInstanceId: '11111111-1111-4111-8111-111111111111',
  } });
  if (failedBeforeWindow) sink.recordFailure({ errorCode: 'LOG_WRITE_FAILED', stream: 'desktop-info' });
  let invoke!: (event: unknown, ...args: unknown[]) => unknown;
  const handle = vi.fn((channel: string, handler: typeof invoke) => {
    expect(channel).toBe(getOperationalLogFailureStatusIpcChannel);
    invoke = handler;
  });
  const send = vi.fn();
  const mainFrame = {};
  const webContents = { mainFrame, send, isDestroyed: () => false };
  const isDestroyed = vi.fn(() => false);
  const removeHandler = vi.fn();
  const capability = createOperationalLogFailureCapability({
    ipcMain: { handle, removeHandler } as never,
    mainWindow: { webContents, isDestroyed } as never,
    failureSink: sink,
  });
  return { sink, invoke, send, removeHandler, isDestroyed, capability,
    event: { sender: webContents, senderFrame: mainFrame } };
}
