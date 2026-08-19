import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  createWorkspaceCandidateCompletedStatus,
  createWorkspaceCandidateFailedStatus,
  createWorkspaceCandidateReadyStatus,
  type WorkspaceCandidateProcessCommand,
} from '../../runtime/workspaceCandidateMessages.js';
import {
  ElectronWorkspaceCandidateRuntimeFactory,
  type WorkspaceCandidateProcessSpawner,
} from './electronWorkspaceCandidateRuntimeFactory.js';
import {
  TEST_OPERATION_ID,
  TEST_WORKSPACE_ID,
} from '../creation/emptyWorkspaceCreationTestSupport.js';
import { TEST_IMPORT_OPERATION_ID } from '../import/workspaceBackupImportTestSupport.js';

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
    process.message(createWorkspaceCandidateReadyStatus());
    const start = process.lastCommand('start');
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

    process.message(createWorkspaceCandidateReadyStatus());
    const start = process.lastCommand('start');
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

  it('rejects a differently scoped terminal result without leaving an orphan', async () => {
    const process = new FakeCandidateProcess();
    const factory = createFactory(new RecordingCandidateSpawner(process));
    const runtimePromise = factory.start({
      operationId: TEST_OPERATION_ID,
      workspaceId: TEST_WORKSPACE_ID,
      ...candidatePaths(),
    });

    process.message(createWorkspaceCandidateReadyStatus());
    const start = process.lastCommand('start');
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
    duplicateProcess.message(createWorkspaceCandidateReadyStatus());
    const start = duplicateProcess.lastCommand('start');
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
    failedProcess.message(createWorkspaceCandidateReadyStatus());
    const failedStart = failedProcess.lastCommand('start');
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
    operationProcess.message(createWorkspaceCandidateReadyStatus());
    await expect(operationPromise).rejects.toThrow(
      'WORKSPACE_CANDIDATE_OPERATION_FAILED',
    );
    expect(operationProcess.killCount).toBe(1);
    expect(operationProcess.active).toBe(false);
  });
});

function createFactory(
  processSpawner: WorkspaceCandidateProcessSpawner,
  overrides: {
    operationTimeoutMilliseconds?: number;
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
    runnerPath: resolve('desktop-runtime', 'workspaceCandidateRunner.js'),
    shutdownTimeoutMilliseconds: 5,
    startupTimeoutMilliseconds: overrides.startupTimeoutMilliseconds ?? 1_000,
  });
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
  private errorListener: (() => void) | undefined;
  private exitListener: ((exitCode: number) => void) | undefined;
  private messageListener: ((value: unknown) => void) | undefined;
  readonly commands: unknown[] = [];
  killCount = 0;

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
  lastCommand(type: 'shutdown'): Extract<WorkspaceCandidateProcessCommand, { type: 'shutdown' }>;
  lastCommand(type: 'shutdown' | 'start'): WorkspaceCandidateProcessCommand {
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
}
