import { randomUUID } from 'node:crypto';

import { profileInspectionWorkMilliseconds } from '../runtime/profileInspectionMessages.js';

import {
  createProfileSnapshotBrokerRequest,
  isProfileSnapshotBrokerReadyCandidate,
  parseProfileSnapshotBrokerReady,
  parseProfileSnapshotBrokerResponse,
  readProfileSnapshotBrokerRequestId,
  type ProfileMaintenanceBrokerOperation,
  type ProfileSnapshotBrokerErrorCode,
  type ProfileSnapshotMigrationPolicy,
  type ProfileSnapshotBrokerResponse,
  type ProfileInspectionBrokerContext,
  type ProfileInspectionContextKind,
} from './profileSnapshotBrokerProtocol.js';
import type { ProfileSnapshotBrokerTransport } from './profileSnapshotBrokerTransport.js';

const defaultRequestTimeoutMilliseconds = profileInspectionWorkMilliseconds;

interface ContextRequestBoundary {
  readonly deadline: number;
  readonly kind: ProfileInspectionContextKind;
  readonly signal: AbortSignal;
}

type ProfileSnapshotBrokerSuccessResult = Extract<
  ProfileSnapshotBrokerResponse,
  { ok: true }
>['result'];

export class ProfileSnapshotBrokerError extends Error {
  constructor(readonly code: ProfileSnapshotBrokerErrorCode) {
    super(code);
    this.name = 'ProfileSnapshotBrokerError';
  }
}

export class ProfileSnapshotBrokerClient {
  private closed = false;
  private readonly pending = new Map<
    string,
    {
      reject(error: Error): void;
      resolve(result: ProfileSnapshotBrokerSuccessResult): void;
      dispose(): void;
    }
  >();
  private unsubscribe: () => void = () => undefined;
  private unsubscribeClose: () => void = () => undefined;
  private ready = false;
  private readyPromise: Promise<void>;
  private rejectReady!: (error: Error) => void;
  private resolveReady!: () => void;
  private readyTimer: ReturnType<typeof setTimeout>;

  constructor(
    private readonly transport: ProfileSnapshotBrokerTransport,
    private readonly requestTimeoutMilliseconds =
      defaultRequestTimeoutMilliseconds,
  ) {
    this.readyPromise = new Promise<void>((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });
    void this.readyPromise.catch(() => undefined);
    this.readyTimer = setTimeout(() => {
      this.failConnection();
    }, this.requestTimeoutMilliseconds);
    this.unsubscribe = transport.subscribe((value) => this.receive(value));
    this.unsubscribeClose = transport.subscribeClose(() => {
      this.failConnection();
    });
  }

  beginMaintenance(operationId: string): Promise<'busy'> {
    return this.requestBusyMaintenance('beginProfileMaintenance', operationId);
  }

  beginUpdateMaintenance(operationId: string): Promise<'busy'> {
    return this.requestBusyMaintenance('beginUpdateMaintenance', operationId);
  }

  assertUpdateMaintenance(operationId: string): Promise<'busy'> {
    return this.requestBusyMaintenance('assertUpdateMaintenance', operationId);
  }

  beginRestoreMaintenance(operationId: string): Promise<'busy'> {
    return this.requestBusyMaintenance('beginRestoreMaintenance', operationId);
  }

  assertRestoreMaintenance(operationId: string): Promise<'busy'> {
    return this.requestBusyMaintenance('assertRestoreMaintenance', operationId);
  }

  invalidateRestoreMaintenance(operationId: string): Promise<'busy'> {
    return this.requestBusyMaintenance('invalidateRestoreMaintenance', operationId);
  }

  beginDeleteMaintenance(operationId: string): Promise<'busy'> {
    return this.requestBusyMaintenance('beginDeleteMaintenance', operationId);
  }

  assertDeleteMaintenance(operationId: string): Promise<'busy'> {
    return this.requestBusyMaintenance('assertDeleteMaintenance', operationId);
  }

  invalidateDeleteMaintenance(operationId: string): Promise<'busy'> {
    return this.requestBusyMaintenance('invalidateDeleteMaintenance', operationId);
  }

  private requestBusyMaintenance(
    operation:
      | 'beginProfileMaintenance'
      | 'beginUpdateMaintenance'
      | 'assertUpdateMaintenance'
      | 'beginRestoreMaintenance'
      | 'assertRestoreMaintenance'
      | 'invalidateRestoreMaintenance'
      | 'beginDeleteMaintenance'
      | 'assertDeleteMaintenance'
      | 'invalidateDeleteMaintenance',
    operationId: string,
  ): Promise<'busy'> {
    return this.request(operation, operationId).then(
      (result) => {
        if (
          result.type !== 'maintenanceStatus' ||
          result.status !== 'busy'
        ) {
          throw new ProfileSnapshotBrokerError(
            'PROFILE_SNAPSHOT_BROKER_UNAVAILABLE',
          );
        }
        return result.status;
      },
    );
  }

