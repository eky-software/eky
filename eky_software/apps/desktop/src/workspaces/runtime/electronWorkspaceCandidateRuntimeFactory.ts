import { randomUUID } from 'node:crypto';

import { utilityProcess } from 'electron';

import { createDesktopBackendEnvironment } from '../../runtime/backendEnvironment.js';
import {
  createWorkspaceCandidateShutdownCommand,
  createWorkspaceCandidateStartCommand,
  parseWorkspaceCandidateProcessStatus,
  type WorkspaceCandidateProcessCommand,
  type WorkspaceCandidateProcessOperation,
  type WorkspaceCandidateProcessResult,
} from '../../runtime/workspaceCandidateMessages.js';
import { createDesktopRuntimeSession } from '../../runtime/runtimeSession.js';
import type {
  EmptyWorkspaceBootstrapInput,
  EmptyWorkspaceBootstrapResult,
  PublishedWorkspaceValidationInput,
} from '../creation/emptyWorkspaceCreationPorts.js';
import type {
  PrivateEmptyWorkspaceBootstrapRuntime,
  PrivateEmptyWorkspaceBootstrapRuntimeFactory,
  PrivatePublishedWorkspaceValidationRuntimeFactory,
} from '../creation/privateEmptyWorkspaceBootstrapAdapter.js';
import type {
  PublishedWorkspaceBackupValidationInput,
  WorkspaceBackupCandidateMigrationInput,
  WorkspaceBackupCandidateMigrationResult,
  WorkspaceBackupCandidateReadiness,
  WorkspaceBackupCandidateValidationInput,
} from '../import/workspaceBackupImportPorts.js';
import type {
  PrivateWorkspaceBackupCandidateRuntime,
  PrivateWorkspaceBackupCandidateRuntimeFactory,
} from '../import/privateWorkspaceBackupCandidateAdapter.js';
import type {
  PrivateWorkspaceMigrationInspectionRuntime,
  PrivateWorkspaceMigrationInspectionRuntimeFactory,
  WorkspaceMigrationInspectionInput,
  WorkspaceMigrationInspectionResult,
} from '../update/workspaceMigrationInventoryTypes.js';

const startupTimeoutMilliseconds = 10_000;
const operationTimeoutMilliseconds = 5 * 60_000;
const shutdownTimeoutMilliseconds = 3_000;
const operationFailedCode = 'WORKSPACE_CANDIDATE_OPERATION_FAILED';

interface WorkspaceCandidateProcessHandle {
  kill(): boolean;
  onError(listener: () => void): void;
  onExit(listener: (exitCode: number) => void): void;
  onMessage(listener: (value: unknown) => void): void;
  postMessage(value: unknown): void;
}

export interface WorkspaceCandidateProcessSpawner {
  spawn(options: {
    readonly environment: Readonly<Record<string, string>>;
    readonly runnerPath: string;
  }): WorkspaceCandidateProcessHandle;
}

export interface ElectronWorkspaceCandidateRuntimeFactoryOptions {
  readonly appVersion: string;
  readonly backendRoot: string;
  readonly buildRevision: string;
  readonly migrationsDirectory: string;
  readonly operationTimeoutMilliseconds?: number;
  readonly processSpawner?: WorkspaceCandidateProcessSpawner;
  readonly runnerPath: string;
  readonly shutdownTimeoutMilliseconds?: number;
  readonly startupTimeoutMilliseconds?: number;
}

