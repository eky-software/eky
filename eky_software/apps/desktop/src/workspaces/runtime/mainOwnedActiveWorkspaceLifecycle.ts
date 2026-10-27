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
  disposeCapabilities(purpose?: 'delete'): Promise<void>;
  markCleanShutdown(): Promise<void>;
  sealAndDrainSecrets(): Promise<void>;
  deletion?: Readonly<{
    sealAndDrainArchive(): Promise<void>;
    stopBackend(operationId: string): Promise<void>;
  }>;
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

export const workspaceRuntimeStopPhases = Object.freeze([
  'quiescence', 'secrets', 'archive', 'scheduler', 'capabilities', 'backend', 'brokers', 'cleanMarker',
] as const);
export const workspaceRuntimeStopReasons = Object.freeze([
  'operationFailed', 'gracefulTimeout', 'forcedTimeout', 'unsuccessfulExit', 'notGraceful',
] as const);

interface WorkspaceRuntimeStopFailure {
  readonly phase: (typeof workspaceRuntimeStopPhases)[number];
  readonly reason: (typeof workspaceRuntimeStopReasons)[number];
}

type ProtectedStop = Readonly<{ kind: 'update' | 'delete'; operationId: string }>;
const sameStop = (left: ProtectedStop, right: ProtectedStop | undefined) =>
  left.kind === right?.kind && left.operationId === right.operationId;

export class WorkspaceRuntimeStopError extends Error {
  readonly firstFailure: Readonly<WorkspaceRuntimeStopFailure>;
  readonly cleanupFailures: readonly Readonly<WorkspaceRuntimeStopFailure>[];

