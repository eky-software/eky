import { resolve } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createWorkspaceCandidateCompletedStatus,
  createWorkspaceCandidateFailedStatus,
  createWorkspaceCandidateReadyStatus,
  createWorkspaceCandidateReservationReadyStatus,
  type WorkspaceCandidateProcessCommand,
} from '../../runtime/workspaceCandidateMessages.js';
import {
  ElectronWorkspaceCandidateRuntimeFactory,
  type WorkspaceCandidateProcessSpawner,
  type WorkspaceCandidateReservationOwner,
  type WorkspaceCandidateReservationTransfer,
} from './electronWorkspaceCandidateRuntimeFactory.js';
import {
  TEST_OPERATION_ID,
  TEST_WORKSPACE_ID,
} from '../creation/emptyWorkspaceCreationTestSupport.js';
import { TEST_IMPORT_OPERATION_ID } from '../import/workspaceBackupImportTestSupport.js';
import { startWorkspaceCandidateRunner } from '../../runtime/workspaceCandidateRunner.js';

const profileId = 'b'.repeat(64);
const migrationChainIdentity = 'c'.repeat(64);

describe('ElectronWorkspaceCandidateRuntimeFactory', () => {
  it('waits for a private handshake and exposes readiness only after exit', async () => {
    const process = new FakeCandidateProcess();
    const spawner = new RecordingCandidateSpawner(process);
    const factory = createFactory(spawner);
    const runtimePromise = factory.start({
      operationId: TEST_OPERATION_ID,
      workspaceId: TEST_WORKSPACE_ID,
      ...candidatePaths(),
    });

    expect(process.commands).toEqual([]);
    const start = await process.handshake();
    expect(start.operation.operation).toBe('bootstrapEmpty');
    expect(start.operationId).toBe(TEST_OPERATION_ID);
    expect(start.operation).not.toHaveProperty('operationId');
    expect(start.operation).not.toHaveProperty('workspaceId');
    process.message(completedReadiness(start));
    const runtime = await runtimePromise;

    await expect(runtime.inspectStoppedReadiness()).rejects.toThrow(
      'WORKSPACE_CANDIDATE_RESULT_UNAVAILABLE',
    );
    const stopped = runtime.stopAndProveHandlesClosed();
    expect(process.lastCommand('shutdown')).toMatchObject({
      operationId: start.operationId,
      requestId: start.requestId,
      runtimeSession: start.runtimeSession,
    });
    process.exit(0);
    await expect(stopped).resolves.toBe(true);
    await expect(runtime.inspectStoppedReadiness()).resolves.toMatchObject({
      handlesClosed: true,
      lineageIdentity: { formatVersion: 1, profileId },
      migrationChainIdentity,
      migrationState: 'current',
    });
    expect(process.active).toBe(false);
    expect(spawner.environment).not.toHaveProperty('EKY_RUNTIME_SESSION');
  });

  it('keeps migration results private until the candidate exits', async () => {
    const process = new FakeCandidateProcess();
    const factory = createFactory(new RecordingCandidateSpawner(process));
    const runtimePromise = factory.startMigration({
      operationId: TEST_IMPORT_OPERATION_ID,
      workspaceId: TEST_WORKSPACE_ID,
      ...candidatePaths(),
      expectedProfileId: profileId,
      expectedSourceMigrationChainIdentity: 'd'.repeat(64),
      importStagingRoot: resolve('private-import-staging'),
    });

    const start = await process.handshake();
    process.message(
      createWorkspaceCandidateCompletedStatus({
        operationId: start.operationId,
        requestId: start.requestId,
        result: {
          kind: 'migration',
          migrationChainIdentity,
          profileId,
        },
        runtimeSession: start.runtimeSession,
      }),
    );
    const runtime = await runtimePromise;
    const stopped = runtime.stopAndProveHandlesClosed();
    process.exit(0);

    await expect(stopped).resolves.toBe(true);
    await expect(runtime.inspectStoppedMigrationResult?.()).resolves.toEqual({
      handlesClosed: true,
      migrationChainIdentity,
      profileId,
    });
  });

  it('keeps read-only migration inspection private and returns only safe counts', async () => {
    const process = new FakeCandidateProcess();
    const factory = createFactory(new RecordingCandidateSpawner(process));
    const paths = candidatePaths();
    const runtimePromise = factory.startMigrationInspection({
      databaseFilePath: paths.databaseFilePath,
      expectedProfileId: profileId,
      operationId: TEST_OPERATION_ID,
      publishedRoot: paths.candidateRoot,
    });

    const start = await process.handshake();
    expect(start.operation).toEqual({
      appVersion: '0.2.6',
      backendRoot: resolve('backend'),
      buildRevision: 'development',
      databaseFilePath: paths.databaseFilePath,
      expectedProfileId: profileId,
      migrationsDirectory: resolve(
        'backend',
        'dist',
        'database',
        'migrations',
      ),
      operation: 'inspectPublishedMigration',
      publishedRoot: paths.candidateRoot,
    });
    process.message(
      createWorkspaceCandidateCompletedStatus({
        operationId: start.operationId,
        requestId: start.requestId,
        result: {
          appliedMigrationCount: 38,
          kind: 'migrationInspection',
          pendingMigrationCount: 2,
          status: 'compatiblePending',
        },
        runtimeSession: start.runtimeSession,
      }),
    );
    const runtime = await runtimePromise;
    const stopped = runtime.stopAndProveHandlesClosed();
    process.exit(0);

    await expect(stopped).resolves.toBe(true);
    await expect(runtime.inspectStoppedMigrationInspection()).resolves.toEqual(
      {
        appliedMigrationCount: 38,
        pendingMigrationCount: 2,
        status: 'compatiblePending',
      },
    );
  });

  it('validates historical published readiness through a separate private operation', async () => {
    const process = new FakeCandidateProcess();
    const factory = createFactory(new RecordingCandidateSpawner(process));
    const paths = candidatePaths();
    const runtimePromise = factory.startHistoricalPublishedValidation({
      artifactRoot: paths.artifactRoot,
      databaseFilePath: paths.databaseFilePath,
      expectedProfileId: profileId,
      operationId: TEST_IMPORT_OPERATION_ID,
      publishedRoot: paths.candidateRoot,
      workspaceId: TEST_WORKSPACE_ID,
    });

    const start = await process.handshake();
    expect(start.operation).toMatchObject({
      expectedProfileId: profileId,
      operation: 'validateHistoricalPublished',
    });
    process.message(
      createWorkspaceCandidateCompletedStatus({
        operationId: start.operationId,
        requestId: start.requestId,
        result: {
          actorId: 'local-owner',
          artifactRootHealth: 'ready',
          companyId: 'local-company-1234567890abcdef1234567890abcdef',
          databaseHealth: 'healthy',
          foreignKeyHealth: 'healthy',
          kind: 'historicalReadiness',
          migrationChainIdentity,
          profileId,
        },
        runtimeSession: start.runtimeSession,
      }),
    );
    const runtime = await runtimePromise;
    const stopped = runtime.stopAndProveHandlesClosed();
    process.exit(0);

    await expect(stopped).resolves.toBe(true);
    await expect(
      runtime.inspectStoppedHistoricalReadiness?.(),
    ).resolves.toMatchObject({
      handlesClosed: true,
      lineageIdentity: { formatVersion: 1, profileId },
      migrationChainIdentity,
      migrationState: 'compatiblePending',
    });
  });

  it('cancels an in-flight migration inspection and closes its owned process', async () => {
    const process = new FakeCandidateProcess(true);
    const controller = new AbortController();
    const factory = createFactory(new RecordingCandidateSpawner(process));
    const paths = candidatePaths();
    const runtimePromise = factory.startMigrationInspection({
      databaseFilePath: paths.databaseFilePath,
      expectedProfileId: profileId,
      operationId: TEST_OPERATION_ID,
      publishedRoot: paths.candidateRoot,
      signal: controller.signal,
    });

    process.message(createWorkspaceCandidateReadyStatus());
    controller.abort();

    await expect(runtimePromise).rejects.toThrow(
      'WORKSPACE_CANDIDATE_OPERATION_FAILED',
    );
    expect(process.commands.filter(isShutdownCommand)).toHaveLength(1);
    expect(process.active).toBe(false);
  });

  it('rejects a differently scoped terminal result without leaving an orphan', async () => {
    const process = new FakeCandidateProcess();
    const factory = createFactory(new RecordingCandidateSpawner(process));
    const runtimePromise = factory.start({
      operationId: TEST_OPERATION_ID,
      workspaceId: TEST_WORKSPACE_ID,
      ...candidatePaths(),
    });

    const start = await process.handshake();
    process.message(
      completedReadiness({
        ...start,
        requestId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      }),
    );
    process.exit(1);

    await expect(runtimePromise).rejects.toThrow(
      'WORKSPACE_CANDIDATE_OPERATION_FAILED',
    );
    expect(process.active).toBe(false);
    expect(process.commands.filter(isShutdownCommand)).toHaveLength(1);
  });

  it('rejects duplicate and malformed terminal statuses', async () => {
    const duplicateProcess = new FakeCandidateProcess();
    const duplicatePromise = createFactory(
      new RecordingCandidateSpawner(duplicateProcess),
    ).start({
      operationId: TEST_OPERATION_ID,
      workspaceId: TEST_WORKSPACE_ID,
      ...candidatePaths(),
    });
    const start = await duplicateProcess.handshake();
    const completed = completedReadiness(start);
    duplicateProcess.message(completed);
    const runtime = await duplicatePromise;
    duplicateProcess.message(completed);
    duplicateProcess.exit(1);

    await expect(runtime.stopAndProveHandlesClosed()).resolves.toBe(false);
    await expect(runtime.inspectStoppedReadiness()).rejects.toThrow(
      'WORKSPACE_CANDIDATE_RESULT_UNAVAILABLE',
    );

    const malformedProcess = new FakeCandidateProcess();
    const malformedPromise = createFactory(
      new RecordingCandidateSpawner(malformedProcess),
    ).start({
      operationId: TEST_OPERATION_ID,
      workspaceId: TEST_WORKSPACE_ID,
      ...candidatePaths(),
    });
    malformedProcess.message(createWorkspaceCandidateReadyStatus());
    malformedProcess.message({ path: resolve('private'), type: 'completed' });
    malformedProcess.exit(1);

    await expect(malformedPromise).rejects.toThrow(
      'WORKSPACE_CANDIDATE_OPERATION_FAILED',
    );
    expect(malformedProcess.active).toBe(false);
  });

  it('fails safely on process error, exit before result and failed status', async () => {
    const errorProcess = new FakeCandidateProcess();
    const errorPromise = createFactory(
      new RecordingCandidateSpawner(errorProcess),
    ).start({
      operationId: TEST_OPERATION_ID,
      workspaceId: TEST_WORKSPACE_ID,
      ...candidatePaths(),
    });
    errorProcess.error();
    errorProcess.exit(1);
    await expect(errorPromise).rejects.toThrow(
      'WORKSPACE_CANDIDATE_OPERATION_FAILED',
    );

    const earlyExitProcess = new FakeCandidateProcess();
    const earlyExitPromise = createFactory(
      new RecordingCandidateSpawner(earlyExitProcess),
    ).start({
      operationId: TEST_OPERATION_ID,
      workspaceId: TEST_WORKSPACE_ID,
      ...candidatePaths(),
    });
    earlyExitProcess.message(createWorkspaceCandidateReadyStatus());
    earlyExitProcess.exit(1);
    await expect(earlyExitPromise).rejects.toThrow(
      'WORKSPACE_CANDIDATE_OPERATION_FAILED',
    );

    const failedProcess = new FakeCandidateProcess();
    const failedPromise = createFactory(
      new RecordingCandidateSpawner(failedProcess),
    ).start({
      operationId: TEST_OPERATION_ID,
      workspaceId: TEST_WORKSPACE_ID,
      ...candidatePaths(),
    });
    const failedStart = await failedProcess.handshake();
    failedProcess.message(
      createWorkspaceCandidateFailedStatus({
        operationId: failedStart.operationId,
        requestId: failedStart.requestId,
        runtimeSession: failedStart.runtimeSession,
      }),
    );
    failedProcess.exit(1);
    await expect(failedPromise).rejects.toThrow(
      'WORKSPACE_CANDIDATE_OPERATION_FAILED',
    );

    expect(errorProcess.active).toBe(false);
    expect(earlyExitProcess.active).toBe(false);
    expect(failedProcess.active).toBe(false);
  });

  it('bounds startup and operation waits and kills only the owned utility', async () => {
    const startupProcess = new FakeCandidateProcess(true);
    const startupPromise = createFactory(
      new RecordingCandidateSpawner(startupProcess),
      { startupTimeoutMilliseconds: 5 },
    ).start({
      operationId: TEST_OPERATION_ID,
      workspaceId: TEST_WORKSPACE_ID,
      ...candidatePaths(),
    });
    await expect(startupPromise).rejects.toThrow(
      'WORKSPACE_CANDIDATE_OPERATION_FAILED',
    );
    expect(startupProcess.killCount).toBe(1);
    expect(startupProcess.active).toBe(false);

    const operationProcess = new FakeCandidateProcess(true);
    const operationPromise = createFactory(
      new RecordingCandidateSpawner(operationProcess),
      { operationTimeoutMilliseconds: 5 },
    ).start({
      operationId: TEST_OPERATION_ID,
      workspaceId: TEST_WORKSPACE_ID,
      ...candidatePaths(),
    });
    await operationProcess.handshake();
    await expect(operationPromise).rejects.toThrow(
      'WORKSPACE_CANDIDATE_OPERATION_FAILED',
    );
    expect(operationProcess.killCount).toBe(1);
    expect(operationProcess.active).toBe(false);
  });
});