export class ElectronWorkspaceCandidateRuntimeFactory
  implements
    PrivateEmptyWorkspaceBootstrapRuntimeFactory,
    PrivatePublishedWorkspaceValidationRuntimeFactory,
    PrivateWorkspaceBackupCandidateRuntimeFactory,
    PrivateWorkspaceMigrationInspectionRuntimeFactory
{
  private readonly processSpawner: WorkspaceCandidateProcessSpawner;

  constructor(
    private readonly options: Readonly<ElectronWorkspaceCandidateRuntimeFactoryOptions>,
  ) {
    this.processSpawner = options.processSpawner ?? electronCandidateProcessSpawner;
  }

  start(
    input: Readonly<EmptyWorkspaceBootstrapInput>,
  ): Promise<PrivateEmptyWorkspaceBootstrapRuntime> {
    return this.startReadinessRuntime(input.operationId, {
      ...this.common(input),
      operation: 'bootstrapEmpty',
    });
  }

  startForValidation(
    input: Readonly<PublishedWorkspaceValidationInput>,
  ): Promise<PrivateEmptyWorkspaceBootstrapRuntime> {
    return this.startReadinessRuntime(input.operationId, {
      ...this.common({
        artifactRoot: input.artifactRoot,
        candidateRoot: input.publishedRoot,
        databaseFilePath: input.databaseFilePath,
      }),
      operation: 'validatePublished',
    });
  }

  startMigration(
    input: Readonly<WorkspaceBackupCandidateMigrationInput>,
  ): Promise<PrivateWorkspaceBackupCandidateRuntime> {
    return this.startMigrationRuntime(input.operationId, {
      ...this.common(input),
      expectedProfileId: input.expectedProfileId,
      expectedSourceMigrationChainIdentity:
        input.expectedSourceMigrationChainIdentity,
      importStagingRoot: input.importStagingRoot,
      operation: 'migrateBackup',
    });
  }

  startValidation(
    input: Readonly<WorkspaceBackupCandidateValidationInput>,
  ): Promise<PrivateWorkspaceBackupCandidateRuntime> {
    return this.startReadinessRuntime(input.operationId, {
      ...this.common(input),
      expectedProfileId: input.expectedProfileId,
      importStagingRoot: input.importStagingRoot,
      operation: 'validateAndMaterialize',
    });
  }

  startPublishedValidation(
    input: Readonly<PublishedWorkspaceBackupValidationInput>,
  ): Promise<PrivateWorkspaceBackupCandidateRuntime> {
    return this.startReadinessRuntime(input.operationId, {
      ...this.common({
        artifactRoot: input.artifactRoot,
        candidateRoot: input.publishedRoot,
        databaseFilePath: input.databaseFilePath,
      }),
      expectedProfileId: input.expectedProfileId,
      operation: 'validatePublished',
    });
  }

  startMigrationInspection(
    input: Readonly<WorkspaceMigrationInspectionInput>,
  ): Promise<PrivateWorkspaceMigrationInspectionRuntime> {
    return this.startMigrationInspectionRuntime(
      input.operationId,
      {
        appVersion: this.options.appVersion,
        backendRoot: this.options.backendRoot,
        buildRevision: this.options.buildRevision,
        databaseFilePath: input.databaseFilePath,
        expectedProfileId: input.expectedProfileId,
        migrationsDirectory: this.options.migrationsDirectory,
        operation: 'inspectPublishedMigration',
        publishedRoot: input.publishedRoot,
      },
      input.signal,
    );
  }

  private common(input: {
    readonly artifactRoot: string;
    readonly candidateRoot: string;
    readonly databaseFilePath: string;
  }) {
    return {
      appVersion: this.options.appVersion,
      artifactRoot: input.artifactRoot,
      backendRoot: this.options.backendRoot,
      buildRevision: this.options.buildRevision,
      candidateRoot: input.candidateRoot,
      databaseFilePath: input.databaseFilePath,
      migrationsDirectory: this.options.migrationsDirectory,
    } as const;
  }

  private async startMigrationRuntime(
    operationId: string,
    operation: WorkspaceCandidateProcessOperation,
  ): Promise<PrivateWorkspaceBackupCandidateRuntime> {
    const runtime = await this.startOperation(operationId, operation);
    return {
      inspectStoppedMigrationResult: async () =>
        mapMigrationResult(runtime.inspectStoppedResult()),
      stopAndProveHandlesClosed: () => runtime.stopAndProveHandlesClosed(),
    };
  }

  private async startReadinessRuntime(
    operationId: string,
    operation: WorkspaceCandidateProcessOperation,
  ): Promise<
    PrivateEmptyWorkspaceBootstrapRuntime &
      PrivateWorkspaceBackupCandidateRuntime
  > {
    const runtime = await this.startOperation(operationId, operation);
    return {
      inspectStoppedReadiness: async () =>
        mapReadinessResult(runtime.inspectStoppedResult()),
      stopAndProveHandlesClosed: () => runtime.stopAndProveHandlesClosed(),
    };
  }

  private async startMigrationInspectionRuntime(
    operationId: string,
    operation: WorkspaceCandidateProcessOperation,
    signal?: AbortSignal,
  ): Promise<PrivateWorkspaceMigrationInspectionRuntime> {
    const runtime = await this.startOperation(operationId, operation, signal);
    return {
      inspectStoppedMigrationInspection: async () =>
        mapMigrationInspectionResult(runtime.inspectStoppedResult()),
      stopAndProveHandlesClosed: () => runtime.stopAndProveHandlesClosed(),
    };
  }

  private async startOperation(
    operationId: string,
    operation: WorkspaceCandidateProcessOperation,
    signal?: AbortSignal,
  ): Promise<ManagedWorkspaceCandidateRuntime> {
    if (isAbortRequested(signal)) {
      throw new Error(operationFailedCode);
    }
    const runtimeSession = createDesktopRuntimeSession();
    const requestId = randomUUID();
    const startCommand = createWorkspaceCandidateStartCommand({
      operation,
      operationId,
      requestId,
      runtimeSession,
    });
    const shutdownCommand = createWorkspaceCandidateShutdownCommand({
      operationId,
      requestId,
      runtimeSession,
    });
    let processHandle: WorkspaceCandidateProcessHandle;
    try {
      processHandle = this.processSpawner.spawn({
        environment: createDesktopBackendEnvironment(),
        runnerPath: this.options.runnerPath,
      });
    } catch {
      throw new Error(operationFailedCode);
    }
    const runtime = new ManagedWorkspaceCandidateRuntime({
      operationTimeoutMilliseconds:
        this.options.operationTimeoutMilliseconds ??
        operationTimeoutMilliseconds,
      processHandle,
      shutdownCommand,
      shutdownTimeoutMilliseconds:
        this.options.shutdownTimeoutMilliseconds ??
        shutdownTimeoutMilliseconds,
      startCommand,
      startupTimeoutMilliseconds:
        this.options.startupTimeoutMilliseconds ?? startupTimeoutMilliseconds,
    });
    const abortRuntime = (): void => {
      void runtime.stopAfterStartFailure();
    };
    signal?.addEventListener('abort', abortRuntime, { once: true });
    try {
      await runtime.start();
      if (isAbortRequested(signal)) {
        throw new Error(operationFailedCode);
      }
      return runtime;
    } catch {
      await runtime.stopAfterStartFailure();
      throw new Error(operationFailedCode);
    } finally {
      signal?.removeEventListener('abort', abortRuntime);
    }
  }
}