  constructor(firstFailure: WorkspaceRuntimeStopFailure, cleanupFailures: readonly WorkspaceRuntimeStopFailure[] = []) {
    super(firstFailure.phase === 'quiescence' || firstFailure.phase === 'secrets' || firstFailure.phase === 'archive' || firstFailure.phase === 'scheduler'
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
  private quiesceTask: Promise<void> | undefined;
  private protectedStop: ProtectedStop | undefined;

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
    await this.quiesceRuntime();
  }

  async quiesceForDelete(previousActiveWorkspaceId: WorkspaceId, operationId: string): Promise<void> {
    this.assertActiveWorkspace(previousActiveWorkspaceId);
    this.claimDelete(operationId);
    await this.quiesceRuntime();
  }

  private claimDelete(operationId: string): void {
    const requested: ProtectedStop = { kind: 'delete', operationId };
    if (!isOperationId(operationId) || this.resources.deletion === undefined ||
        (this.protectedStop !== undefined && !sameStop(requested, this.protectedStop)) ||
        (this.protectedStop === undefined && (this.state !== 'active' || this.quiesceTask !== undefined || this.stopTask !== undefined))) {
      throw new WorkspaceRuntimeStopError({ phase: 'backend', reason: 'notGraceful' });
    }
    this.protectedStop ??= Object.freeze(requested);
  }

  private quiesceRuntime(): Promise<void> {
    if (this.quiesceTask !== undefined) return this.quiesceTask;
    if (this.state !== 'active') {
      return Promise.reject(new Error('WORKSPACE_RUNTIME_LIFECYCLE_INVALID'));
    }

    this.quiesceTask = Promise.resolve().then(async () => {
      const wait = async (phase: 'quiescence' | 'secrets' | 'archive' | 'scheduler', action: () => Promise<void>) => {
        try { await action(); }
        catch { throw new WorkspaceRuntimeStopError({ phase, reason: 'operationFailed' }); }
      };
      try {
        // Both existing owners start their budgets together; neither wait extends the other.
        const drains = [
          wait('secrets', () => this.resources.sealAndDrainSecrets()),
          wait('quiescence', () => this.requestQuiescence.quiesceAndWait()),
        ];
        if (this.protectedStop?.kind === 'delete') {
          drains.push(wait('archive', () => this.resources.deletion!.sealAndDrainArchive()));
          // Join the existing bounded owners; one early rejection cannot grant
          // absence while another main-owned drain is still pending.
          let firstFailure: unknown;
          await Promise.allSettled(drains.map(task => task.catch(error => { firstFailure ??= error; throw error; })));
          if (firstFailure !== undefined) throw firstFailure;
        } else {
          await Promise.all(drains);
        }
        await wait('scheduler', () => this.resources.stopRecoveryPointScheduler());
        this.state = 'quiesced';
      } catch (error) {
        this.requestQuiescence.stop();
        this.state = 'stopFailed';
        const failure = error instanceof WorkspaceRuntimeStopError ? error
          : new WorkspaceRuntimeStopError({ phase: 'quiescence', reason: 'operationFailed' });
        // An update stop may already be awaiting this preparation; do not join it recursively.
        const cleanup = Promise.resolve().then(() => this.closeRuntimeResources(
          this.protectedStop, failure,
        ));
        this.stopTask ??= cleanup;
        await cleanup;
        throw failure;
      }
    });
    return this.quiesceTask;
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
    if (await this.stopRuntime({ kind: 'update', operationId }) !== 'exited') {
      throw new WorkspaceRuntimeStopError({ phase: 'backend', reason: 'notGraceful' });
    }
  }

  async stopForDelete(previousActiveWorkspaceId: WorkspaceId, operationId: string): Promise<void> {
    this.assertActiveWorkspace(previousActiveWorkspaceId);
    this.claimDelete(operationId);
    if (await this.stopRuntime({ kind: 'delete', operationId }) !== 'exited') {
      throw new WorkspaceRuntimeStopError({ phase: 'backend', reason: 'notGraceful' });
    }
  }

  private stopRuntime(
    requested?: ProtectedStop,
  ): Promise<BackendShutdownOutcome> {
    if (this.stopTask !== undefined) {
      if (requested !== undefined && !sameStop(requested, this.protectedStop)) {
        return Promise.reject(new WorkspaceRuntimeStopError({ phase: 'backend', reason: 'notGraceful' }));
      }
      return this.stopTask;
    }
    if (requested !== undefined && this.protectedStop !== undefined && !sameStop(requested, this.protectedStop)) {
      return Promise.reject(new WorkspaceRuntimeStopError({ phase: 'backend', reason: 'notGraceful' }));
    }
    const selected = this.protectedStop ?? requested;
    if (this.state !== 'quiesced' && !(selected !== undefined && this.state === 'active')) {
      return Promise.reject(new Error('WORKSPACE_RUNTIME_LIFECYCLE_INVALID'));
    }

    // Share the first stop policy and its evidence before callbacks can re-enter.
    this.protectedStop = selected === undefined ? undefined : Object.freeze({ ...selected });
    this.stopTask = Promise.resolve().then(async () => {
      if (selected !== undefined && this.state === 'active') {
        await this.quiesceRuntime();
      }
      return this.closeRuntimeResources(selected);
    });
    return this.stopTask;
  }

  private async closeRuntimeResources(
    selected?: ProtectedStop,
    preparationFailure?: WorkspaceRuntimeStopError,
  ): Promise<BackendShutdownOutcome> {
    if (preparationFailure === undefined) this.state = 'stopping';
    const failures: WorkspaceRuntimeStopFailure[] = preparationFailure === undefined
      ? [] : [preparationFailure.firstFailure, ...preparationFailure.cleanupFailures];
    if (preparationFailure !== undefined && preparationFailure.firstFailure.phase !== 'scheduler') {
      try {
        await this.resources.stopRecoveryPointScheduler();
      } catch {
        failures.push({ phase: 'scheduler', reason: 'operationFailed' });
      }
    }
    let outcome: BackendShutdownOutcome | undefined;
    for (const [phase, close] of [
      ['capabilities', () => this.resources.disposeCapabilities(selected?.kind === 'delete' ? 'delete' : undefined)],
      ['backend', async () => {
        if (selected !== undefined) {
          if (selected.kind === 'delete') await this.resources.deletion!.stopBackend(selected.operationId);
          else await this.resources.stopBackendForUpdate(selected.operationId);
          outcome = 'exited';
        } else {
          outcome = await this.resources.stopBackend();
          if (outcome !== 'exited') {
            throw new WorkspaceRuntimeStopError({ phase: 'backend', reason: 'notGraceful' });
          }
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
            : error instanceof WorkspaceRuntimeStopError ? error.firstFailure.reason
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
      } catch (error) {
        this.state = 'stopFailed';
        if (error instanceof WorkspaceRuntimeStopError) throw error;
        throw new WorkspaceRuntimeStopError({ phase: 'cleanMarker', reason: 'operationFailed' });
      }
    }

    this.state = 'stopped';
    return outcome;
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