describe('candidate reservation handoff', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('waits for preparation, fresh grant and reacquisition after actual exit', async () => {
    const preparing = deferred();
    const prepared = deferred();
    const authorizing = deferred();
    const authorized = deferred();
    const reclaiming = deferred();
    const reclaimed = deferred();
    const invalidate = vi.fn();
    const process = new FakeCandidateProcess();
    const runtimePromise = startWithReservation(process, {
      prepare: async () => { preparing.resolve(); await prepared.promise; },
      assertGrant: async () => { authorizing.resolve(); await authorized.promise; },
      reclaimAfterExit: async () => { reclaiming.resolve(); await reclaimed.promise; },
      invalidate,
    });
    process.message(createWorkspaceCandidateReadyStatus());
    await preparing.promise;
    expect(process.commands).toEqual([]);
    prepared.resolve();
    const prepare = await process.waitForCommand('prepare');
    process.message(createWorkspaceCandidateReservationReadyStatus(prepare));
    await authorizing.promise;
    expect(process.commands).toEqual([prepare]);
    authorized.resolve();
    const start = await process.waitForCommand('start');
    process.message(completedInspection(start));
    const runtime = await runtimePromise;
    const stopped = runtime.stopAndProveHandlesClosed();
    expect(process.lastCommand('shutdown').requestId).toBe(start.requestId);
    expect(process.active).toBe(true);
    await expect(runtime.inspectStoppedMigrationInspection()).rejects.toThrow('WORKSPACE_CANDIDATE_RESULT_UNAVAILABLE');
    process.exit(0);
    await reclaiming.promise;
    await expect(runtime.inspectStoppedMigrationInspection()).rejects.toThrow('WORKSPACE_CANDIDATE_RESULT_UNAVAILABLE');
    reclaimed.resolve();
    await expect(stopped).resolves.toBe(true);
    await expect(runtime.inspectStoppedMigrationInspection()).resolves.toMatchObject({ status: 'current' });
    expect(invalidate).not.toHaveBeenCalled();
  });

  it.each(['request', 'session', 'identity', 'root', 'generation', 'duplicate'] as const)(
    'rejects %s mismatch or duplicate reservation readiness before work', async (variant) => {
      const process = new FakeCandidateProcess();
      const invalidate = vi.fn();
      const assertGrant = vi.fn(async () => {});
      const reclaimAfterExit = vi.fn(async () => {});
      const runtimePromise = startWithReservation(process, { invalidate, assertGrant, reclaimAfterExit });
      const rejected = expect(runtimePromise).rejects.toThrow('WORKSPACE_CANDIDATE_OPERATION_FAILED');
      const prepare = await process.prepare();
      const status = createWorkspaceCandidateReservationReadyStatus(prepare);
      const differentId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
      const altered = {
        ...status,
        ...(variant === 'request' ? { requestId: differentId, reservation: { ...status.reservation, generationId: differentId } } : {}),
        ...(variant === 'session' ? { runtimeSession: 'z'.repeat(43) } : {}),
        ...(variant === 'identity' ? { reservation: { ...status.reservation, identity: 'b'.repeat(64) } } : {}),
        ...(variant === 'root' ? { reservation: { ...status.reservation, userDataRoot: resolve('other-root') } } : {}),
        ...(variant === 'generation' ? { reservation: { ...status.reservation, generationId: differentId } } : {}),
      };
      process.message(altered);
      if (variant === 'duplicate') process.message(altered);
      process.exit(1);
      await rejected;
      expect(process.commands.some((value) => (value as WorkspaceCandidateProcessCommand).type === 'start')).toBe(false);
      expect(assertGrant).not.toHaveBeenCalled();
      expect(invalidate).toHaveBeenCalledOnce();
      expect(reclaimAfterExit).not.toHaveBeenCalled();
    },
  );

  it.each(['prepare', 'assertGrant'] as const)('joins pending %s on cancellation before reacquiring', async (stage) => {
    const entered = deferred();
    const completion = deferred();
    const reclaimAfterExit = vi.fn(async () => {});
    const cancellation = new AbortController();
    const process = new FakeCandidateProcess();
    const runtimePromise = startWithReservation(process, {
      [stage]: async (signal: AbortSignal) => {
        entered.resolve();
        await completion.promise;
        expect(signal.aborted).toBe(true);
      },
      reclaimAfterExit,
    }, cancellation.signal);
    const rejected = expect(runtimePromise).rejects.toThrow('WORKSPACE_CANDIDATE_OPERATION_FAILED');
    if (stage === 'prepare') process.message(createWorkspaceCandidateReadyStatus());
    else process.message(createWorkspaceCandidateReservationReadyStatus(await process.prepare()));
    await entered.promise;
    cancellation.abort();
    await process.waitForCommand('shutdown');
    process.message(createWorkspaceCandidateFailedStatus(process.lastCommand('shutdown')));
    process.exit(1);
    expect(reclaimAfterExit).not.toHaveBeenCalled();
    completion.resolve();
    await rejected;
    expect(reclaimAfterExit).toHaveBeenCalledOnce();
    expect(process.commands.some((value) => (value as WorkspaceCandidateProcessCommand).type === 'start')).toBe(false);
  });

  it.each(['prepare', 'assertGrant'] as const)('accepts the real child cancellation acknowledgement during %s', async (stage) => {
    const entered = deferred();
    const pending = deferred();
    const cancellation = new AbortController();
    const process = new FakeCandidateProcess();
    const invalidate = vi.fn();
    const reclaimAfterExit = vi.fn(async () => {});
    const runtimePromise = startWithReservation(process, {
      [stage]: async () => { entered.resolve(); await pending.promise; },
      invalidate, reclaimAfterExit,
    }, cancellation.signal);
    const rejected = expect(runtimePromise).rejects.toThrow('WORKSPACE_CANDIDATE_OPERATION_FAILED');
    const loadOperation = vi.fn(async () => { throw new Error('work must not load'); });
    startWorkspaceCandidateRunner({
      parentPort: {
        on(_event, callback) { process.onCommand = (data) => callback({ data }); },
        postMessage(value) { process.message(value); },
      },
      acquireReservation: async () => ({
        identity: 'a'.repeat(64), invalidated: new AbortController().signal,
        assertOwned: async () => {}, release: async () => {},
      }),
      loadOperation,
      exit(code) { process.exit(code); },
    });
    await entered.promise;
    cancellation.abort();
    expect(process.active).toBe(false);
    expect(reclaimAfterExit).not.toHaveBeenCalled();
    pending.resolve();
    await rejected;
    expect(reclaimAfterExit).toHaveBeenCalledOnce();
    expect(invalidate).not.toHaveBeenCalled();
    expect(loadOperation).not.toHaveBeenCalled();
  });

  it('latches a failed pending preparation even when its child has already exited', async () => {
    const entered = deferred();
    const completion = deferred();
    const invalidate = vi.fn();
    const reclaimAfterExit = vi.fn(async () => {});
    const process = new FakeCandidateProcess();
    const runtimePromise = startWithReservation(process, {
      prepare: async () => { entered.resolve(); await completion.promise; throw new Error('private preparation failure'); },
      invalidate, reclaimAfterExit,
    });
    const rejected = expect(runtimePromise).rejects.toThrow('WORKSPACE_CANDIDATE_OPERATION_FAILED');
    process.message(createWorkspaceCandidateReadyStatus());
    await entered.promise;
    process.exit(1);
    completion.resolve();
    await rejected;
    expect(invalidate).toHaveBeenCalledOnce();
    expect(reclaimAfterExit).not.toHaveBeenCalled();
  });

  it('checks the captured authority again after the asynchronous grant resolves', async () => {
    const checked = deferred();
    const grant = deferred();
    let current = true;
    const invalidate = vi.fn();
    const assertCurrent = vi.fn(() => { if (!current) throw new Error('authority replaced'); });
    const process = new FakeCandidateProcess();
    const runtimePromise = startWithReservation(process, {
      assertGrant: () => { checked.resolve(); return grant.promise; },
      assertCurrent, invalidate,
    });
    const rejected = expect(runtimePromise).rejects.toThrow('WORKSPACE_CANDIDATE_OPERATION_FAILED');
    process.message(createWorkspaceCandidateReservationReadyStatus(await process.prepare()));
    await checked.promise;
    grant.resolve();
    current = false;
    await process.waitForCommand('shutdown');
    process.exit(1);
    await rejected;
    expect(assertCurrent).toHaveBeenCalledOnce();
    expect(invalidate).toHaveBeenCalledOnce();
    expect(process.commands.some((value) => (value as WorkspaceCandidateProcessCommand).type === 'start')).toBe(false);
  });

  it('does not extend the stop budget when the system clock moves backwards', async () => {
    vi.useFakeTimers();
    const entered = deferred();
    const pending = deferred();
    const invalidate = vi.fn();
    const reclaimAfterExit = vi.fn(async () => {});
    const cancellation = new AbortController();
    const process = new FakeCandidateProcess();
    const runtimePromise = startWithReservation(process, {
      prepare: async () => { entered.resolve(); await pending.promise; },
      invalidate, reclaimAfterExit,
    }, cancellation.signal, { shutdownTimeoutMilliseconds: 20 });
    const rejected = expect(runtimePromise).rejects.toThrow('WORKSPACE_CANDIDATE_OPERATION_FAILED');
    process.message(createWorkspaceCandidateReadyStatus());
    await entered.promise;
    cancellation.abort();
    await vi.advanceTimersByTimeAsync(5);
    vi.setSystemTime(Date.now() - 60_000);
    process.exit(1);
    await vi.advanceTimersByTimeAsync(15);
    await rejected;
    expect(invalidate).toHaveBeenCalledOnce();
    expect(reclaimAfterExit).not.toHaveBeenCalled();
    pending.resolve();
    await vi.runAllTimersAsync();
  });

  it('uses one startup deadline across preparation and authorization and rejects a late grant', async () => {
    vi.useFakeTimers();
    const prepared = deferred();
    const granting = deferred();
    const grant = deferred();
    const invalidate = vi.fn();
    const process = new FakeCandidateProcess(true);
    const runtimePromise = startWithReservation(process, {
      prepare: () => prepared.promise,
      assertGrant: async () => { granting.resolve(); await grant.promise; },
      invalidate,
    }, undefined, { startupTimeoutMilliseconds: 100, shutdownTimeoutMilliseconds: 20 });
    const rejected = expect(runtimePromise).rejects.toThrow('WORKSPACE_CANDIDATE_OPERATION_FAILED');
    process.message(createWorkspaceCandidateReadyStatus());
    await vi.advanceTimersByTimeAsync(60);
    prepared.resolve();
    const prepare = await process.waitForCommand('prepare');
    process.message(createWorkspaceCandidateReservationReadyStatus(prepare));
    await granting.promise;
    await vi.advanceTimersByTimeAsync(40);
    expect(process.commands.filter(isShutdownCommand)).toHaveLength(1);
    grant.resolve();
    await vi.advanceTimersByTimeAsync(20);
    await rejected;
    expect(process.commands.some((value) => (value as WorkspaceCandidateProcessCommand).type === 'start')).toBe(false);
    expect(invalidate).toHaveBeenCalledOnce();
    expect(process.active).toBe(false);
  });

  it('keeps admission closed when a pending preparation cannot settle in the stop budget', async () => {
    vi.useFakeTimers();
    const entered = deferred();
    const pending = deferred();
    const invalidate = vi.fn();
    const reclaimAfterExit = vi.fn(async () => {});
    const cancellation = new AbortController();
    const process = new FakeCandidateProcess();
    const runtimePromise = startWithReservation(process, {
      prepare: async () => { entered.resolve(); await pending.promise; },
      invalidate, reclaimAfterExit,
    }, cancellation.signal, { shutdownTimeoutMilliseconds: 20 });
    const rejected = expect(runtimePromise).rejects.toThrow('WORKSPACE_CANDIDATE_OPERATION_FAILED');
    process.message(createWorkspaceCandidateReadyStatus());
    await entered.promise;
    cancellation.abort();
    process.exit(0);
    await vi.advanceTimersByTimeAsync(20);
    await rejected;
    expect(invalidate).toHaveBeenCalledOnce();
    pending.resolve();
    await vi.runAllTimersAsync();
    expect(reclaimAfterExit).not.toHaveBeenCalled();
    expect(process.commands.some((value) => (value as WorkspaceCandidateProcessCommand).type === 'prepare')).toBe(false);
  });

  it.each(['missingExit', 'reclaimFailure', 'reclaimTimeout'] as const)(
    'does not expose a completed result after %s', async (variant) => {
      vi.useFakeTimers();
      const reclaiming = deferred();
      const pending = deferred();
      const invalidate = vi.fn();
      let reclaimSignal: AbortSignal | undefined;
      const reclaimAfterExit = vi.fn(async (signal: AbortSignal) => {
        reclaimSignal = signal;
        reclaiming.resolve();
        if (variant === 'reclaimFailure') throw new Error('private reacquisition failure');
        await pending.promise;
      });
      const process = new FakeCandidateProcess();
      const runtimePromise = startWithReservation(process, { invalidate, reclaimAfterExit }, undefined,
        { shutdownTimeoutMilliseconds: 20 });
      process.message(completedInspection(await process.handshake()));
      const runtime = await runtimePromise;
      const stopped = runtime.stopAndProveHandlesClosed();
      if (variant !== 'missingExit') { process.exit(0); await reclaiming.promise; }
      await vi.advanceTimersByTimeAsync(40);
      await expect(stopped).resolves.toBe(false);
      await expect(runtime.inspectStoppedMigrationInspection()).rejects.toThrow('WORKSPACE_CANDIDATE_RESULT_UNAVAILABLE');
      expect(invalidate).toHaveBeenCalledOnce();
      if (variant === 'missingExit') {
        expect(reclaimAfterExit).not.toHaveBeenCalled();
        expect(process.killCount).toBe(1);
        process.exit(1);
      } else expect(reclaimSignal?.aborted).toBe(true);
      pending.resolve();
      await vi.runAllTimersAsync();
      await expect(runtime.stopAndProveHandlesClosed()).resolves.toBe(false);
    },
  );
});

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((complete) => { resolve = complete; });
  return { promise, resolve };
}