  createProfileSnapshot(
    operationId: string,
    migrationPolicy: ProfileSnapshotMigrationPolicy,
  ): Promise<
    Extract<ProfileSnapshotBrokerSuccessResult, { type: 'profileSnapshot' }>
  > {
    return this.request(
      'createProfileSnapshot',
      operationId,
      migrationPolicy,
    ).then(
      (result) => {
        if (result.type !== 'profileSnapshot') {
          throw new ProfileSnapshotBrokerError(
            'PROFILE_SNAPSHOT_BROKER_UNAVAILABLE',
          );
        }
        return result;
      },
    );
  }

  close(): void {
    if (this.closed) {
      return;
    }

    this.closed = true;
    this.unsubscribe();
    this.unsubscribeClose();
    this.transport.close();
    this.rejectConnectionWaiters();
  }

  endMaintenance(operationId: string): Promise<'normal'> {
    return this.requestEndMaintenance('endProfileMaintenance', operationId);
  }

  endUpdateMaintenance(operationId: string): Promise<'normal'> {
    return this.requestEndMaintenance('endUpdateMaintenance', operationId);
  }

  endRestoreMaintenance(operationId: string): Promise<'normal'> {
    return this.requestEndMaintenance('endRestoreMaintenance', operationId);
  }

  private requestEndMaintenance(
    operation: 'endProfileMaintenance' | 'endUpdateMaintenance' | 'endRestoreMaintenance',
    operationId: string,
  ): Promise<'normal'> {
    return this.request(operation, operationId).then(
      (result) => {
        if (
          result.type !== 'maintenanceStatus' ||
          result.status !== 'normal'
        ) {
          throw new ProfileSnapshotBrokerError(
            'PROFILE_SNAPSHOT_BROKER_UNAVAILABLE',
          );
        }
        return result.status;
      },
    );
  }

  getStatus(): Promise<'busy' | 'normal'> {
    return this.request('getProfileMaintenanceStatus').then((result) => {
      if (result.type !== 'maintenanceStatus') {
        throw new ProfileSnapshotBrokerError(
          'PROFILE_SNAPSHOT_BROKER_UNAVAILABLE',
        );
      }
      return result.status;
    });
  }

  waitUntilReady(): Promise<void> {
    return this.readyPromise;
  }

  /** Captures this exact private channel, not merely the current profile identity. */
  captureInspectionAuthority(): () => void {
    const assertCurrent = () => {
      if (this.closed) throw new ProfileSnapshotBrokerError('PROFILE_SNAPSHOT_BROKER_UNAVAILABLE');
    };
    assertCurrent();
    return assertCurrent;
  }

  async readProfileInspectionContext(input: ContextRequestBoundary & {
    readonly operationId: string;
    readonly updateMaintenanceOperationId?: string;
    readonly deleteMaintenanceOperationId?: string;
  }): Promise<ProfileInspectionBrokerContext> {
    const assertCurrent = this.captureInspectionAuthority();
    assertContextRequestCurrent(input);
    if (input.deadline > performance.now() + defaultRequestTimeoutMilliseconds) {
      throw new Error('PROFILE_INSPECTION_PROTOCOL_INVALID');
    }
    const result = await this.request('readProfileInspectionContext', input.operationId,
      undefined, input.updateMaintenanceOperationId, input, input.deleteMaintenanceOperationId);
    assertContextRequestCurrent(input);
    assertCurrent();
    if (result.type !== 'profileInspectionContext') {
      throw new ProfileSnapshotBrokerError('PROFILE_SNAPSHOT_BROKER_UNAVAILABLE');
    }
    return Object.freeze({ activeProfileId: result.activeProfileId, activeProfileIsEmpty: result.activeProfileIsEmpty });
  }

