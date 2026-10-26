import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { InMemoryWorkspaceMaintenanceLease } from '../maintenance/workspaceMaintenanceLease.js';
import type { WorkspaceId } from '../registry/workspaceRegistryTypes.js';
import type { WorkspaceRegistryPort } from '../registry/workspaceRegistryPort.js';
import { WorkspaceManagementError } from './workspaceManagementError.js';
import { WorkspaceManagementRecoveryRequiredError } from './workspaceManagementOperationGuard.js';
import { WorkspaceManagementService } from './workspaceManagementService.js';
import { WorkspaceBackupImportError } from '../import/workspaceBackupImportError.js';
import { EmptyWorkspaceCreationError } from '../creation/emptyWorkspaceCreationError.js';
import { WorkspaceRegistryMutationError } from '../registry/workspaceRegistryMutations.js';
import { WorkspaceBackupReplacementError } from '../replacement/workspaceBackupReplacementError.js';
import { createWorkspaceBackupReplacementFixture, TEST_REPLACEMENT_WORKSPACE_ID } from '../replacement/workspaceBackupReplacementTestSupport.js';
import { JsonLineDesktopOperationalLogger } from '../../observability/infrastructure/jsonLineDesktopOperationalLogger.js';
import { createWorkspaceBackupOperationalObserver } from './workspaceBackupOperationalObserver.js';

