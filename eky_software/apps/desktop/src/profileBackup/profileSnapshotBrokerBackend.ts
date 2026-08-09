import {
  createProfileSnapshotBrokerReady,
  parseProfileSnapshotBrokerRequest,
  profileSnapshotBrokerProtocolVersion,
  readProfileSnapshotBrokerRequestId,
  type ProfileSnapshotBrokerErrorCode,
  type ProfileSnapshotBrokerResponse,
} from './profileSnapshotBrokerProtocol.js';
import type { ProfileSnapshotBrokerTransport } from './profileSnapshotBrokerTransport.js';

const maintenanceDrainTimeoutMilliseconds = 30_000;
const maximumMaintenanceDurationMilliseconds = 10 * 60_000;

export interface ProfileMaintenanceService {
  begin(operationId: string, timeoutMilliseconds: number): Promise<void>;
  end(operationId: string): void;
  forceEnd(): void;
  getStatus(): 'busy' | 'normal';
}

export function startProfileSnapshotBrokerBackend(input: {
  maintenance: ProfileMaintenanceService;
  snapshot: {
    validateActiveProfile(): Promise<{
      artifactCount: number;
      artifactTotalByteSize: number;
      databaseHealth: 'healthy';
    }>;
    createProfileSnapshot(input: {
      operationId: string;
      signal: AbortSignal;
    }): Promise<{
      artifactCatalog: {
        artifactCount: number;
        artifactTotalByteSize: number;
        catalogByteSize: number;
        logicalPath: 'snapshot-catalog-v1.json';
        sha256: string;
      };
      database: {
        databaseByteSize: number;
        logicalPath: 'profile.sqlite';
        sha256: string;
      totalPages: number;
      };
    }>;
    prepareProfileRestoreActivation(operationId: string): Promise<{
      artifactCount: number;
      artifactTotalByteSize: number;
    }>;
    validateProfileSnapshot(operationId: string): Promise<{
      activeProfileIsEmpty: boolean;
      artifactCount: number;
      artifactTotalByteSize: number;
      databaseHealth: 'healthy';
      migrationChainIdentity: string;
      profileId: string;
      profileMatchesActive: boolean;
    }>;
  };
  transport: ProfileSnapshotBrokerTransport;
}): { close(): void } {
  let activeOperationId: string | undefined;
  let activeSnapshotAbortController: AbortController | undefined;
  let autoReleaseTimer: ReturnType<typeof setTimeout> | undefined;
  let closed = false;
  let operationQueue = Promise.resolve();

  const clearActiveOperation = () => {
    if (autoReleaseTimer !== undefined) {
      clearTimeout(autoReleaseTimer);
      autoReleaseTimer = undefined;
    }
    activeOperationId = undefined;
  };
  const unsubscribe = input.transport.subscribe((value) => {
    operationQueue = operationQueue
      .then(async () => {
        if (closed) {
          return;
        }

        const request = parseProfileSnapshotBrokerRequest(value);
        const requestId = readProfileSnapshotBrokerRequestId(value);

        if (request === undefined) {
          if (requestId !== undefined) {
            input.transport.send(
              createErrorResponse(
                requestId,
                'PROFILE_SNAPSHOT_BROKER_REQUEST_INVALID',
              ),
            );
          }
          return;
        }

        try {
          if (request.operation === 'beginProfileMaintenance') {
            await input.maintenance.begin(
              request.operationId,
              maintenanceDrainTimeoutMilliseconds,
            );
            activeOperationId = request.operationId;
            autoReleaseTimer = setTimeout(() => {
              if (activeOperationId === request.operationId) {
                input.maintenance.forceEnd();
                clearActiveOperation();
              }
            }, maximumMaintenanceDurationMilliseconds);
          } else if (request.operation === 'createProfileSnapshot') {
            activeSnapshotAbortController = new AbortController();
            const snapshot = await input.snapshot.createProfileSnapshot({
              operationId: request.operationId,
              signal: activeSnapshotAbortController.signal,
            });
            activeSnapshotAbortController = undefined;
            input.transport.send({
              ok: true,
              protocolVersion: profileSnapshotBrokerProtocolVersion,
              requestId: request.requestId,
              result: {
                ...snapshot,
                type: 'profileSnapshot',
              },
            });
            return;
          } else if (request.operation === 'validateActiveProfile') {
            const validation =
              await input.snapshot.validateActiveProfile();
            input.transport.send({
              ok: true,
              protocolVersion: profileSnapshotBrokerProtocolVersion,
              requestId: request.requestId,
              result: {
                ...validation,
                type: 'activeProfileValidation',
              },
            });
            return;
          } else if (request.operation === 'validateProfileSnapshot') {
            const validation =
              await input.snapshot.validateProfileSnapshot(
                request.operationId,
              );
            input.transport.send({
              ok: true,
              protocolVersion: profileSnapshotBrokerProtocolVersion,
              requestId: request.requestId,
              result: {
                ...validation,
                type: 'profileSnapshotValidation',
              },
            });
            return;
          } else if (
            request.operation === 'prepareProfileRestoreActivation'
          ) {
            const prepared =
              await input.snapshot.prepareProfileRestoreActivation(
                request.operationId,
              );
            input.transport.send({
              ok: true,
              protocolVersion: profileSnapshotBrokerProtocolVersion,
              requestId: request.requestId,
              result: {
                ...prepared,
                type: 'profileRestoreActivationPrepared',
              },
            });
            return;
          } else if (request.operation === 'endProfileMaintenance') {
            input.maintenance.end(request.operationId);
            clearActiveOperation();
          }

          input.transport.send({
            ok: true,
            protocolVersion: profileSnapshotBrokerProtocolVersion,
            requestId: request.requestId,
            result: {
              status: input.maintenance.getStatus(),
              type: 'maintenanceStatus',
            },
          });
        } catch (error) {
          activeSnapshotAbortController = undefined;
          input.transport.send(
            createErrorResponse(request.requestId, mapError(error)),
          );
        }
      })
      .catch(() => undefined);
  });
  const unsubscribeClose = input.transport.subscribeClose(() => {
    activeSnapshotAbortController?.abort();
    activeSnapshotAbortController = undefined;
    if (activeOperationId !== undefined) {
      input.maintenance.forceEnd();
      clearActiveOperation();
    }
  });
  input.transport.send(createProfileSnapshotBrokerReady());

  return {
    close() {
      if (closed) {
        return;
      }

      closed = true;
      unsubscribe();
      unsubscribeClose();
      activeSnapshotAbortController?.abort();
      activeSnapshotAbortController = undefined;
      if (activeOperationId !== undefined) {
        input.maintenance.forceEnd();
        clearActiveOperation();
      }
      input.transport.close();
    },
  };
}

