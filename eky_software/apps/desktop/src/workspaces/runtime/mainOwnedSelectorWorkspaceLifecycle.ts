import type { InMemoryWorkspaceMaintenanceLease } from '../maintenance/workspaceMaintenanceLease.js';
import type { WorkspaceId } from '../registry/workspaceRegistryTypes.js';
import type { ActiveWorkspaceLifecyclePort } from './activeWorkspaceLifecyclePort.js';
import type { DeferredWorkspaceRuntimeRelaunch } from './deferredWorkspaceRuntimeRelaunch.js';
import type { WorkspaceRuntimeAbsencePort } from './workspaceRuntimeAbsencePort.js';

interface SelectorLifecycleOptions {
  assertSelectorCurrent(): void;
  reservation: Readonly<{
    assertMainCurrent(): void;
    assertMainOwned(): Promise<void>;
  }>;
  maintenanceLease: Pick<InMemoryWorkspaceMaintenanceLease, 'captureCurrentOwner'>;
  runtimeRelaunch: DeferredWorkspaceRuntimeRelaunch;
}

/** One selector's management operation, using the existing physical owner. */
export class MainOwnedSelectorWorkspaceLifecycle
  implements ActiveWorkspaceLifecyclePort, WorkspaceRuntimeAbsencePort {
  private state: 'ready' | 'quiescing' | 'quiesced' | 'stopped' = 'ready';
  private failure: { readonly error: unknown } | undefined;
  private quiesceTask: Promise<void> | undefined;
  private assertOperationCurrent: (() => void) | undefined;
  private readonly assertSelectorCurrent: () => void;
  private readonly assertMainCurrent: () => void;
  private readonly assertMainOwned: () => Promise<void>;
  private readonly captureOwner: () => () => void;
  private readonly requestRelaunch: () => void;

  constructor(options: Readonly<SelectorLifecycleOptions>) {
    this.assertSelectorCurrent = options.assertSelectorCurrent.bind(options);
    this.assertMainCurrent = options.reservation.assertMainCurrent.bind(options.reservation);
    this.assertMainOwned = options.reservation.assertMainOwned.bind(options.reservation);
    const capture = options.maintenanceLease.captureCurrentOwner.bind(options.maintenanceLease);
    this.captureOwner = () => capture(['create', 'import', 'switch', 'delete']);
    this.requestRelaunch = options.runtimeRelaunch.request.bind(options.runtimeRelaunch);
  }

  async quiesceWrites(previousActiveWorkspaceId: WorkspaceId | null): Promise<void> {
    this.assertSelectorIdentity(previousActiveWorkspaceId);
    if (this.quiesceTask === undefined) {
      // Share reentrant calls, but bind the calling operation before yielding.
      this.quiesceTask = Promise.resolve().then(async () => {
        try {
          await this.proveMainOwned();
          this.assertCurrent();
          this.state = 'quiesced';
        } catch (error) { this.fail(error); }
      });
      try {
        this.assertNoFailure();
        this.assertOperationCurrent = this.captureOwner();
        this.assertCurrent();
        this.state = 'quiescing';
      } catch (error) { this.failure ??= { error }; }
    }
    await this.quiesceTask;
    this.assertCurrent();
  }

  async stopAndProveHandlesClosed(previousActiveWorkspaceId: WorkspaceId | null): Promise<{ readonly handlesClosed: true }> {
    this.assertSelectorIdentity(previousActiveWorkspaceId);
    this.assertNoFailure();
    if (this.state !== 'quiesced' && this.state !== 'stopped') {
      throw new Error('WORKSPACE_RUNTIME_LIFECYCLE_INVALID');
    }
    await this.proveMainOwned();
    this.assertCurrent();
    this.state = 'stopped';
    return Object.freeze({ handlesClosed: true as const });
  }

  async assertNoActiveWorkspaceRuntime(): Promise<void> {
    this.assertNoFailure();
    if (this.state !== 'stopped') throw new Error('WORKSPACE_RUNTIME_STILL_ACTIVE');
    // Candidate handoff/reclaim can occur after the first stop proof.
    await this.proveMainOwned();
    this.assertCurrent();
  }

  assertStoppedCurrent(): void {
    this.assertNoFailure();
    if (this.state !== 'stopped') throw new Error('WORKSPACE_RUNTIME_STILL_ACTIVE');
    this.assertCurrent();
  }

  async ensurePreviousWorkspaceRunning(previousActiveWorkspaceId: WorkspaceId | null): Promise<void> {
    this.assertSelectorIdentity(previousActiveWorkspaceId);
    await this.assertNoActiveWorkspaceRuntime();
    this.assertCurrent();
    this.requestRelaunch();
  }

  private async proveMainOwned(): Promise<void> {
    try {
      this.assertCurrent();
      await this.assertMainOwned();
      this.assertCurrent();
    } catch (error) { this.fail(error); }
  }

  private assertCurrent(): void {
    try {
      this.assertNoFailure();
      this.assertSynchronous(this.assertSelectorCurrent);
      if (this.assertOperationCurrent === undefined) throw new Error('WORKSPACE_RUNTIME_LIFECYCLE_INVALID');
      this.assertSynchronous(this.assertOperationCurrent);
      this.assertSynchronous(this.assertMainCurrent);
    } catch (error) { this.fail(error); }
  }

  private assertSynchronous(assert: () => void): void {
    const result: unknown = assert();
    if (result !== undefined) {
      void Promise.resolve(result).catch(() => undefined);
      throw new Error('WORKSPACE_RUNTIME_LIFECYCLE_INVALID');
    }
  }

  private assertNoFailure(): void {
    if (this.failure !== undefined) throw this.failure.error;
  }

  private fail(error: unknown): never {
    this.failure ??= { error };
    throw this.failure.error;
  }

  private assertSelectorIdentity(previousActiveWorkspaceId: WorkspaceId | null): void {
    if (previousActiveWorkspaceId !== null) throw new Error('WORKSPACE_RUNTIME_IDENTITY_MISMATCH');
  }
}
