import { readFile } from 'node:fs/promises';
import { Script } from 'node:vm';
import { ModuleKind, ScriptTarget, transpileModule } from 'typescript';
import { describe, expect, it, vi } from 'vitest';

import {
  createWorkspaceOperationResult,
  deleteWorkspaceIpcChannel,
  parseWorkspaceIdRequest,
  parseWorkspaceDeletionRequest,
  parseWorkspaceDeletionOperationResult,
  parseWorkspaceLabelRequest,
  parseWorkspaceRenameRequest,
  parseWorkspaceRecoveryStatusResult,
  parseWorkspaceStatusResult,
  workspaceManagementCapabilityProtocolVersion,
  workspaceManagementIpcChannels,
} from './workspaceManagementCapabilityProtocol.js';

const workspaceId = '11111111-1111-4111-8111-111111111111';

describe('workspace management capability protocol', () => {
  it('selects the recovery status parser without widening the v1 shape', () => {
    const recovery = {
      formatVersion: 2,
      mode: 'recoveryManagement',
      runtimeState: 'absent',
      maintenanceState: 'idle',
      operationState: 'idle',
      persistedActiveWorkspaceId: workspaceId,
      target: { workspaceId, workspaceLabel: 'Synthetic company' },
    };
    expect(parseWorkspaceRecoveryStatusResult(recovery)).toEqual(recovery);
    expect(() => parseWorkspaceStatusResult(recovery)).toThrow('WORKSPACE_MANAGEMENT_CAPABILITY_INVALID');
    expect(() => parseWorkspaceRecoveryStatusResult({ ...recovery, journal: 'private' }))
      .toThrow('WORKSPACE_MANAGEMENT_CAPABILITY_INVALID');
    expect(() => parseWorkspaceRecoveryStatusResult({ formatVersion: 2, mode: 'recoveryManagement',
      runtimeState: 'absent', maintenanceState: 'idle', operationState: 'recoveryRequired' }))
      .not.toThrow();
  });

  it('uses one explicit protocol version and unique versioned channels', () => {
    expect(workspaceManagementCapabilityProtocolVersion).toBe(1);
    expect(new Set(workspaceManagementIpcChannels).size).toBe(7);
    expect(workspaceManagementIpcChannels).toHaveLength(7);
    expect(workspaceManagementIpcChannels).toContain(deleteWorkspaceIpcChannel);
    for (const channel of workspaceManagementIpcChannels) {
      expect(channel).toContain(':v1:');
    }
  });

  it('exposes only the fixed deletion command through the actual isolated preload', async () => {
    const source = await readFile(new URL('../../preload/index.cts', import.meta.url), 'utf8');
    const { outputText } = transpileModule(source, { compilerOptions: {
      module: ModuleKind.CommonJS, target: ScriptTarget.ES2022,
    }, fileName: 'index.cts' });
    const result = Object.freeze({ formatVersion: 1, status: 'cancelled', nextAction: 'continue' });
    const invoke = vi.fn(async () => result);
    let api!: { deleteWorkspace(input: unknown): Promise<unknown> };
    new Script(outputText).runInNewContext({ exports: {}, require(specifier: string) {
      expect(specifier).toBe('electron');
      return { contextBridge: { exposeInMainWorld(name: string, value: typeof api) {
        expect(name).toBe('ekyDesktop'); api = value;
      } }, ipcRenderer: { invoke } };
    } });
    const request = { formatVersion: 1, workspaceId, typedLabel: 'Synthetic company', backupChoice: 'explicitDataLoss' };
    await expect(api.deleteWorkspace(request)).resolves.toBe(result);
    expect(invoke).toHaveBeenCalledExactlyOnceWith(deleteWorkspaceIpcChannel, request);
    expect(Object.isFrozen(api)).toBe(true);
    expect(api).not.toHaveProperty('prepareDeletion');
    expect(api).not.toHaveProperty('ipcRenderer');
  });

  it('accepts only exact workspace label requests', () => {
    expect(parseWorkspaceLabelRequest({ workspaceLabel: 'Oma yritys Oy' })).toEqual({
      workspaceLabel: 'Oma yritys Oy',
    });
    expect(() => parseWorkspaceLabelRequest({ workspaceLabel: '  nimi  ' })).toThrow(
      'WORKSPACE_MANAGEMENT_CAPABILITY_INVALID',
    );
    expect(() =>
      parseWorkspaceLabelRequest({ path: 'C:\\private', workspaceLabel: 'Nimi' }),
    ).toThrow('WORKSPACE_MANAGEMENT_CAPABILITY_INVALID');
  });

  it('accepts only canonical identifiers and exact rename requests', () => {
    expect(parseWorkspaceIdRequest({ workspaceId })).toEqual({ workspaceId });
    expect(
      parseWorkspaceRenameRequest({
        workspaceId,
        workspaceLabel: 'Uusi nimi',
      }),
    ).toEqual({ workspaceId, workspaceLabel: 'Uusi nimi' });
    expect(() => parseWorkspaceIdRequest({ workspaceId: 'invalid' })).toThrow(
      'WORKSPACE_MANAGEMENT_CAPABILITY_INVALID',
    );
    expect(() =>
      parseWorkspaceRenameRequest({
        journal: 'renderer-owned',
        workspaceId,
        workspaceLabel: 'Uusi nimi',
      }),
    ).toThrow('WORKSPACE_MANAGEMENT_CAPABILITY_INVALID');
  });

  it('returns only the versioned allowlisted operation result', () => {
    expect(createWorkspaceOperationResult('completed')).toEqual({
      formatVersion: 1,
      status: 'completed',
    });
    expect(Object.isFrozen(createWorkspaceOperationResult('cancelled'))).toBe(true);
  });

  it.each(['createBackup', 'explicitDataLoss'] as const)(
    'captures an immutable exact deletion request with %s', backupChoice => {
      const input = { formatVersion: 1, workspaceId, typedLabel: 'Oma yritys Oy', backupChoice };
      const parsed = parseWorkspaceDeletionRequest(input);
      expect(parsed).toEqual(input);
      expect(Object.isFrozen(parsed)).toBe(true);
      input.typedLabel = 'Changed later';
      expect(parsed.typedLabel).toBe('Oma yritys Oy');
    },
  );

  it.each([
    null,
    { workspaceId },
    { formatVersion: 2, workspaceId, typedLabel: 'Name', backupChoice: 'createBackup' },
    { formatVersion: 1, workspaceId: 'invalid', typedLabel: 'Name', backupChoice: 'createBackup' },
    { formatVersion: 1, workspaceId, typedLabel: ' Name ', backupChoice: 'createBackup' },
    { formatVersion: 1, workspaceId, typedLabel: 'Name', backupChoice: 'latestBackup' },
    { formatVersion: 1, workspaceId, typedLabel: 'Name', backupChoice: 'createBackup', backupVerified: true },
    { formatVersion: 1, workspaceId, typedLabel: 'Name', backupChoice: 'createBackup', path: 'untrusted' },
    { formatVersion: 1, workspaceId, typedLabel: 'Name', backupChoice: 'createBackup', password: 'untrusted' },
  ])('rejects a malformed deletion request at case %#', value => {
    expect(() => parseWorkspaceDeletionRequest(value)).toThrow('WORKSPACE_MANAGEMENT_CAPABILITY_INVALID');
  });

  it('rejects request accessors without invoking them or retaining a prototype', () => {
    let reads = 0;
    const value = { formatVersion: 1, workspaceId, backupChoice: 'createBackup',
      get typedLabel() { reads += 1; return 'Name'; } };
    expect(() => parseWorkspaceDeletionRequest(value)).toThrow('WORKSPACE_MANAGEMENT_CAPABILITY_INVALID');
    expect(reads).toBe(0);
    expect(() => parseWorkspaceDeletionRequest(Object.assign(Object.create({ inherited: true }), {
      formatVersion: 1, workspaceId, typedLabel: 'Name', backupChoice: 'createBackup',
    }))).toThrow('WORKSPACE_MANAGEMENT_CAPABILITY_INVALID');
  });
});

