import {
  EmptyWorkspaceCreationError,
  mapEmptyWorkspaceCreationError,
} from './emptyWorkspaceCreationError.js';
import type {
  EmptyWorkspaceBootstrapInput,
  EmptyWorkspaceBootstrapPort,
  EmptyWorkspaceBootstrapResult,
  PublishedWorkspaceValidationInput,
  PublishedWorkspaceValidationPort,
} from './emptyWorkspaceCreationPorts.js';
import { validateEmptyWorkspaceBootstrapResult } from './emptyWorkspaceBootstrapResult.js';

export interface PrivateEmptyWorkspaceBootstrapRuntime {
  inspectStoppedReadiness(): Promise<Readonly<EmptyWorkspaceBootstrapResult>>;
  stopAndProveHandlesClosed(): Promise<boolean>;
}

export interface PrivateEmptyWorkspaceBootstrapRuntimeFactory {
  start(
    input: Readonly<EmptyWorkspaceBootstrapInput>,
  ): Promise<PrivateEmptyWorkspaceBootstrapRuntime>;
}

export class PrivateEmptyWorkspaceBootstrapAdapter
  implements EmptyWorkspaceBootstrapPort {
  constructor(
    private readonly runtimeFactory: PrivateEmptyWorkspaceBootstrapRuntimeFactory,
  ) {}

  async bootstrap(
    input: Readonly<EmptyWorkspaceBootstrapInput>,
  ): Promise<Readonly<EmptyWorkspaceBootstrapResult>> {
    let runtime: PrivateEmptyWorkspaceBootstrapRuntime | undefined;
    let handlesClosed = false;
    let readiness: Readonly<EmptyWorkspaceBootstrapResult> | undefined;
    try {
      runtime = await this.runtimeFactory.start(input);
      handlesClosed = await runtime.stopAndProveHandlesClosed();
      if (!handlesClosed) {
        throw new EmptyWorkspaceCreationError(
          'WORKSPACE_CREATION_BOOTSTRAP_FAILED',
          'bootstrap',
        );
      }
      readiness = await runtime.inspectStoppedReadiness();
    } catch (error) {
      throw mapEmptyWorkspaceCreationError(
        error,
        'WORKSPACE_CREATION_BOOTSTRAP_FAILED',
        'bootstrap',
      );
    } finally {
      if (runtime !== undefined && !handlesClosed) {
        const cleanupClosedHandles = await runtime
          .stopAndProveHandlesClosed()
          .catch(() => false);
        if (!cleanupClosedHandles) {
          throw new EmptyWorkspaceCreationError(
            'WORKSPACE_CREATION_BOOTSTRAP_FAILED',
            'bootstrap',
          );
        }
      }
    }
    if (readiness === undefined) {
      throw new EmptyWorkspaceCreationError(
        'WORKSPACE_CREATION_BOOTSTRAP_FAILED',
        'bootstrap',
      );
    }
    return validateEmptyWorkspaceBootstrapResult({
      ...readiness,
      handlesClosed,
    });
  }
}

export class PrivatePublishedWorkspaceValidationAdapter
  implements PublishedWorkspaceValidationPort {
  constructor(
    private readonly runtimeFactory: PrivatePublishedWorkspaceValidationRuntimeFactory,
  ) {}

  async validatePublished(
    input: Readonly<PublishedWorkspaceValidationInput>,
  ): Promise<Readonly<EmptyWorkspaceBootstrapResult>> {
    let runtime: PrivateEmptyWorkspaceBootstrapRuntime | undefined;
    let handlesClosed = false;
    let readiness: Readonly<EmptyWorkspaceBootstrapResult> | undefined;
    try {
      runtime = await this.runtimeFactory.startForValidation(input);
      handlesClosed = await runtime.stopAndProveHandlesClosed();
      if (!handlesClosed) {
        throw new EmptyWorkspaceCreationError(
          'WORKSPACE_CREATION_RECOVERY_REQUIRED',
          'recovery',
        );
      }
      readiness = await runtime.inspectStoppedReadiness();
    } catch (error) {
      throw mapEmptyWorkspaceCreationError(
        error,
        'WORKSPACE_CREATION_RECOVERY_REQUIRED',
        'recovery',
      );
    } finally {
      if (runtime !== undefined && !handlesClosed) {
        const cleanupClosedHandles = await runtime
          .stopAndProveHandlesClosed()
          .catch(() => false);
        if (!cleanupClosedHandles) {
          throw new EmptyWorkspaceCreationError(
            'WORKSPACE_CREATION_RECOVERY_REQUIRED',
            'recovery',
          );
        }
      }
    }
    if (readiness === undefined) {
      throw new EmptyWorkspaceCreationError(
        'WORKSPACE_CREATION_RECOVERY_REQUIRED',
        'recovery',
      );
    }
    return validateEmptyWorkspaceBootstrapResult({
      ...readiness,
      handlesClosed,
    });
  }
}

export interface PrivatePublishedWorkspaceValidationRuntimeFactory {
  startForValidation(
    input: Readonly<PublishedWorkspaceValidationInput>,
  ): Promise<PrivateEmptyWorkspaceBootstrapRuntime>;
}
