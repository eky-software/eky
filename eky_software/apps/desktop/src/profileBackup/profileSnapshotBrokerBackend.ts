import {
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
  transport: ProfileSnapshotBrokerTransport;
}): { close(): void } {
  let activeOperationId: string | undefined;
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
          } else if (request.operation === 'endProfileMaintenance') {
            input.maintenance.end(request.operationId);
            clearActiveOperation();
          }

          input.transport.send({
            ok: true,
            protocolVersion: profileSnapshotBrokerProtocolVersion,
            requestId: request.requestId,
            result: { status: input.maintenance.getStatus() },
          });
        } catch (error) {
          input.transport.send(
            createErrorResponse(request.requestId, mapError(error)),
          );
        }
      })
      .catch(() => undefined);
  });
  const unsubscribeClose = input.transport.subscribeClose(() => {
    if (activeOperationId !== undefined) {
      input.maintenance.forceEnd();
      clearActiveOperation();
    }
  });

  return {
    close() {
      if (closed) {
        return;
      }

      closed = true;
      unsubscribe();
      unsubscribeClose();
      if (activeOperationId !== undefined) {
        input.maintenance.forceEnd();
        clearActiveOperation();
      }
      input.transport.close();
    },
  };
}

function mapError(error: unknown): ProfileSnapshotBrokerErrorCode {
  if (error instanceof Error) {
    if (error.name === 'ProfileMaintenanceBusyError') {
      return 'PROFILE_MAINTENANCE_BUSY';
    }
    if (error.name === 'ProfileMaintenanceTimeoutError') {
      return 'PROFILE_MAINTENANCE_TIMEOUT';
    }
    if (error.name === 'ProfileMaintenanceOperationMismatchError') {
      return 'PROFILE_MAINTENANCE_OPERATION_MISMATCH';
    }
  }

  return 'PROFILE_SNAPSHOT_BROKER_UNAVAILABLE';
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