const activeId = '00000000-0000-4000-8000-000000000001' as WorkspaceId;
const logRoots: string[] = [];
afterEach(async () => {
  for (const root of logRoots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe('workspace management service', () => {
  it.each(['create', 'import', 'rename'] as const)(
    'writes the mapped %s label conflict through the real observer and JSONL writer', async operationKind => {
      const original = operationKind === 'create'
        ? new EmptyWorkspaceCreationError('WORKSPACE_CREATION_LABEL_EXISTS', 'inputValidation')
        : operationKind === 'import'
          ? new WorkspaceBackupImportError('WORKSPACE_IMPORT_LABEL_EXISTS', 'registryRead')
          : new WorkspaceRegistryMutationError('workspaceLabelExists');
      const fail = async () => { throw original; };
      const logsRoot = await mkdtemp(join(tmpdir(), 'eky-workspace-failure-'));
      logRoots.push(logsRoot);
      const service = createService({ create: fail, importBackup: fail, rename: fail,
        observer: createWorkspaceBackupOperationalObserver({
          operationalIdentity: { appVersion: '0.2.81', buildRevision: 'development',
            runtimeInstanceId: '11111111-1111-4111-8111-111111111111' },
          operationalLogger: new JsonLineDesktopOperationalLogger({ logsRoot }),
        }),
      });
      const result = operationKind === 'create' ? service.createEmpty('Synthetic')
        : operationKind === 'rename' ? service.rename(activeId, 'Synthetic')
          : service.importBackupAsNew({ containerPath: 'synthetic-private-path',
            password: 'synthetic-private-password', workspaceLabel: 'Synthetic' });
      await expect(result).rejects.toMatchObject({ code: 'WORKSPACE_MANAGEMENT_LABEL_EXISTS', cause: original });
      const files = await readdir(join(logsRoot, 'desktop'));
      expect(files).toHaveLength(1);
      const lines = (await readFile(join(logsRoot, 'desktop', files[0]!), 'utf8')).trim().split('\n');
      expect(lines).toHaveLength(1);
      expect(JSON.parse(lines[0]!)).toMatchObject({
        eventName: 'workspaceManagement.operationFailed', operationId: `workspace.${operationKind}`,
        errorCode: 'WORKSPACE_MANAGEMENT_LABEL_EXISTS', stage: 'operation',
        retryable: false, sideEffectState: 'unknown', outcome: 'failure',
      });
      expect(lines[0]).not.toContain(activeId);
      expect(lines[0]).not.toMatch(/Synthetic|synthetic-private|workspaceLabel|workspaceId|profileId|companyId|password|message|stack/);
    },
  );

  it('writes the real wrong-lineage rejection before any lease, shutdown or profile mutation', async () => {
    const f = createWorkspaceBackupReplacementFixture({ profileId: 'f'.repeat(64) });
    const before = f.registry.value;
    const logsRoot = await mkdtemp(join(tmpdir(), 'eky-workspace-failure-'));
    logRoots.push(logsRoot);
    const input = { containerPath: 'synthetic-private-path', password: 'synthetic-private-password',
      targetWorkspaceId: TEST_REPLACEMENT_WORKSPACE_ID };
    const service = createService({ replace: async () => f.coordinator.replace(input),
      observer: createWorkspaceBackupOperationalObserver({
        operationalIdentity: { appVersion: '0.2.81', buildRevision: 'development',
          runtimeInstanceId: '11111111-1111-4111-8111-111111111111' },
        operationalLogger: new JsonLineDesktopOperationalLogger({ logsRoot }),
      }),
    });
    await expect(service.replaceActiveFromBackup(input)).rejects.toMatchObject({ code: 'WORKSPACE_MANAGEMENT_INVALID' });
    expect(f.registry.value).toBe(before);
    expect(f.events).toEqual(['guard.assert', 'registry.read', 'activationFactory.create', 'activationJournal.read', 'backup.inspect']);
    expect(f.preRestore.calls).toBe(0);
    expect(f.rootStore.prepared).toBe(false);
    const files = await readdir(join(logsRoot, 'desktop'));
    expect(files).toHaveLength(1);
    const lines = (await readFile(join(logsRoot, 'desktop', files[0]!), 'utf8')).trim().split('\n');
    expect(lines).toHaveLength(1);
    const event = JSON.parse(lines[0]!);
    expect(event).toMatchObject({ eventName: 'workspaceManagement.operationFailed',
      errorCode: 'WORKSPACE_REPLACEMENT_LINEAGE_MISMATCH', operationId: 'workspace.replace',
      stage: 'lineageCheck', retryable: false, sideEffectState: 'none', outcome: 'failure' });
    expect(lines[0]).not.toMatch(/synthetic-private|workspaceId|profileId|password|message|stack/);
  });

  it.each(['import', 'replace'] as const)(
    'records the %s first cause separately from recovery without changing its public code', async operation => {
      const events: unknown[] = [];
      const original = new AggregateError([
        new Error('synthetic private detail'),
        new Error('PROFILE_INSPECTION_CLEANUP_UNVERIFIED'),
      ]);
      const failure = operation === 'import'
        ? new WorkspaceBackupImportError('WORKSPACE_IMPORT_VALIDATION_FAILED', 'candidateValidation', { cause: original })
        : new WorkspaceBackupReplacementError('WORKSPACE_REPLACEMENT_VALIDATION_FAILED', 'candidateValidation', { cause: original });
      const fail = async () => { throw failure; };
      const service = createService({ events, importBackup: fail, replace: fail });
      const result = operation === 'import'
        ? service.importBackupAsNew({ containerPath: 'private-path', password: 'private-password', workspaceLabel: 'Synthetic' })
        : service.replaceActiveFromBackup({ containerPath: 'private-path', password: 'private-password', targetWorkspaceId: activeId });
      await expect(result).rejects.toMatchObject({
        code: operation === 'import' ? 'WORKSPACE_MANAGEMENT_IMPORT_FAILED' : 'WORKSPACE_MANAGEMENT_REPLACE_FAILED',
      });
      expect(events).toContainEqual(expect.objectContaining({
        inspectionCauseCode: 'unknown',
        cleanupCauseCode: 'PROFILE_INSPECTION_CLEANUP_UNVERIFIED',
        operationKind: operation,
        outcome: 'failed',
      }));
      expect(JSON.stringify(events)).not.toMatch(/private|password|AggregateError|stack/);
    },
  );

  it('records exact typed lineage before public mapping and leaves the original cause intact', async () => {
    const events: unknown[] = [];
    const original = new WorkspaceBackupReplacementError('WORKSPACE_REPLACEMENT_LINEAGE_MISMATCH', 'lineageCheck');
    const service = createService({ events, replace: async () => { throw original; } });
    await expect(service.replaceActiveFromBackup({ containerPath: 'private-path',
      password: 'private-password', targetWorkspaceId: activeId })).rejects.toMatchObject({
      code: 'WORKSPACE_MANAGEMENT_INVALID', cause: original,
    });
    expect(events).toEqual([expect.objectContaining({ errorCode: original.code,
      stage: 'lineageCheck', operationKind: 'replace', sideEffectState: 'none', retryable: false })]);
    expect(events[0]).not.toHaveProperty('inspectionCauseCode');
  });

  it.each(['import', 'replace'] as const)('does not guess inspection provenance for an unknown %s failure', async operation => {
    const events: unknown[] = [];
    const fail = async () => { throw new AggregateError([
      new Error('synthetic private detail'), new Error('PROFILE_INSPECTION_CLEANUP_UNVERIFIED'),
    ]); };
    const service = createService({ events, importBackup: fail, replace: fail });
    const result = operation === 'import'
      ? service.importBackupAsNew({ containerPath: 'private-path', password: 'private-password', workspaceLabel: 'Synthetic' })
      : service.replaceActiveFromBackup({ containerPath: 'private-path', password: 'private-password', targetWorkspaceId: activeId });
    await expect(result).rejects.toBeInstanceOf(WorkspaceManagementError);
    expect(events).toEqual([expect.objectContaining({ stage: 'operation', operationKind: operation,
      cleanupCauseCode: 'PROFILE_INSPECTION_CLEANUP_UNVERIFIED', sideEffectState: 'unknown' })]);
    expect(events[0]).not.toHaveProperty('inspectionCauseCode');
  });

  it.each(['import', 'replace'] as const)('does not attribute a prior guard error to the unstarted %s inspector', async operation => {
    const events: unknown[] = [];
    const execute = vi.fn();
    const service = createService({ events, importBackup: execute, replace: execute,
      assertNoUnresolvedOperations: async () => {
        const failure = new WorkspaceManagementRecoveryRequiredError();
        failure.cause = new Error('PROFILE_SCHEMA_UNSUPPORTED');
        throw failure;
      } });
    const result = operation === 'import'
      ? service.importBackupAsNew({ containerPath: 'private-path', password: 'private-password', workspaceLabel: 'Synthetic' })
      : service.replaceActiveFromBackup({ containerPath: 'private-path', password: 'private-password', targetWorkspaceId: activeId });
    await expect(result).rejects.toMatchObject({ code: 'WORKSPACE_MANAGEMENT_RECOVERY_REQUIRED' });
    expect(execute).not.toHaveBeenCalled();
    expect(events).toEqual([expect.objectContaining({ stage: 'operation', errorCode: 'WORKSPACE_MANAGEMENT_RECOVERY_REQUIRED' })]);
    expect(events[0]).not.toHaveProperty('inspectionCauseCode');
  });

  it('returns the safe registry status and delegates each command', async () => {
    const create = vi.fn(async () => ({
      workspaceId: activeId,
      workspaceLabel: 'Luotu',
    }));
    const importBackup = vi.fn(async () => ({
      workspaceId: activeId,
      workspaceLabel: 'Tuotu',
    }));
    const replace = vi.fn(async () => ({
      migrationChainIdentity: 'chain',
      profileId: 'profile',
      workspaceId: activeId,
    }));
    const switchTo = vi.fn(async () => undefined);
    const rename = vi.fn(async () => ({
      changed: true,
      workspaceId: activeId,
      workspaceLabel: 'Nimetty',
    }));
    const events: unknown[] = [];
    const service = createService({
      create,
      events,
      importBackup,
      rename,
      replace,
      switchTo,
    });

    await expect(service.getStatus()).resolves.toMatchObject({
      activeWorkspaceId: activeId,
      operationState: 'idle',
    });
    await service.createEmpty('Luotu');
    await service.importBackupAsNew({
      containerPath: 'private-path',
      password: 'private-password',
      workspaceLabel: 'Tuotu',
    });
    await service.replaceActiveFromBackup({
      containerPath: 'private-path',
      password: 'private-password',
      targetWorkspaceId: activeId,
    });
    await service.switchTo(activeId);
    await service.rename(activeId, 'Nimetty');

    expect(create).toHaveBeenCalledWith('Luotu');
    expect(importBackup).toHaveBeenCalledTimes(1);
    expect(replace).toHaveBeenCalledTimes(1);
    expect(switchTo).toHaveBeenCalledWith(activeId);
    expect(rename).toHaveBeenCalledWith(activeId, 'Nimetty');
    expect(JSON.stringify(events)).not.toContain('private-path');
    expect(JSON.stringify(events)).not.toContain('private-password');
    expect(JSON.stringify(events)).not.toContain(activeId);
  });

  it('serializes management commands without acquiring the shared lease twice', async () => {
    let finish!: () => void;
    const events: unknown[] = [];
    const pending = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const service = createService({
      create: async () => {
        await pending;
        return { workspaceId: activeId, workspaceLabel: 'Luotu' };
      },
      events,
    });

    const first = service.createEmpty('Luotu');
    await expect(service.switchTo(activeId)).rejects.toMatchObject({
      code: 'WORKSPACE_MANAGEMENT_BUSY',
    });
    expect(events).toContainEqual(
      expect.objectContaining({
        errorCode: 'WORKSPACE_MANAGEMENT_BUSY',
        operationKind: 'switch',
        outcome: 'failed',
        sideEffectState: 'none',
        stage: 'admission',
      }),
    );
    finish();
    await expect(first).resolves.toMatchObject({ workspaceId: activeId });
  });

  it('maps raw failures to a closed code and ignores observer failure', async () => {
    const service = createService({
      create: async () => {
        throw new Error('C:/private/path and stack detail');
      },
      observer: {
        record() {
          throw new Error('observer failure');
        },
      },
    });

    await expect(service.createEmpty('Luotu')).rejects.toEqual(
      new WorkspaceManagementError(
        'WORKSPACE_MANAGEMENT_CREATE_FAILED',
        'create',
      ),
    );
  });

  it('reports recoveryRequired without exposing operation details', async () => {
    const service = createService({ recoveryState: 'recoveryRequired' });
    await expect(service.getStatus()).resolves.toMatchObject({
      operationState: 'recoveryRequired',
    });
  });

  it('blocks every mutation before its command when recovery is unresolved', async () => {
    const create = vi.fn(async () => ({
      workspaceId: activeId,
      workspaceLabel: 'Luotu',
    }));
    const service = createService({
      assertNoUnresolvedOperations: async () => {
        throw new WorkspaceManagementRecoveryRequiredError();
      },
      create,
    });

    await expect(service.createEmpty('Luotu')).rejects.toMatchObject({
      code: 'WORKSPACE_MANAGEMENT_RECOVERY_REQUIRED',
    });
    expect(create).not.toHaveBeenCalled();
  });

  it('completes a deferred runtime relaunch after the command settles', async () => {
    const order: string[] = [];
    const service = createService({
      create: async () => {
        order.push('operation');
        return { workspaceId: activeId, workspaceLabel: 'Luotu' };
      },
      runtimeRelaunchCompletion: {
        complete() {
          order.push('relaunch.complete');
        },
      },
    });

    await service.createEmpty('Luotu');

    expect(order).toEqual(['operation', 'relaunch.complete']);
  });

  it('completes a deferred recovery relaunch after a failed command', async () => {
    const complete = vi.fn();
    const service = createService({
      create: async () => {
        throw new Error('private failure');
      },
      runtimeRelaunchCompletion: { complete },
    });

    await expect(service.createEmpty('Luotu')).rejects.toMatchObject({
      code: 'WORKSPACE_MANAGEMENT_CREATE_FAILED',
    });
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it('seals every entry point without starting new readers or commands', async () => {
    const readRegistry = vi.fn();
    const readRecoveryState = vi.fn();
    const command = vi.fn();
    const service = createService({ readRegistry, readRecoveryState, create: command,
      importBackup: command, replace: command, switchTo: command, rename: command });
    service.closeAdmission();
    const calls = [service.getStatus(), service.createEmpty('Synthetic'),
      service.importBackupAsNew({ containerPath: 'private-path', password: 'synthetic', workspaceLabel: 'Synthetic' }),
      service.replaceActiveFromBackup({ containerPath: 'private-path', password: 'synthetic', targetWorkspaceId: activeId }),
      service.switchTo(activeId), service.rename(activeId, 'Synthetic')];
    await expect(Promise.allSettled(calls)).resolves.toEqual(calls.map(() => ({
      status: 'rejected', reason: expect.objectContaining({ code: 'WORKSPACE_MANAGEMENT_RECOVERY_REQUIRED' }),
    })));
    expect(readRegistry).not.toHaveBeenCalled();
    expect(readRecoveryState).not.toHaveBeenCalled();
    expect(command).not.toHaveBeenCalled();
    const closing = service.shutdown();
    expect(service.shutdown()).toBe(closing);
    await closing;
  });

  it('does not start a command after a late admission result', async () => {
    const guard = deferred<void>();
    const create = vi.fn();
    const service = createService({ create, assertNoUnresolvedOperations: () => guard.promise });
    const operation = service.createEmpty('Synthetic');
    const failed = expect(operation).rejects.toMatchObject({ code: 'WORKSPACE_MANAGEMENT_RECOVERY_REQUIRED' });
    let settled = false;
    const closing = service.shutdown().then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);
    guard.resolve();
    await failed;
    await closing;
    expect(create).not.toHaveBeenCalled();
  });

  it.each(['success', 'failure'] as const)('waits for a started command and preserves its %s', async outcome => {
    const started = deferred<void>();
    const operation = deferred<{ workspaceId: WorkspaceId; workspaceLabel: string }>();
    const complete = vi.fn();
    const service = createService({ create: () => { started.resolve(); return operation.promise; },
      runtimeRelaunchCompletion: { complete } });
    const result = service.createEmpty('Synthetic');
    const cause = new Error('synthetic first cause');
    const assertion = outcome === 'success'
      ? expect(result).resolves.toMatchObject({ workspaceId: activeId })
      : expect(result).rejects.toMatchObject({ code: 'WORKSPACE_MANAGEMENT_CREATE_FAILED', cause });
    await started.promise;
    let settled = false;
    const closing = service.shutdown().then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);
    if (outcome === 'success') operation.resolve({ workspaceId: activeId, workspaceLabel: 'Synthetic' });
    else operation.reject(cause);
    await assertion;
    await closing;
    expect(complete).toHaveBeenCalledOnce();
  });

  it.each(['registry', 'recovery'] as const)(
    'settles both status readers before shutdown and retains the first %s failure', async first => {
      const registry = deferred<Awaited<ReturnType<WorkspaceRegistryPort['read']>>>();
      const recovery = deferred<'clear'>();
      const started = deferred<void>();
      const service = createService({ readRegistry: () => registry.promise,
        readRecoveryState: () => { started.resolve(); return recovery.promise; } });
      const cause = new Error('synthetic first read failure');
      const status = service.getStatus();
      const failed = expect(status).rejects.toMatchObject({ cause });
      await started.promise;
      const initial = first === 'registry' ? registry : recovery;
      const other = first === 'registry' ? recovery : registry;
      initial.reject(cause);
      let statusSettled = false;
      void status.then(() => { statusSettled = true; }, () => { statusSettled = true; });
      let closed = false;
      const closing = service.shutdown().then(() => { closed = true; });
      await Promise.resolve();
      await Promise.resolve();
      expect(statusSettled).toBe(false);
      expect(closed).toBe(false);
      other.reject(new Error('synthetic later read failure'));
      await failed;
      await closing;
    },
  );

  it('tracks status reads before a synchronous callback requests shutdown', async () => {
    const registry = deferred<Awaited<ReturnType<WorkspaceRegistryPort['read']>>>();
    const started = deferred<void>();
    let closing: Promise<void> | undefined;
    const readRecoveryState = vi.fn(async () => 'clear' as const);
    const service = createService({ readRecoveryState, readRegistry: () => {
      closing = service.shutdown();
      started.resolve();
      return registry.promise;
    } });
    const status = service.getStatus();
    const failed = expect(status).rejects.toMatchObject({ code: 'WORKSPACE_MANAGEMENT_RECOVERY_REQUIRED' });
    await started.promise;
    expect(closing).toBeDefined();
    let closed = false;
    void closing!.then(() => { closed = true; });
    await Promise.resolve();
    expect(closed).toBe(false);
    expect(readRecoveryState).not.toHaveBeenCalled();
    registry.resolve(undefined);
    await failed;
    await closing;
  });

  it('publishes the current command before reentrant shutdown and does not await itself', async () => {
    const started = deferred<void>();
    const finish = deferred<void>();
    let closing: Promise<void> | undefined;
    const service = createService({ create: async () => {
      closing = service.shutdown();
      started.resolve();
      await finish.promise;
      return { workspaceId: activeId, workspaceLabel: 'Synthetic' };
    } });
    const result = service.createEmpty('Synthetic');
    await started.promise;
    expect(closing).toBeDefined();
    let closed = false;
    void closing!.then(() => { closed = true; });
    await Promise.resolve();
    expect(closed).toBe(false);
    finish.resolve();
    await expect(result).resolves.toMatchObject({ workspaceId: activeId });
    await closing;
  });
});

function createService(overrides: {
  assertNoUnresolvedOperations?: () => Promise<void>;
  create?: (label: unknown) => Promise<{
    workspaceId: WorkspaceId;
    workspaceLabel: string;
  }>;
  events?: unknown[];
  importBackup?: (input: unknown) => Promise<{
    workspaceId: WorkspaceId;
    workspaceLabel: string;
  }>;
  observer?: { record(event: unknown): void };
  recoveryState?: 'clear' | 'recoveryRequired';
  readRegistry?: WorkspaceRegistryPort['read'];
  readRecoveryState?: () => Promise<'clear' | 'recoveryRequired'>;
  rename?: (workspaceId: unknown, label: unknown) => Promise<{
    changed: boolean;
    workspaceId: WorkspaceId;
    workspaceLabel: string;
  }>;
  replace?: (input: unknown) => Promise<{
    migrationChainIdentity: string;
    profileId: string;
    workspaceId: WorkspaceId;
  }>;
  switchTo?: (workspaceId: WorkspaceId) => Promise<void>;
  runtimeRelaunchCompletion?: { complete(): void };
} = {}): WorkspaceManagementService {
  const maintenance = new InMemoryWorkspaceMaintenanceLease();
  const observer =
    overrides.observer ??
    (overrides.events === undefined
      ? undefined
      : { record: (event: unknown) => overrides.events!.push(event) });
  return new WorkspaceManagementService({
    createEmpty: {
      create:
        overrides.create ??
        (async () => ({ workspaceId: activeId, workspaceLabel: 'Luotu' })),
    },
    importBackup: {
      import:
        overrides.importBackup ??
        (async () => ({ workspaceId: activeId, workspaceLabel: 'Tuotu' })),
    },
    maintenanceState: maintenance,
    ...(observer === undefined ? {} : { observer }),
    operationGuard: {
      assertNoUnresolvedOperations:
        overrides.assertNoUnresolvedOperations ??
        (async () => undefined),
      readRecoveryState: overrides.readRecoveryState ?? (async () => overrides.recoveryState ?? 'clear'),
    },
    registry: {
      read: overrides.readRegistry ?? (async () => ({
        activeWorkspaceId: activeId,
        formatVersion: 1,
        workspaces: [
          {
            createdAt: '2026-08-19T00:00:00.000Z',
            layoutVersion: 1,
            lifecycleState: 'ready',
            lineageIdentity: { formatVersion: 1, profileId: 'private-profile' },
            workspaceId: activeId,
            workspaceLabel: 'Yritys A',
          },
        ],
      })),
    },
    renameWorkspace: {
      rename:
        overrides.rename ??
        (async () => ({
          changed: true,
          workspaceId: activeId,
          workspaceLabel: 'Nimetty',
        })),
    },
    replaceActive: {
      replace:
        overrides.replace ??
        (async () => ({
          migrationChainIdentity: 'chain',
          profileId: 'profile',
          workspaceId: activeId,
        })),
    },
    ...(overrides.runtimeRelaunchCompletion === undefined
      ? {}
      : {
          runtimeRelaunchCompletion:
            overrides.runtimeRelaunchCompletion,
        }),
    switchWorkspace: {
      switchTo: overrides.switchTo ?? (async () => undefined),
    },
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