function isAbortRequested(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}

type RuntimePhase =
  | 'created'
  | 'waitingReady'
  | 'waitingTerminal'
  | 'completed'
  | 'failed'
  | 'exited';

class ManagedWorkspaceCandidateRuntime {
  private activeTimer: ReturnType<typeof setTimeout> | undefined;
  private completedResult: WorkspaceCandidateProcessResult | undefined;
  private completedTerminalReceived = false;
  private exitCode: number | undefined;
  private exited = false;
  private readonly exitPromise: Promise<void>;
  private phase: RuntimePhase = 'created';
  private protocolValid = true;
  private rejectStart: ((error: Error) => void) | undefined;
  private resolveExit!: () => void;
  private resolveStart: (() => void) | undefined;
  private shutdownSent = false;
  private startSettled = false;
  private stopPromise: Promise<boolean> | undefined;
  private terminalSeen = false;

  constructor(
    private readonly options: {
      readonly operationTimeoutMilliseconds: number;
      readonly processHandle: WorkspaceCandidateProcessHandle;
      readonly shutdownCommand: Extract<
        WorkspaceCandidateProcessCommand,
        { type: 'shutdown' }
      >;
      readonly shutdownTimeoutMilliseconds: number;
      readonly startCommand: Extract<
        WorkspaceCandidateProcessCommand,
        { type: 'start' }
      >;
      readonly startupTimeoutMilliseconds: number;
    },
  ) {
    this.exitPromise = new Promise<void>((resolve) => {
      this.resolveExit = resolve;
    });
    options.processHandle.onError(() => this.failClosed());
    options.processHandle.onExit((exitCode) => this.handleExit(exitCode));
    options.processHandle.onMessage((value) => this.handleMessage(value));
  }