  private async request(
    operation: ProfileMaintenanceBrokerOperation,
    operationId?: string,
    migrationPolicy?: ProfileSnapshotMigrationPolicy,
    updateMaintenanceOperationId?: string,
    contextBoundary?: ContextRequestBoundary,
    deleteMaintenanceOperationId?: string,
  ): Promise<ProfileSnapshotBrokerSuccessResult> {
    if (contextBoundary === undefined) {
      await this.waitUntilReady();
    } else {
      await waitForContextReadiness(this.waitUntilReady(), contextBoundary);
      assertContextRequestCurrent(contextBoundary);
    }

    if (this.closed) {
      return Promise.reject(
        new ProfileSnapshotBrokerError(
          'PROFILE_SNAPSHOT_BROKER_UNAVAILABLE',
        ),
      );
    }

    const requestId = randomUUID();
    const request = createProfileSnapshotBrokerRequest({
      operation,
      ...(contextBoundary === undefined ? {} : { kind: contextBoundary.kind }),
      ...(migrationPolicy === undefined ? {} : { migrationPolicy }),
      ...(operationId === undefined ? {} : { operationId }),
      ...(updateMaintenanceOperationId === undefined ? {} : { updateMaintenanceOperationId }),
      ...(deleteMaintenanceOperationId === undefined ? {} : { deleteMaintenanceOperationId }),
      requestId,
    });

    return new Promise((resolve, reject) => {
      const aborted = () => {
        dispose();
        reject(new Error('PROFILE_INSPECTION_TIMEOUT'));
      };
      const dispose = () => {
        clearTimeout(timer);
        this.pending.delete(requestId);
        contextBoundary?.signal.removeEventListener('abort', aborted);
      };
      const timer = setTimeout(() => {
        dispose();
        reject(contextBoundary === undefined ?
          new ProfileSnapshotBrokerError(
            'PROFILE_SNAPSHOT_BROKER_UNAVAILABLE',
          ) : new Error('PROFILE_INSPECTION_TIMEOUT'),
        );
      }, contextBoundary === undefined ? this.requestTimeoutMilliseconds
        : Math.max(0, contextBoundary.deadline - performance.now()));
      this.pending.set(requestId, { reject, resolve, dispose });
      contextBoundary?.signal.addEventListener('abort', aborted, { once: true });
      if (contextBoundary?.signal.aborted) {
        aborted();
        return;
      }

      try {
        if (contextBoundary !== undefined) assertContextRequestCurrent(contextBoundary);
        this.transport.send(request);
      } catch (error) {
        dispose();
        reject(
          error instanceof Error && error.message === 'PROFILE_INSPECTION_TIMEOUT' ? error : new ProfileSnapshotBrokerError(
            'PROFILE_SNAPSHOT_BROKER_UNAVAILABLE',
          ),
        );
      }
    });
  }

  private receive(value: unknown): void {
    if (isProfileSnapshotBrokerReadyCandidate(value)) {
      if (parseProfileSnapshotBrokerReady(value) === undefined) {
        this.failConnection();
        return;
      }
      if (!this.ready) {
        this.ready = true;
        clearTimeout(this.readyTimer);
        this.resolveReady();
      }
      return;
    }

    const requestId = readProfileSnapshotBrokerRequestId(value);

    if (requestId === undefined) {
      return;
    }

    const pending = this.pending.get(requestId);

    if (pending === undefined) {
      return;
    }

    const response = parseProfileSnapshotBrokerResponse(value);
    pending.dispose();

    if (response === undefined) {
      pending.reject(
        new ProfileSnapshotBrokerError(
          'PROFILE_SNAPSHOT_BROKER_UNAVAILABLE',
        ),
      );
      return;
    }
    if (!response.ok) {
      pending.reject(new ProfileSnapshotBrokerError(response.errorCode));
      return;
    }

    pending.resolve(response.result);
  }

  private failConnection(): void {
    if (this.closed) {
      return;
    }

    this.closed = true;
    this.unsubscribe();
    this.unsubscribeClose();
    this.transport.close();
    this.rejectConnectionWaiters();
  }

  private rejectConnectionWaiters(): void {
    clearTimeout(this.readyTimer);
    const error = new ProfileSnapshotBrokerError(
      'PROFILE_SNAPSHOT_BROKER_UNAVAILABLE',
    );

    if (!this.ready) {
      this.rejectReady(error);
    }
    for (const pending of this.pending.values()) {
      pending.dispose();
      pending.reject(error);
    }
    this.pending.clear();
  }
}

function assertContextRequestCurrent(input: ContextRequestBoundary): void {
  if (!Number.isFinite(input.deadline)) throw new Error('PROFILE_INSPECTION_PROTOCOL_INVALID');
  if (input.signal.aborted || performance.now() >= input.deadline) {
    throw new Error('PROFILE_INSPECTION_TIMEOUT');
  }
}

function waitForContextReadiness(task: Promise<void>, boundary: ContextRequestBoundary): Promise<void> {
  assertContextRequestCurrent(boundary);
  return new Promise((resolve, reject) => {
    const dispose = () => {
      clearTimeout(timer);
      boundary.signal.removeEventListener('abort', aborted);
    };
    const aborted = () => { dispose(); reject(new Error('PROFILE_INSPECTION_TIMEOUT')); };
    const timer = setTimeout(aborted, Math.max(0, boundary.deadline - performance.now()));
    boundary.signal.addEventListener('abort', aborted, { once: true });
    void task.then(() => { dispose(); resolve(); }, error => { dispose(); reject(error); });
    if (boundary.signal.aborted) aborted();
  });
}
