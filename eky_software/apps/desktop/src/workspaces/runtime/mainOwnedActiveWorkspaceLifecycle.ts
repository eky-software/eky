import type { BackendRequestQuiescence } from '../../main/backendRequestQuiescence.js';
import type { WorkspaceId } from '../registry/workspaceRegistryTypes.js';
import { validateWorkspaceId } from '../registry/workspaceIdValidation.js';
import type { ActiveWorkspaceLifecyclePort } from './activeWorkspaceLifecyclePort.js';
import type { DeferredWorkspaceRuntimeRelaunch } from './deferredWorkspaceRuntimeRelaunch.js';
import type { WorkspaceRuntimeAbsencePort } from './workspaceRuntimeAbsencePort.js';

export interface MainOwnedWorkspaceRuntimeResources {
  closeBrokers(): Promise<void>;
  disposeCapabilities(): Promise<void>;
  stopBackend(): Promise<void>;
  stopRecoveryPointScheduler(): Promise<void>;
}

type WorkspaceRuntimeState =
  | 'active'
  | 'quiesced'
  | 'stopping'
  | 'stopped'
  | 'stopFailed';

export class MainOwnedActiveWorkspaceLifecycle
  implements ActiveWorkspaceLifecyclePort, WorkspaceRuntimeAbsencePort
{
  private state: WorkspaceRuntimeState = 'active';

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
    if (this.state === 'quiesced') return;
    if (this.state !== 'active') {
      throw new Error('WORKSPACE_RUNTIME_LIFECYCLE_INVALID');
    }

    await this.requestQuiescence.quiesceAndWait();
    try {
      await this.resources.stopRecoveryPointScheduler();
      this.state = 'quiesced';
    } catch {
      this.requestQuiescence.resume();
      throw new Error('WORKSPACE_RUNTIME_QUIESCE_FAILED');
    }
  }

  async stopAndProveHandlesClosed(
    previousActiveWorkspaceId: WorkspaceId | null,
  ): Promise<{ readonly handlesClosed: true }> {
    this.assertActiveWorkspace(previousActiveWorkspaceId);
    if (this.state === 'stopped') {
      return Object.freeze({ handlesClosed: true as const });
    }
    if (this.state !== 'quiesced') {
      throw new Error('WORKSPACE_RUNTIME_LIFECYCLE_INVALID');
    }

    this.state = 'stopping';
    const failures: unknown[] = [];
    for (const close of [
      () => this.resources.disposeCapabilities(),
      () => this.resources.stopBackend(),
      () => this.resources.closeBrokers(),
    ]) {
      try {
        await close();
      } catch (error) {
        failures.push(error);
      }
    }

    this.requestQuiescence.stop();
    if (failures.length !== 0) {
      this.state = 'stopFailed';
      throw new Error('WORKSPACE_RUNTIME_STOP_FAILED');
    }

    this.state = 'stopped';
    return Object.freeze({ handlesClosed: true as const });
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
