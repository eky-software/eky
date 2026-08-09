import { randomUUID } from 'node:crypto';

import {
  createProfileSnapshotBrokerRequest,
  isProfileSnapshotBrokerReadyCandidate,
  parseProfileSnapshotBrokerReady,
  parseProfileSnapshotBrokerResponse,
  readProfileSnapshotBrokerRequestId,
  type ProfileMaintenanceBrokerOperation,
  type ProfileSnapshotBrokerErrorCode,
  type ProfileSnapshotBrokerResponse,
} from './profileSnapshotBrokerProtocol.js';
import type { ProfileSnapshotBrokerTransport } from './profileSnapshotBrokerTransport.js';

const defaultRequestTimeoutMilliseconds = 35_000;

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
      timer: ReturnType<typeof setTimeout>;
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
    return this.request('beginProfileMaintenance', operationId).then(
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

  createProfileSnapshot(operationId: string): Promise<
    Extract<ProfileSnapshotBrokerSuccessResult, { type: 'profileSnapshot' }>
  > {
    return this.request('createProfileSnapshot', operationId).then(
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
    return this.request('endProfileMaintenance', operationId).then(
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

  validateActiveProfile(): Promise<
    Extract<
      ProfileSnapshotBrokerSuccessResult,
      { type: 'activeProfileValidation' }
    >
  > {
    return this.request('validateActiveProfile').then((result) => {
      if (result.type !== 'activeProfileValidation') {
        throw new ProfileSnapshotBrokerError(
          'PROFILE_SNAPSHOT_BROKER_UNAVAILABLE',
        );
      }
      return result;
    });
  }

  prepareProfileRestoreActivation(operationId: string): Promise<
    Extract<
      ProfileSnapshotBrokerSuccessResult,
      { type: 'profileRestoreActivationPrepared' }
    >
  > {
    return this.request(
      'prepareProfileRestoreActivation',
      operationId,
    ).then((result) => {
      if (result.type !== 'profileRestoreActivationPrepared') {
        throw new ProfileSnapshotBrokerError(
          'PROFILE_SNAPSHOT_BROKER_UNAVAILABLE',
        );
      }
      return result;
    });
  }

  validateProfileSnapshot(operationId: string): Promise<
    Extract<
      ProfileSnapshotBrokerSuccessResult,
      { type: 'profileSnapshotValidation' }
    >
  > {
    return this.request('validateProfileSnapshot', operationId).then(
      (result) => {
        if (result.type !== 'profileSnapshotValidation') {
          throw new ProfileSnapshotBrokerError(
            'PROFILE_SNAPSHOT_BROKER_UNAVAILABLE',
          );
        }
        return result;
      },
    );
  }

  private async request(
    operation: ProfileMaintenanceBrokerOperation,
    operationId?: string,
  ): Promise<ProfileSnapshotBrokerSuccessResult> {
    await this.waitUntilReady();

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
      ...(operationId === undefined ? {} : { operationId }),
      requestId,
    });

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(
          new ProfileSnapshotBrokerError(
            'PROFILE_SNAPSHOT_BROKER_UNAVAILABLE',
          ),
        );
      }, this.requestTimeoutMilliseconds);
      this.pending.set(requestId, { reject, resolve, timer });

      try {
        this.transport.send(request);
      } catch {
        clearTimeout(timer);
        this.pending.delete(requestId);
        reject(
          new ProfileSnapshotBrokerError(
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
    clearTimeout(pending.timer);
    this.pending.delete(requestId);

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
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }
}