describe('workspace deletion operation result protocol', () => {
  it.each(['continue', 'relaunching', 'restartRequired'] as const)(
    'distinguishes cancelled deletion from its %s runtime follow-up', nextAction => {
      const value = { formatVersion: 1, status: 'cancelled', nextAction };
      const parsed = parseWorkspaceDeletionOperationResult(value);
      expect(parsed).toEqual(value);
      expect(parsed).not.toBe(value);
      expect(Object.isFrozen(parsed)).toBe(true);
      value.status = 'completed';
      expect(parsed.status).toBe('cancelled');
    },
  );

  it.each(['selector', 'reopenPrevious'] as const)(
    'preserves only the validated %s completion destination', navigation => {
      const parsed = parseWorkspaceDeletionOperationResult({ formatVersion: 1, status: 'completed', navigation });
      expect(parsed).toEqual({ formatVersion: 1, status: 'completed', navigation });
      expect(Object.isFrozen(parsed)).toBe(true);
    },
  );

  it.each(['continue', 'restartRequired'] as const)(
    'requires an explicit no-effect failure with %s follow-up', nextAction => {
      expect(parseWorkspaceDeletionOperationResult({ formatVersion: 1, status: 'failed',
        errorCode: 'WORKSPACE_MANAGEMENT_BUSY', sideEffectState: 'none', nextAction })).toEqual({
        formatVersion: 1, status: 'failed', errorCode: 'WORKSPACE_MANAGEMENT_BUSY', sideEffectState: 'none', nextAction,
      });
    },
  );

  it('does not turn uncertain completion into cancellation, no effect or automatic continuation', () => {
    expect(parseWorkspaceDeletionOperationResult({ formatVersion: 1, status: 'recoveryRequired',
      errorCode: 'WORKSPACE_DELETE_OWNERSHIP_UNCERTAIN', sideEffectState: 'unknown', nextAction: 'restartRequired' })).toEqual({
      formatVersion: 1, status: 'recoveryRequired', errorCode: 'WORKSPACE_DELETE_OWNERSHIP_UNCERTAIN',
      sideEffectState: 'unknown', nextAction: 'restartRequired',
    });
  });

  it.each([
    undefined, null, [], 'completed',
    { formatVersion: 1, status: 'prepared' },
    { formatVersion: 1, status: 'returnRequested' },
    { formatVersion: 1, status: 'completed' },
    { formatVersion: 1, status: 'cancelled' },
    { formatVersion: 2, status: 'completed', navigation: 'selector' },
    { formatVersion: 1, status: 'completed', navigation: 'openAnyWorkspace' },
    { formatVersion: 1, status: 'completed', navigation: 'selector', nextAction: 'continue' },
    { formatVersion: 1, status: 'cancelled', nextAction: 'retry' },
    { formatVersion: 1, status: 'failed', errorCode: 'WORKSPACE_DELETE_FAILED', nextAction: 'continue' },
    { formatVersion: 1, status: 'failed', errorCode: 'WORKSPACE_DELETE_FAILED', sideEffectState: 'unknown', nextAction: 'continue' },
    { formatVersion: 1, status: 'recoveryRequired', errorCode: 'WORKSPACE_DELETE_FAILED', sideEffectState: 'none', nextAction: 'restartRequired' },
    { formatVersion: 1, status: 'recoveryRequired', errorCode: 'WORKSPACE_DELETE_FAILED', sideEffectState: 'unknown', nextAction: 'continue' },
    { formatVersion: 1, status: 'recoveryRequired', errorCode: 'WORKSPACE_DELETE_FAILED', sideEffectState: 'unknown', nextAction: 'relaunching' },
    { formatVersion: 1, status: 'failed', errorCode: 'WORKSPACE_MANAGEMENT_CREATE_FAILED', sideEffectState: 'none', nextAction: 'continue' },
    { formatVersion: 1, status: 'failed', errorCode: 'WORKSPACE_DELETE_FAILED: private detail', sideEffectState: 'none', nextAction: 'continue' },
    { formatVersion: 1, status: 'completed', navigation: 'selector', workspaceId },
    { formatVersion: 1, status: 'cancelled', nextAction: 'continue', path: 'untrusted' },
    { formatVersion: 1, status: 'recoveryRequired', errorCode: 'WORKSPACE_DELETE_FAILED', sideEffectState: 'unknown', nextAction: 'restartRequired', cause: new Error('private') },
  ])('rejects an ambiguous or unsafe deletion result at case %#', value => {
    expect(() => parseWorkspaceDeletionOperationResult(value)).toThrow('WORKSPACE_MANAGEMENT_CAPABILITY_INVALID');
  });

  it.each(['formatVersion', 'status', 'navigation'] as const)(
    'rejects a %s accessor without reading any getter', key => {
      let reads = 0;
      const value = { formatVersion: 1, status: 'completed', navigation: 'selector' };
      Object.defineProperty(value, key, { enumerable: true, get() { reads += 1; return 'untrusted'; } });
      expect(() => parseWorkspaceDeletionOperationResult(value)).toThrow('WORKSPACE_MANAGEMENT_CAPABILITY_INVALID');
      expect(reads).toBe(0);
    },
  );

  it('rejects inherited, hidden and symbol fields and snapshots a plain null-prototype value', () => {
    const value = { formatVersion: 1, status: 'cancelled', nextAction: 'continue' };
    expect(() => parseWorkspaceDeletionOperationResult(Object.assign(Object.create({ inherited: true }), value)))
      .toThrow('WORKSPACE_MANAGEMENT_CAPABILITY_INVALID');
    const hidden = { ...value };
    Object.defineProperty(hidden, 'private', { value: 'untrusted' });
    expect(() => parseWorkspaceDeletionOperationResult(hidden)).toThrow('WORKSPACE_MANAGEMENT_CAPABILITY_INVALID');
    expect(() => parseWorkspaceDeletionOperationResult({ ...value, [Symbol('private')]: 'untrusted' }))
      .toThrow('WORKSPACE_MANAGEMENT_CAPABILITY_INVALID');
    expect(parseWorkspaceDeletionOperationResult(Object.assign(Object.create(null), value))).toEqual(value);
  });
});
