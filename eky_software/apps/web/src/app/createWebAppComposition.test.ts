import { afterEach, describe, expect, it, vi } from 'vitest';

import { createWebAppComposition } from './createWebAppComposition.js';
import type { EkyDesktopApi } from './desktopBridge.js';

const mocks = vi.hoisted(() => ({ createApiClient: vi.fn(() => ({})) }));
vi.mock('@eky/api-client', () => ({ createEkyApiClient: mocks.createApiClient }));

afterEach(() => vi.clearAllMocks());

describe('createWebAppComposition', () => {
  it('selects the existing strict recovery response without creating a business API client', async () => {
    const recovery = { formatVersion: 2, mode: 'recoveryManagement', runtimeState: 'absent',
      operationState: 'idle', maintenanceState: 'idle', persistedActiveWorkspaceId: null,
      target: { workspaceId: '11111111-1111-4111-8111-111111111111', workspaceLabel: 'Synthetic target' } };
    const desktop = { ...createDesktop(), getWorkspaceManagementStatus: vi.fn(async () => recovery) };
    const composition = createWebAppComposition(target('eky://app/index.html#workspace-selector', desktop));
    if (composition.mode !== 'workspaceSelector') throw new Error('Wrong mode');
    await expect(composition.workspaceManagementCapability!.getStatus()).resolves.toEqual(recovery);
    expect(composition).not.toHaveProperty('apiClient');
    expect(mocks.createApiClient).not.toHaveBeenCalled();
  });

  it('selects the backendless presentation before creating a business API client', async () => {
    const desktop = createDesktop();
    const composition = createWebAppComposition(target(
      'eky://app/index.html#workspace-selector', desktop,
    ));

    expect(composition.mode).toBe('workspaceSelector');
    expect(composition).not.toHaveProperty('apiClient');
    expect(mocks.createApiClient).not.toHaveBeenCalled();
    expect(desktop.getWorkspaceManagementStatus).not.toHaveBeenCalled();
    if (composition.mode !== 'workspaceSelector') throw new Error('Wrong mode');
    const capability = composition.workspaceManagementCapability!;
    expect(Object.keys(capability).sort()).toEqual([
      'createEmpty', 'getStatus', 'importBackupAsNew', 'rename', 'switchTo',
    ]);
    await expect(capability.getStatus()).resolves.toEqual({
      activeWorkspaceId: null, formatVersion: 1, operationState: 'idle', workspaces: [],
    });
    await expect(capability.createEmpty('Company')).resolves.toBe('completed');
    await expect(capability.importBackupAsNew('Imported')).resolves.toBe('cancelled');
    const workspaceId = '11111111-1111-4111-8111-111111111111';
    await expect(capability.rename(workspaceId, 'Renamed')).resolves.toBe('completed');
    await expect(capability.switchTo(workspaceId)).resolves.toBe('relaunching');
    expect(desktop.createEmptyWorkspace).toHaveBeenCalledWith({ workspaceLabel: 'Company' });
    expect(desktop.importWorkspaceBackupAsNew).toHaveBeenCalledWith({ workspaceLabel: 'Imported' });
    expect(desktop.renameWorkspace).toHaveBeenCalledWith({ workspaceId, workspaceLabel: 'Renamed' });
    expect(desktop.switchWorkspace).toHaveBeenCalledWith({ workspaceId });
    expect(desktop.replaceActiveWorkspaceFromBackup).not.toHaveBeenCalled();
  });

  it('keeps the selector presentation without inventing a missing capability', () => {
    expect(createWebAppComposition(target('eky://app/index.html#workspace-selector')))
      .toEqual({ mode: 'workspaceSelector', workspaceManagementCapability: undefined });
    expect(mocks.createApiClient).not.toHaveBeenCalled();
  });

  it('preserves the optional validated deletion command in the backendless composition', async () => {
    const result = { formatVersion: 1, status: 'cancelled', nextAction: 'continue' };
    const desktop = { ...createDesktop(), deleteWorkspace: vi.fn(async (_request: unknown) => result) };
    const composition = createWebAppComposition(target('eky://app/index.html#workspace-selector', desktop));
    if (composition.mode !== 'workspaceSelector') throw new Error('Wrong mode');
    const request = { formatVersion: 1 as const, workspaceId: '11111111-1111-4111-8111-111111111111',
      typedLabel: 'Synthetic company', backupChoice: 'explicitDataLoss' as const };
    await expect(composition.workspaceManagementCapability?.deleteWorkspace?.(request)).resolves.toEqual(result);
    expect(desktop.deleteWorkspace).toHaveBeenCalledExactlyOnceWith(request);
    expect(composition.workspaceManagementCapability).not.toHaveProperty('replaceActiveFromBackup');
    expect(mocks.createApiClient).not.toHaveBeenCalled();
  });

  it('captures only the existing support command without starting it in the selector', async () => {
    const desktop = { ...createDesktop(), createSupportBundle: vi.fn(async () => 'created' as const) };
    const composition = createWebAppComposition(target('eky://app/index.html#workspace-selector', desktop));
    expect(composition.mode).toBe('workspaceSelector');
    if (composition.mode !== 'workspaceSelector') throw new Error('Wrong mode');
    expect(composition.createSupportBundle).toBeTypeOf('function');
    expect(desktop.createSupportBundle).not.toHaveBeenCalled();
    await expect(composition.createSupportBundle!()).resolves.toBe('created');
    expect(desktop.createSupportBundle).toHaveBeenCalledExactlyOnceWith();
    expect(mocks.createApiClient).not.toHaveBeenCalled();
  });

  it('does not read a support command without the complete workspace capability', () => {
    const readSupport = vi.fn(() => { throw new Error('Forbidden support capability read'); });
    const desktop = Object.defineProperty({}, 'createSupportBundle', { get: readSupport });
    const composition = createWebAppComposition(target('eky://app/index.html#workspace-selector',
      desktop as ReturnType<typeof createDesktop>));
    expect(composition).not.toHaveProperty('createSupportBundle');
    expect(readSupport).not.toHaveBeenCalled();
    expect(mocks.createApiClient).not.toHaveBeenCalled();
  });

  it('does not inspect selector support in the browser business composition', () => {
    const readSupport = vi.fn(() => { throw new Error('Forbidden selector capability read'); });
    const desktop = Object.defineProperty(createDesktop(), 'createSupportBundle', { get: readSupport });
    expect(createWebAppComposition(target('http://127.0.0.1:5173/', desktop)).mode).toBe('business');
    expect(readSupport).not.toHaveBeenCalled();
  });

  it('rejects an incomplete desktop bridge without constructing a business fallback', () => {
    const composition = createWebAppComposition({
      location: { href: 'eky://app/index.html#workspace-selector' } as Location,
      ekyDesktop: { getWorkspaceManagementStatus: vi.fn() } as unknown as EkyDesktopApi,
    });
    expect(composition).toEqual({
      mode: 'workspaceSelector', workspaceManagementCapability: undefined,
    });
    expect(mocks.createApiClient).not.toHaveBeenCalled();
  });

  it.each([
    'eky://app/index.html',
    'eky://app/index.html#other',
    'http://127.0.0.1:5173/',
    'http://127.0.0.1:5173/#workspace-selector',
    'eky://app/index.html?workspace-selector',
    'eky://app/index.html#workspace-selector/other',
    'eky://other/index.html#workspace-selector',
  ])('preserves normal business composition at %s', (href) => {
    const composition = createWebAppComposition(target(href));
    expect(composition.mode).toBe('business');
    expect(composition).toHaveProperty('apiClient');
    expect(mocks.createApiClient).toHaveBeenCalledOnce();
  });
});

function target(href: string, desktop?: Pick<EkyDesktopApi,
  'createEmptyWorkspace' | 'getWorkspaceManagementStatus' | 'importWorkspaceBackupAsNew' |
  'renameWorkspace' | 'switchWorkspace' | 'replaceActiveWorkspaceFromBackup'>) {
  return {
    location: { href } as Location,
    ...(desktop === undefined ? {} : { ekyDesktop: desktop as unknown as EkyDesktopApi }),
  };
}

function createDesktop() {
  return {
    createEmptyWorkspace: vi.fn(async () => ({ formatVersion: 1, status: 'completed' })),
    getWorkspaceManagementStatus: vi.fn(async () => ({
      activeWorkspaceId: null, formatVersion: 1, operationState: 'idle', workspaces: [],
    })),
    importWorkspaceBackupAsNew: vi.fn(async () => ({ formatVersion: 1, status: 'cancelled' })),
    renameWorkspace: vi.fn(async () => ({ formatVersion: 1, status: 'completed' })),
    switchWorkspace: vi.fn(async () => ({ formatVersion: 1, status: 'relaunching' })),
    replaceActiveWorkspaceFromBackup: vi.fn(),
  };
}
