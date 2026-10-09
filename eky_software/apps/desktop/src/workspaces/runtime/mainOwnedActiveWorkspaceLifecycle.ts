import type { BackendRequestQuiescence } from '../../main/backendRequestQuiescence.js';
import { isOperationId } from '../../profileBackup/profileSnapshotBrokerProtocol.js';
import {
  BackendForcedShutdownTimeoutError,
  BackendGracefulShutdownTimeoutError,
  BackendShutdownExitError,
  type BackendShutdownOutcome,
} from '../../runtime/backendShutdown.js';
import type { WorkspaceId } from '../registry/workspaceRegistryTypes.js';
import { validateWorkspaceId } from '../registry/workspaceIdValidation.js';
import type { ActiveWorkspaceLifecyclePort } from './activeWorkspaceLifecyclePort.js';
import type { DeferredWorkspaceRuntimeRelaunch } from './deferredWorkspaceRuntimeRelaunch.js';
import type { WorkspaceRuntimeAbsencePort } from './workspaceRuntimeAbsencePort.js';

export interface MainOwnedWorkspaceRuntimeResources {
  closeBrokers(): Promise<void>;
  disposeCapabilities(): Promise<void>;
  markCleanShutdown(): Promise<void>;
  stopBackend(): Promise<BackendShutdownOutcome>;
  stopBackendForUpdate(operationId: string): Promise<void>;
  stopRecoveryPointScheduler(): Promise<void>;
}

type WorkspaceRuntimeState =
  | 'active'
  | 'quiesced'
  | 'stopping'
  | 'stopped'
  | 'stopFailed';

interface WorkspaceRuntimeStopFailure {
  readonly phase: 'quiescence' | 'scheduler' | 'capabilities' | 'backend' | 'brokers' | 'cleanMarker';
  readonly reason: 'operationFailed' | 'gracefulTimeout' | 'forcedTimeout' | 'unsuccessfulExit' | 'notGraceful';
}

export class WorkspaceRuntimeStopError extends Error {
  readonly firstFailure: Readonly<WorkspaceRuntimeStopFailure>;
  readonly cleanupFailures: readonly Readonly<WorkspaceRuntimeStopFailure>[];

  constructor(firstFailure: WorkspaceRuntimeStopFailure, cleanupFailures: readonly WorkspaceRuntimeStopFailure[] = []) {
    super(firstFailure.phase === 'quiescence' || firstFailure.phase === 'scheduler'
      ? 'WORKSPACE_RUNTIME_QUIESCE_FAILED' : 'WORKSPACE_RUNTIME_STOP_FAILED');
    this.name = 'WorkspaceRuntimeStopError';
    this.firstFailure = Object.freeze({ ...firstFailure });
    this.cleanupFailures = Object.freeze(cleanupFailures.map(failure => Object.freeze({ ...failure })));
  }
}