  start(): Promise<void> {
    if (this.phase !== 'created') {
      return Promise.reject(new Error(operationFailedCode));
    }
    this.phase = 'waitingReady';
    this.setTimer(
      this.options.startupTimeoutMilliseconds,
      () => this.failClosed(),
    );
    return new Promise((resolve, reject) => {
      this.resolveStart = resolve;
      this.rejectStart = reject;
    });
  }

  stopAfterStartFailure(): Promise<boolean> {
    this.stopPromise ??= this.stop();
    return this.stopPromise;
  }

  stopAndProveHandlesClosed(): Promise<boolean> {
    this.stopPromise ??= this.stop();
    return this.stopPromise;
  }

  inspectStoppedResult(): WorkspaceCandidateProcessResult {
    if (
      !this.exited ||
      this.exitCode !== 0 ||
      !this.protocolValid ||
      !this.completedTerminalReceived ||
      this.completedResult === undefined
    ) {
      throw new Error('WORKSPACE_CANDIDATE_RESULT_UNAVAILABLE');
    }
    return this.completedResult;
  }

  private handleMessage(value: unknown): void {
    if (this.exited) return;
    const status = parseWorkspaceCandidateProcessStatus(value);
    if (status === undefined) {
      this.failClosed();
      return;
    }

    if (status.type === 'ready') {
      if (this.phase !== 'waitingReady') {
        this.failClosed();
        return;
      }
      this.clearTimer();
      this.phase = 'waitingTerminal';
      try {
        this.options.processHandle.postMessage(this.options.startCommand);
      } catch {
        this.failClosed();
        return;
      }
      this.setTimer(
        this.options.operationTimeoutMilliseconds,
        () => this.failClosed(),
      );
      return;
    }

    if (
      this.phase !== 'waitingTerminal' ||
      this.terminalSeen ||
      !this.statusMatchesRequest(status)
    ) {
      this.failClosed();
      return;
    }
    this.terminalSeen = true;
    this.clearTimer();
    if (status.type === 'failed') {
      this.failOperation();
      return;
    }

    this.completedTerminalReceived = true;
    this.completedResult = status.result;
    this.phase = 'completed';
    this.settleStartSuccess();
  }

  private handleExit(exitCode: number): void {
    if (this.exited) return;
    this.exited = true;
    this.exitCode = exitCode;
    this.clearTimer();
    if (
      !this.completedTerminalReceived ||
      !this.shutdownSent ||
      exitCode !== 0
    ) {
      this.protocolValid = false;
      this.completedResult = undefined;
      this.settleStartFailure();
    }
    this.phase = 'exited';
    this.resolveExit();
  }

  private statusMatchesRequest(status: {
    readonly operationId: string;
    readonly requestId: string;
    readonly runtimeSession: string;
  }): boolean {
    return (
      status.operationId === this.options.startCommand.operationId &&
      status.requestId === this.options.startCommand.requestId &&
      status.runtimeSession === this.options.startCommand.runtimeSession
    );
  }

  private failOperation(): void {
    this.completedResult = undefined;
    this.phase = 'failed';
    this.settleStartFailure();
    void this.stopAfterStartFailure();
  }

  private failClosed(): void {
    if (this.exited) return;
    this.protocolValid = false;
    this.completedResult = undefined;
    this.phase = 'failed';
    this.clearTimer();
    this.settleStartFailure();
    void this.stopAfterStartFailure();
  }

  private settleStartSuccess(): void {
    if (this.startSettled) return;
    this.startSettled = true;
    this.resolveStart?.();
  }