function startWithReservation(
  process: FakeCandidateProcess,
  overrides: Partial<Omit<WorkspaceCandidateReservationTransfer, 'descriptor'>>,
  signal?: AbortSignal,
  timeouts: { startupTimeoutMilliseconds?: number; shutdownTimeoutMilliseconds?: number } = {},
) {
  return createFactory(new RecordingCandidateSpawner(process), {
    reservationOwner: createReservationOwner(overrides),
    ...timeouts,
  }).startMigrationInspection({
    operationId: TEST_OPERATION_ID,
    databaseFilePath: candidatePaths().databaseFilePath,
    publishedRoot: candidatePaths().candidateRoot,
    expectedProfileId: profileId,
    ...(signal === undefined ? {} : { signal }),
  });
}

function completedInspection(start: Extract<WorkspaceCandidateProcessCommand, { type: 'start' }>) {
  return createWorkspaceCandidateCompletedStatus({
    ...start,
    result: { kind: 'migrationInspection', status: 'current', appliedMigrationCount: 38, pendingMigrationCount: 0 },
  });
}

function createFactory(
  processSpawner: WorkspaceCandidateProcessSpawner,
  overrides: {
    operationTimeoutMilliseconds?: number;
    reservationOwner?: WorkspaceCandidateReservationOwner;
    shutdownTimeoutMilliseconds?: number;
    startupTimeoutMilliseconds?: number;
  } = {},
) {
  return new ElectronWorkspaceCandidateRuntimeFactory({
    appVersion: '0.2.6',
    backendRoot: resolve('backend'),
    buildRevision: 'development',
    migrationsDirectory: resolve('backend', 'dist', 'database', 'migrations'),
    operationTimeoutMilliseconds:
      overrides.operationTimeoutMilliseconds ?? 1_000,
    processSpawner,
    reservationOwner: overrides.reservationOwner ?? createReservationOwner(),
    runnerPath: resolve('desktop-runtime', 'workspaceCandidateRunner.js'),
    shutdownTimeoutMilliseconds: overrides.shutdownTimeoutMilliseconds ?? 5,
    startupTimeoutMilliseconds: overrides.startupTimeoutMilliseconds ?? 1_000,
  });
}