export class MainOwnedActiveWorkspaceLifecycle
  implements ActiveWorkspaceLifecyclePort, WorkspaceRuntimeAbsencePort
{
  private state: WorkspaceRuntimeState = 'active';
  private stopTask: Promise<BackendShutdownOutcome> | undefined;
  private updateStopOperationId: string | undefined;

  constructor(
    private readonly activeWorkspaceId: WorkspaceId,
    private readonly requestQuiescence: BackendRequestQuiescence,
    private readonly resources: Readonly<MainOwnedWorkspaceRuntimeResources>,
    private readonly runtimeRelaunch: DeferredWorkspaceRuntimeRelaunch,
  ) {}

  async quiesceWrites(
    previousActiveWorkspaceId: WorkspaceId | null,
  ): Promise<void> {
    this.assertActiveWorkspace(previousActiveWorkspaceId);
    await this.quiesceRuntime(true);
  }

  private async quiesceRuntime(resumeOnFailure: boolean): Promise<void> {
    if (this.state === 'quiesced') return;
    if (this.state !== 'active') {
      throw new Error('WORKSPACE_RUNTIME_LIFECYCLE_INVALID');
    }

    let phase: 'quiescence' | 'scheduler' = 'quiescence';
    try {
      await this.requestQuiescence.quiesceAndWait();
      phase = 'scheduler';
      await this.resources.stopRecoveryPointScheduler();
      this.state = 'quiesced';
    } catch {
      if (resumeOnFailure) {
        this.resumeWritesAfterQuiescenceFailure();
      } else {
        this.requestQuiescence.stop();
        this.state = 'stopFailed';
      }
      throw new WorkspaceRuntimeStopError({ phase, reason: 'operationFailed' });
    }
  }

  async stopAndProveHandlesClosed(
    previousActiveWorkspaceId: WorkspaceId | null,
  ): Promise<{ readonly handlesClosed: true }> {
    this.assertActiveWorkspace(previousActiveWorkspaceId);
    await this.stopRuntime();
    return Object.freeze({ handlesClosed: true as const });
  }

  async stopForUpdate(previousActiveWorkspaceId: WorkspaceId, operationId: string): Promise<void> {
    this.assertActiveWorkspace(previousActiveWorkspaceId);
    if (!isOperationId(operationId)) {
      throw new WorkspaceRuntimeStopError({ phase: 'backend', reason: 'notGraceful' });
    }
    if (await this.stopRuntime(operationId) !== 'exited') {
      throw new WorkspaceRuntimeStopError({ phase: 'backend', reason: 'notGraceful' });
    }
  }

  private stopRuntime(
    operationId?: string,
  ): Promise<BackendShutdownOutcome> {
    if (this.stopTask !== undefined) {
      if (operationId !== undefined && operationId !== this.updateStopOperationId) {
        return Promise.reject(new WorkspaceRuntimeStopError({ phase: 'backend', reason: 'notGraceful' }));
      }
      return this.stopTask;
    }
    if (this.state !== 'quiesced' && !(operationId !== undefined && this.state === 'active')) {
      return Promise.reject(new Error('WORKSPACE_RUNTIME_LIFECYCLE_INVALID'));
    }

    // Share the first stop policy and its evidence before callbacks can re-enter.
    this.updateStopOperationId = operationId;
    this.stopTask = Promise.resolve().then(async () => {
      if (operationId !== undefined && this.state === 'active') {
        await this.quiesceRuntime(false);
      }
      this.state = 'stopping';
      const failures: WorkspaceRuntimeStopFailure[] = [];
      let outcome: BackendShutdownOutcome | undefined;
      for (const [phase, close] of [
        ['capabilities', () => this.resources.disposeCapabilities()],
        ['backend', async () => {
          if (operationId !== undefined) {
            await this.resources.stopBackendForUpdate(operationId);
            outcome = 'exited';
          } else {
            outcome = await this.resources.stopBackend();
          }
        }],
        ['brokers', () => this.resources.closeBrokers()],
      ] as const) {
        try {
          await close();
        } catch (error) {
          failures.push({
            phase,
            reason: phase !== 'backend' ? 'operationFailed'
              : error instanceof BackendGracefulShutdownTimeoutError ? 'gracefulTimeout'
              : error instanceof BackendForcedShutdownTimeoutError ? 'forcedTimeout'
              : error instanceof BackendShutdownExitError ? 'unsuccessfulExit'
              : 'operationFailed',
          });
        }
      }

      this.requestQuiescence.stop();
      if (failures.length !== 0 || outcome === undefined) {
        this.state = 'stopFailed';
        throw new WorkspaceRuntimeStopError(
          failures[0] ?? { phase: 'backend', reason: 'operationFailed' },
          failures.slice(1),
        );
      }
      if (outcome === 'exited') {
        try {
          await this.resources.markCleanShutdown();
        } catch {
          this.state = 'stopFailed';
          throw new WorkspaceRuntimeStopError({ phase: 'cleanMarker', reason: 'operationFailed' });
        }
      }

      this.state = 'stopped';
      return outcome;
    });
    return this.stopTask;
  }

  async ensurePreviousWorkspaceRunning(
    previousActiveWorkspaceId: WorkspaceId | null,
  ): Promise<void> {
    this.assertActiveWorkspace(previousActiveWorkspaceId);
    if (this.state === 'active') return;
    if (this.state !== 'stopped') {
      throw new Error('WORKSPACE_RUNTIME_RECOVERY_REQUIRED');
    }
    this.runtimeRelaunch.request();
  }

  async assertNoActiveWorkspaceRuntime(): Promise<void> {
    if (this.state !== 'stopped') {
      throw new Error('WORKSPACE_RUNTIME_STILL_ACTIVE');
    }
  }

  readState(): WorkspaceRuntimeState {
    return this.state;
  }

  private resumeWritesAfterQuiescenceFailure(): void {
    try {
      this.requestQuiescence.resume();
    } catch {
      throw new Error('WORKSPACE_RUNTIME_RECOVERY_REQUIRED');
    }
  }

  private assertActiveWorkspace(
    previousActiveWorkspaceId: WorkspaceId | null,
  ): void {
    if (
      previousActiveWorkspaceId === null ||
      validateWorkspaceId(previousActiveWorkspaceId) !== this.activeWorkspaceId
    ) {
      throw new Error('WORKSPACE_RUNTIME_IDENTITY_MISMATCH');
    }
  }
}