function mapError(error: unknown): ProfileSnapshotBrokerErrorCode {
  const name = readErrorProperty(error, 'name');
  const message = readErrorProperty(error, 'message');

  if (name === 'ProfileMaintenanceBusyError') {
    return 'PROFILE_MAINTENANCE_BUSY';
  }
  if (name === 'ProfileMaintenanceTimeoutError') {
    return 'PROFILE_MAINTENANCE_TIMEOUT';
  }
  if (
    name === 'ProfileMaintenanceOperationMismatchError' ||
    message === 'PROFILE_MAINTENANCE_OPERATION_MISMATCH'
  ) {
    return 'PROFILE_MAINTENANCE_OPERATION_MISMATCH';
  }
  if (message === 'PROFILE_SNAPSHOT_DATABASE_FAILED') {
    return 'PROFILE_SNAPSHOT_DATABASE_FAILED';
  }
  if (message === 'PROFILE_SNAPSHOT_ARTIFACTS_FAILED') {
    return 'PROFILE_SNAPSHOT_ARTIFACTS_FAILED';
  }
  if (message === 'PROFILE_RESTORE_ACTIVATION_PREPARATION_FAILED') {
    return 'PROFILE_RESTORE_ACTIVATION_PREPARATION_FAILED';
  }
  if (
    message === 'PROFILE_SNAPSHOT_VALIDATION_FAILED' ||
    message === 'ACTIVE_PROFILE_VALIDATION_FAILED'
  ) {
    return 'PROFILE_SNAPSHOT_VALIDATION_FAILED';
  }

  return 'PROFILE_SNAPSHOT_BROKER_OPERATION_FAILED';
}

function readErrorProperty(
  error: unknown,
  property: 'message' | 'name',
): string | undefined {
  if (
    typeof error !== 'object' ||
    error === null ||
    !(property in error)
  ) {
    return undefined;
  }

  const value = (error as Record<string, unknown>)[property];

  return typeof value === 'string' ? value : undefined;
}

function createErrorResponse(
  requestId: string,
  errorCode: ProfileSnapshotBrokerErrorCode,
): ProfileSnapshotBrokerResponse {
  return {
    errorCode,
    ok: false,
    protocolVersion: profileSnapshotBrokerProtocolVersion,
    requestId,
  };
}