function createReservationOwner(
  overrides: Partial<Omit<WorkspaceCandidateReservationTransfer, 'descriptor'>> = {},
): WorkspaceCandidateReservationOwner {
  return {
    bindCandidate({ generationId }) {
      return {
        descriptor: { generationId, identity: 'a'.repeat(64), userDataRoot: resolve('private-installation') },
        prepare: async () => {},
        assertGrant: async () => {},
        assertCurrent: () => {},
        reclaimAfterExit: async () => {},
        invalidate: () => {},
        ...overrides,
      };
    },
  };
}

function candidatePaths() {
  const candidateRoot = resolve('private-candidate');
  return {
    artifactRoot: resolve(candidateRoot, 'artifacts'),
    candidateRoot,
    databaseFilePath: resolve(candidateRoot, 'profile.sqlite'),
  };
}

function completedReadiness(
  request: Pick<
    Extract<WorkspaceCandidateProcessCommand, { type: 'start' }>,
    'operationId' | 'requestId' | 'runtimeSession'
  >,
) {
  return createWorkspaceCandidateCompletedStatus({
    ...request,
    result: {
      actorId: 'local-owner',
      artifactRootHealth: 'ready',
      companyId: 'local-company-1234567890abcdef1234567890abcdef',
      databaseHealth: 'healthy',
      foreignKeyHealth: 'healthy',
      kind: 'readiness',
      migrationChainIdentity,
      profileId,
    },
  });
}

