import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';

import { createWorkspaceManagementCapability } from './workspaceManagementCapability.js';
import { WorkspaceManagementError } from './workspaceManagementError.js';
import type { WorkspaceRecoveryManagementStatusV2 } from './workspaceManagementTypes.js';
import { validateWorkspaceId } from '../registry/workspaceIdValidation.js';
import {
  createEmptyWorkspaceIpcChannel,
  getWorkspaceManagementStatusIpcChannel,
  workspaceManagementIpcChannels,
} from './workspaceManagementCapabilityProtocol.js';

const workspaceId = validateWorkspaceId('11111111-1111-4111-8111-111111111111');
const idle = Object.freeze({ formatVersion: 2 as const, mode: 'recoveryManagement' as const,
  runtimeState: 'absent' as const, maintenanceState: 'idle' as const, operationState: 'idle' as const,
  persistedActiveWorkspaceId: null, target: Object.freeze({ workspaceId, workspaceLabel: 'Synthetic company' }) });

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

function fixture(read: () => Promise<Readonly<{ value: WorkspaceRecoveryManagementStatusV2; assertCurrent(): void }>> =
  vi.fn(async () => Object.freeze({ value: idle, assertCurrent() {} }))) {
  const handlers = new Map<string, (event: unknown, ...args: unknown[]) => Promise<unknown>>();
  const frame = {};
  const webContents = Object.assign(new EventEmitter(), { mainFrame: frame, isDestroyed: () => false });
  const mainWindow = Object.assign(new EventEmitter(), { webContents, isDestroyed: () => false });
  let publicationCurrent = true;
  const captureStatusPublication = vi.fn(() => Object.freeze({ assertCurrent() {
    if (!publicationCurrent) throw new WorkspaceManagementError('WORKSPACE_MANAGEMENT_RECOVERY_REQUIRED', 'status');
  } }));
  const getStatus = vi.fn(async () => { throw new Error('ORDINARY_STATUS_FORBIDDEN'); });
  const capability = createWorkspaceManagementCapability({
    ipcMain: { handle: (channel: string, handler: (event: unknown, ...args: unknown[]) => Promise<unknown>) => {
      handlers.set(channel, handler);
    }, removeHandler: (channel: string) => { handlers.delete(channel); } } as never,
    mainWindow: mainWindow as never,
    passwordWindow: { requestPassword: async () => null },
    service: { getStatus, getRecoveryManagementStatus: read } as never,
    statusMode: 'recoveryManagement', captureStatusPublication,
    confirmActiveWorkspaceReplacement: async () => false,
    selectBackupSource: async () => null,
    selectReplacementBackupSource: async () => null,
    showSafeError: vi.fn(),
  });
  const event = { sender: webContents, senderFrame: frame };
  const invoke = (requestEvent: unknown = event, ...args: unknown[]) => {
    const handler = handlers.get(getWorkspaceManagementStatusIpcChannel);
    if (handler === undefined) throw new Error('STATUS_HANDLER_MISSING');
    return handler(requestEvent, ...args);
  };
  return { capability, captureStatusPublication, getStatus, handlers, invoke, mainWindow, read,
    revokePublication() { publicationCurrent = false; }, webContents };
}

describe('restricted workspace management status capability', () => {
  it('requires both the restricted service reader and main publication guard', () => {
    const options = { ipcMain: { handle() {}, removeHandler() {} },
      mainWindow: {} as never, passwordWindow: {} as never,
      service: { getStatus: async () => idle } as never, statusMode: 'recoveryManagement' as const,
      confirmActiveWorkspaceReplacement: async () => false, selectBackupSource: async () => null,
      selectReplacementBackupSource: async () => null, showSafeError() {} };
    expect(() => createWorkspaceManagementCapability(options as never)).toThrow('WORKSPACE_MANAGEMENT_CAPABILITY_INVALID');
    expect(() => createWorkspaceManagementCapability({ ...options, statusMode: 'unexpected' } as never))
      .toThrow('WORKSPACE_MANAGEMENT_CAPABILITY_INVALID');
  });

  it('publishes only the strict v2 projection on the existing status channel', async () => {
    const f = fixture();
    try {
      expect([...f.handlers.keys()]).toEqual([getWorkspaceManagementStatusIpcChannel]);
      expect(f.handlers.has(createEmptyWorkspaceIpcChannel)).toBe(false);
      expect(workspaceManagementIpcChannels).toHaveLength(7);
      await expect(f.invoke()).resolves.toEqual(idle);
      expect(f.getStatus).not.toHaveBeenCalled();
      expect(f.read).toHaveBeenCalledOnce();
      await expect(f.invoke({ sender: {}, senderFrame: f.webContents.mainFrame }))
        .rejects.toThrow('WORKSPACE_MANAGEMENT_CAPABILITY_FORBIDDEN');
      await expect(f.invoke(undefined, { mode: 'recoveryManagement' }))
        .rejects.toThrow('WORKSPACE_MANAGEMENT_CAPABILITY_FORBIDDEN');
    } finally { await f.capability.shutdown(); }
  });

  it('keeps a target-free recovery-required projection target-free', async () => {
    const value = Object.freeze({ formatVersion: 2, mode: 'recoveryManagement', runtimeState: 'absent',
      maintenanceState: 'idle', operationState: 'recoveryRequired' });
    const f = fixture(vi.fn(async () => Object.freeze({ value, assertCurrent() {} })));
    try {
      await expect(f.invoke()).resolves.toEqual(value);
      expect(f.handlers.has(createEmptyWorkspaceIpcChannel)).toBe(false);
    } finally { await f.capability.shutdown(); }
  });

  it('rejects a completed read after the main publication generation changes', async () => {
    const held = deferred<Readonly<{ value: typeof idle; assertCurrent(): void }>>();
    const f = fixture(vi.fn(() => held.promise));
    try {
      const result = f.invoke();
      f.revokePublication();
      held.resolve(Object.freeze({ value: idle, assertCurrent() {} }));
      await expect(result).rejects.toThrow('WORKSPACE_MANAGEMENT_RECOVERY_REQUIRED');
      expect(f.captureStatusPublication).toHaveBeenCalledOnce();
    } finally { await f.capability.shutdown(); }
  });

  it('rechecks the service observation at the final publication boundary', async () => {
    let checks = 0;
    const f = fixture(vi.fn(async () => Object.freeze({ value: idle, assertCurrent() {
      if (++checks === 2) throw new WorkspaceManagementError('WORKSPACE_MANAGEMENT_RECOVERY_REQUIRED', 'status');
    } })));
    try {
      await expect(f.invoke()).rejects.toThrow('WORKSPACE_MANAGEMENT_RECOVERY_REQUIRED');
      expect(checks).toBe(2);
    } finally { await f.capability.shutdown(); }
  });

  it('joins the owned status read on shutdown and never publishes its late reply', async () => {
    const held = deferred<Readonly<{ value: typeof idle; assertCurrent(): void }>>();
    const f = fixture(vi.fn(() => held.promise));
    const result = f.invoke();
    let stopped = false;
    const stopping = f.capability.shutdown().then(() => { stopped = true; });
    await new Promise<void>(resolve => setImmediate(resolve));
    expect(stopped).toBe(false);
    held.resolve(Object.freeze({ value: idle, assertCurrent() {} }));
    await expect(result).rejects.toThrow('WORKSPACE_MANAGEMENT_CAPABILITY_FORBIDDEN');
    await stopping;
    expect(stopped).toBe(true);
  });
});