  private settleStartFailure(): void {
    if (this.startSettled) return;
    this.startSettled = true;
    this.rejectStart?.(new Error(operationFailedCode));
  }

  private setTimer(timeoutMilliseconds: number, action: () => void): void {
    this.clearTimer();
    this.activeTimer = setTimeout(action, timeoutMilliseconds);
  }

  private clearTimer(): void {
    if (this.activeTimer !== undefined) {
      clearTimeout(this.activeTimer);
      this.activeTimer = undefined;
    }
  }

  private sendShutdown(): void {
    if (this.shutdownSent || this.exited) return;
    this.shutdownSent = true;
    try {
      this.options.processHandle.postMessage(this.options.shutdownCommand);
    } catch {
      this.options.processHandle.kill();
    }
  }

  private async stop(): Promise<boolean> {
    this.clearTimer();
    if (!this.exited) {
      this.sendShutdown();
      if (
        !(await waitForExit(
          this.exitPromise,
          this.options.shutdownTimeoutMilliseconds,
        ))
      ) {
        this.options.processHandle.kill();
        await waitForExit(
          this.exitPromise,
          this.options.shutdownTimeoutMilliseconds,
        );
      }
    }
    return (
      this.exited &&
      this.exitCode === 0 &&
      this.protocolValid &&
      this.completedTerminalReceived &&
      this.completedResult !== undefined
    );
  }
}

function mapMigrationResult(
  value: WorkspaceCandidateProcessResult,
): Readonly<WorkspaceBackupCandidateMigrationResult> {
  if (value.kind !== 'migration') {
    throw new Error('WORKSPACE_CANDIDATE_RESULT_INVALID');
  }
  return Object.freeze({
    handlesClosed: true,
    migrationChainIdentity: value.migrationChainIdentity,
    profileId: value.profileId,
  });
}

function mapMigrationInspectionResult(
  value: WorkspaceCandidateProcessResult,
): Readonly<WorkspaceMigrationInspectionResult> {
  if (value.kind !== 'migrationInspection') {
    throw new Error('WORKSPACE_CANDIDATE_RESULT_INVALID');
  }
  return Object.freeze({
    appliedMigrationCount: value.appliedMigrationCount,
    pendingMigrationCount: value.pendingMigrationCount,
    status: value.status,
  });
}

function mapReadinessResult(
  value: WorkspaceCandidateProcessResult,
): Readonly<
  EmptyWorkspaceBootstrapResult & WorkspaceBackupCandidateReadiness
> {
  if (value.kind !== 'readiness') {
    throw new Error('WORKSPACE_CANDIDATE_RESULT_INVALID');
  }
  return Object.freeze({
    actorId: value.actorId,
    artifactRootHealth: value.artifactRootHealth,
    companyId: value.companyId,
    databaseHealth: value.databaseHealth,
    foreignKeyHealth: value.foreignKeyHealth,
    handlesClosed: true,
    lineageIdentity: Object.freeze({
      formatVersion: 1,
      profileId: value.profileId,
    }),
    migrationChainIdentity: value.migrationChainIdentity,
    migrationState: 'current',
  });
}

function waitForExit(
  exitPromise: Promise<void>,
  timeoutMilliseconds: number,
): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), timeoutMilliseconds);
    void exitPromise.then(() => {
      clearTimeout(timer);
      resolve(true);
    });
  });
}

const electronCandidateProcessSpawner: WorkspaceCandidateProcessSpawner = {
  spawn(options) {
    const processHandle = utilityProcess.fork(options.runnerPath, [], {
      env: { ...options.environment },
      serviceName: 'Eky Workspace Candidate',
      stdio: 'ignore',
    });
    return {
      kill: () => processHandle.kill(),
      onError(listener) {
        processHandle.once('error', () => listener());
      },
      onExit(listener) {
        processHandle.once('exit', listener);
      },
      onMessage(listener) {
        processHandle.on('message', listener);
      },
      postMessage(value) {
        processHandle.postMessage(value);
      },
    };
  },
};