function isShutdownCommand(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    value.type === 'shutdown'
  );
}

class RecordingCandidateSpawner implements WorkspaceCandidateProcessSpawner {
  environment: Readonly<Record<string, string>> | undefined;

  constructor(private readonly process: FakeCandidateProcess) {}

  spawn(options: {
    readonly environment: Readonly<Record<string, string>>;
    readonly runnerPath: string;
  }) {
    this.environment = options.environment;
    return this.process;
  }
}

class FakeCandidateProcess {
  active = true;
  onCommand: ((value: unknown) => void) | undefined;
  private errorListener: (() => void) | undefined;
  private exitListener: ((exitCode: number) => void) | undefined;
  private messageListener: ((value: unknown) => void) | undefined;
  readonly commands: unknown[] = [];
  killCount = 0;
  private commandListeners: Array<{
    type: WorkspaceCandidateProcessCommand['type'];
    resolve: (command: WorkspaceCandidateProcessCommand) => void;
  }> = [];

  constructor(private readonly exitWhenKilled = false) {}

  kill(): boolean {
    this.killCount += 1;
    if (this.exitWhenKilled) this.exit(1);
    return true;
  }

  onError(listener: () => void): void {
    this.errorListener = listener;
  }

  onExit(listener: (exitCode: number) => void): void {
    this.exitListener = listener;
  }

  onMessage(listener: (value: unknown) => void): void {
    this.messageListener = listener;
  }

  postMessage(value: unknown): void {
    this.commands.push(value);
    const command = value as WorkspaceCandidateProcessCommand;
    for (const listener of this.commandListeners.filter((entry) => entry.type === command.type)) {
      listener.resolve(command);
    }
    this.commandListeners = this.commandListeners.filter((entry) => entry.type !== command.type);
    this.onCommand?.(value);
  }

  error(): void {
    this.errorListener?.();
  }

  message(value: unknown): void {
    this.messageListener?.(value);
  }

  exit(exitCode: number): void {
    if (!this.active) return;
    this.active = false;
    this.exitListener?.(exitCode);
  }

  lastCommand(type: 'start'): Extract<WorkspaceCandidateProcessCommand, { type: 'start' }>;
  lastCommand(type: 'prepare'): Extract<WorkspaceCandidateProcessCommand, { type: 'prepare' }>;
  lastCommand(type: 'shutdown'): Extract<WorkspaceCandidateProcessCommand, { type: 'shutdown' }>;
  lastCommand(type: WorkspaceCandidateProcessCommand['type']): WorkspaceCandidateProcessCommand {
    const command = [...this.commands]
      .reverse()
      .find(
        (value): value is WorkspaceCandidateProcessCommand =>
          typeof value === 'object' &&
          value !== null &&
          'type' in value &&
          value.type === type,
      );
    if (command === undefined) throw new Error('test command missing');
    return command;
  }

  waitForCommand<T extends WorkspaceCandidateProcessCommand['type']>(type: T) {
    return new Promise<Extract<WorkspaceCandidateProcessCommand, { type: T }>>((resolveCommand) => {
      const command = this.commands.find((entry) => (entry as WorkspaceCandidateProcessCommand).type === type);
      if (command !== undefined) {
        resolveCommand(command as Extract<WorkspaceCandidateProcessCommand, { type: T }>);
      } else {
        this.commandListeners.push({ type, resolve: (value) => resolveCommand(value as Extract<WorkspaceCandidateProcessCommand, { type: T }>) });
      }
    });
  }

  async prepare() {
    this.message(createWorkspaceCandidateReadyStatus());
    return this.waitForCommand('prepare');
  }

  async handshake() {
    const prepare = await this.prepare();
    this.message(createWorkspaceCandidateReservationReadyStatus(prepare));
    return this.waitForCommand('start');
  }
}
