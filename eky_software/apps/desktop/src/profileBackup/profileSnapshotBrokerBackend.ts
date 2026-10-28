import {
  createProfileSnapshotBrokerReady,
  parseProfileSnapshotBrokerRequest,
  profileSnapshotBrokerProtocolVersion,
  readProfileSnapshotBrokerRequestId,
  type ProfileSnapshotBrokerErrorCode,
  type ProfileSnapshotBrokerResponse,
  type ProfileInspectionBrokerContext,
} from './profileSnapshotBrokerProtocol.js';
import type { ProfileSnapshotBrokerTransport } from './profileSnapshotBrokerTransport.js';

const maintenanceDrainTimeoutMilliseconds = 30_000;
const maximumMaintenanceDurationMilliseconds = 10 * 60_000;

export interface ProfileMaintenanceService {
  begin(operationId: string, timeoutMilliseconds: number): Promise<void>;
  beginUpdate(
    operationId: string,
    timeoutMilliseconds: number,
    maximumDurationMilliseconds: number,
  ): Promise<void>;
  assertUpdate(operationId: string): void;
  endUpdate(operationId: string): void;
  beginRestore(
    operationId: string,
    timeoutMilliseconds: number,
    maximumDurationMilliseconds: number,
  ): Promise<void>;
  assertRestore(operationId: string): void;
  endRestore(operationId: string): void;
  invalidateRestore(operationId: string): void;
  beginDelete(operationId: string, timeoutMilliseconds: number, maximumDurationMilliseconds: number): Promise<void>;
  assertDelete(operationId: string): void;
  invalidateDelete(operationId: string): void;
  end(operationId: string): void;
  forceEnd(): void;
  getStatus(): 'busy' | 'normal';
}

export function startProfileSnapshotBrokerBackend(input: {
  maintenance: ProfileMaintenanceService;
  snapshot: {
    readProfileInspectionContext(): ProfileInspectionBrokerContext | Promise<ProfileInspectionBrokerContext>;
    createProfileSnapshot(input: {
      migrationPolicy:
        | 'exactCurrentManifest'
        | 'compatibleHistoricalPrefix';
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
  };
  transport: ProfileSnapshotBrokerTransport;
}): {
  assertUpdateMaintenance(operationId: string): void;
  assertRestoreMaintenance(operationId: string): void;
  assertDeleteMaintenance(operationId: string): void;
  close(): void;
} {
  let activeOperationId: string | undefined;
  let activeOperationKind: 'ordinary' | 'update' | 'restore' | 'delete' | undefined;
  let activeSnapshotAbortController: AbortController | undefined;
  let autoReleaseTimer: ReturnType<typeof setTimeout> | undefined;
  let closed = false;
  let operationQueue = Promise.resolve();
  const queuedDeleteBegins = new Set<{ readonly operationId: string; cancelled: boolean }>();

  const clearActiveOperation = () => {
    if (autoReleaseTimer !== undefined) {
      clearTimeout(autoReleaseTimer);
      autoReleaseTimer = undefined;
    }
    activeOperationId = undefined;
    activeOperationKind = undefined;
  };

  const assertProtectedMaintenance = (
    operationId: string,
    kind: 'update' | 'restore' | 'delete',
  ) => {
    if (closed) {
      throw new Error('PROFILE_SNAPSHOT_BROKER_UNAVAILABLE');
    }
    if (
      activeOperationKind !== kind || activeOperationId !== operationId
    ) {
      throw new Error('PROFILE_MAINTENANCE_OPERATION_MISMATCH');
    }
    if (kind === 'update') input.maintenance.assertUpdate(operationId);
    else if (kind === 'restore') input.maintenance.assertRestore(operationId);
    else input.maintenance.assertDelete(operationId);
  };
  const assertUpdateMaintenance = (operationId: string) =>
    assertProtectedMaintenance(operationId, 'update');
  const assertRestoreMaintenance = (operationId: string) =>
    assertProtectedMaintenance(operationId, 'restore');
  const assertDeleteMaintenance = (operationId: string) =>
    assertProtectedMaintenance(operationId, 'delete');
  const captureSnapshotFence = (operationId?: string) => {
    // Timer/close cleanup can erase broker metadata while work is awaiting.
    const protectedKind = activeOperationKind === 'ordinary'
      ? undefined : activeOperationKind;
    const protectedOperationId = protectedKind === undefined
      ? undefined : activeOperationId;
    const assertContinuation = () => {
      if (closed) {
        throw new Error('PROFILE_SNAPSHOT_BROKER_UNAVAILABLE');
      }
      if (protectedOperationId !== undefined && protectedKind !== undefined) {
        if (operationId !== undefined && operationId !== protectedOperationId) {
          throw new Error('PROFILE_MAINTENANCE_OPERATION_MISMATCH');
        }
        assertProtectedMaintenance(protectedOperationId, protectedKind);
      }
    };
    assertContinuation();
    return assertContinuation;
  };
  const close = () => {
    if (closed) {
      return;
    }
    closed = true;
    queuedDeleteBegins.clear();
    unsubscribe();
    unsubscribeClose();
    activeSnapshotAbortController?.abort();
    activeSnapshotAbortController = undefined;
    if (activeOperationId !== undefined) {
      input.maintenance.forceEnd();
      clearActiveOperation();
    }
    input.transport.close();
  };
  const invalidateMaintenance = (operationId: string, kind: 'restore' | 'delete') => {
    if (kind === 'delete') {
      for (const queued of queuedDeleteBegins) {
        if (queued.operationId === operationId) queued.cancelled = true;
      }
    }
    if (activeOperationKind !== kind || activeOperationId !== operationId) {
      throw new Error('PROFILE_MAINTENANCE_OPERATION_MISMATCH');
    }
    if (kind === 'restore') input.maintenance.invalidateRestore(operationId);
    else input.maintenance.invalidateDelete(operationId);
    activeSnapshotAbortController?.abort();
    if (autoReleaseTimer !== undefined) {
      clearTimeout(autoReleaseTimer);
      autoReleaseTimer = undefined;
    }
  };
  const unsubscribe = input.transport.subscribe((value) => {
    if (closed) return;
    const immediateRequest = parseProfileSnapshotBrokerRequest(value);
    if (immediateRequest?.operation === 'invalidateRestoreMaintenance' ||
      immediateRequest?.operation === 'invalidateDeleteMaintenance') {
      // Revocation must precede the ACK of work already awaiting in the queue.
      try {
        invalidateMaintenance(immediateRequest.operationId,
          immediateRequest.operation === 'invalidateRestoreMaintenance' ? 'restore' : 'delete');
        input.transport.send({
          ok: true,
          protocolVersion: profileSnapshotBrokerProtocolVersion,
          requestId: immediateRequest.requestId,
          result: { type: 'maintenanceStatus', status: input.maintenance.getStatus() },
        });
      } catch (error) {
        try {
          input.transport.send(createErrorResponse(immediateRequest.requestId, mapError(error)));
        } catch { close(); }
      }
      return;
    }
    const queuedDeleteBegin = immediateRequest?.operation === 'beginDeleteMaintenance'
      ? { operationId: immediateRequest.operationId, cancelled: false } : undefined;
    if (queuedDeleteBegin !== undefined) queuedDeleteBegins.add(queuedDeleteBegin);
    operationQueue = operationQueue
      .then(async () => {
        if (queuedDeleteBegin !== undefined) queuedDeleteBegins.delete(queuedDeleteBegin);
        if (closed) {
          return;
        }

        const request = immediateRequest;
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
          // Cancellation may arrive before this exact admission acquires a fence.
          if (queuedDeleteBegin?.cancelled) {
            throw new Error('PROFILE_MAINTENANCE_OPERATION_MISMATCH');
          }
          if (
            request.operation === 'beginProfileMaintenance' ||
            request.operation === 'beginUpdateMaintenance' ||
            request.operation === 'beginRestoreMaintenance' ||
            request.operation === 'beginDeleteMaintenance'
          ) {
            if (
              activeOperationId !== undefined ||
              input.maintenance.getStatus() !== 'normal'
            ) {
              throw new Error('PROFILE_MAINTENANCE_BUSY');
            }
            const kind = request.operation === 'beginUpdateMaintenance'
              ? 'update' : request.operation === 'beginRestoreMaintenance'
                ? 'restore' : request.operation === 'beginDeleteMaintenance' ? 'delete' : 'ordinary';
            // Own cancellation before begin can wait for an in-flight write.
            activeOperationId = request.operationId;
            activeOperationKind = kind;
            try {
              if (kind === 'update') {
                await input.maintenance.beginUpdate(
                  request.operationId, maintenanceDrainTimeoutMilliseconds,
                  maximumMaintenanceDurationMilliseconds,
                );
              } else if (kind === 'restore') {
                await input.maintenance.beginRestore(
                  request.operationId, maintenanceDrainTimeoutMilliseconds,
                  maximumMaintenanceDurationMilliseconds,
                );
              } else if (kind === 'delete') {
                await input.maintenance.beginDelete(
                  request.operationId, maintenanceDrainTimeoutMilliseconds,
                  maximumMaintenanceDurationMilliseconds,
                );
              } else {
                await input.maintenance.begin(
                  request.operationId, maintenanceDrainTimeoutMilliseconds,
                );
              }
            } catch (error) {
              if (kind === 'ordinary') {
                clearActiveOperation();
              }
              throw error;
            }
            if (closed) {
              throw new Error('PROFILE_SNAPSHOT_BROKER_UNAVAILABLE');
            }
            if (kind !== 'ordinary') {
              assertProtectedMaintenance(request.operationId, kind);
            }
            autoReleaseTimer = setTimeout(() => {
              if (activeOperationId === request.operationId) {
                if (kind !== 'ordinary') {
                  activeSnapshotAbortController?.abort();
                }
                input.maintenance.forceEnd();
                if (kind === 'ordinary') {
                  clearActiveOperation();
                } else {
                  autoReleaseTimer = undefined;
                }
              }
            }, maximumMaintenanceDurationMilliseconds);
          } else if (request.operation === 'assertUpdateMaintenance') {
            assertUpdateMaintenance(request.operationId);
          } else if (request.operation === 'endUpdateMaintenance') {
            assertUpdateMaintenance(request.operationId);
            input.maintenance.endUpdate(request.operationId);
            clearActiveOperation();
          } else if (request.operation === 'assertRestoreMaintenance') {
            assertRestoreMaintenance(request.operationId);
          } else if (request.operation === 'endRestoreMaintenance') {
            assertRestoreMaintenance(request.operationId);
            input.maintenance.endRestore(request.operationId);
            clearActiveOperation();
          } else if (request.operation === 'invalidateRestoreMaintenance') {
            invalidateMaintenance(request.operationId, 'restore');
          } else if (request.operation === 'assertDeleteMaintenance') {
            assertDeleteMaintenance(request.operationId);
          } else if (request.operation === 'invalidateDeleteMaintenance') {
            invalidateMaintenance(request.operationId, 'delete');
          } else if (request.operation === 'createProfileSnapshot') {
            const assertContinuation = captureSnapshotFence(request.operationId);
            activeSnapshotAbortController = new AbortController();
            const snapshot = await input.snapshot.createProfileSnapshot({
              migrationPolicy: request.migrationPolicy,
              operationId: request.operationId,
              signal: activeSnapshotAbortController.signal,
            });
            activeSnapshotAbortController = undefined;
            assertContinuation();
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
          } else if (request.operation === 'readProfileInspectionContext') {
            const ownerId = activeOperationId;
            const ownerKind = activeOperationKind;
            const status = input.maintenance.getStatus();
            const assertContextOwner = () => {
              if (closed) throw new Error('PROFILE_SNAPSHOT_BROKER_UNAVAILABLE');
              if (ownerId !== activeOperationId || ownerKind !== activeOperationKind ||
                status !== input.maintenance.getStatus()) {
                throw new Error('PROFILE_MAINTENANCE_OPERATION_MISMATCH');
              }
              if (request.kind === 'prepareRestoreActivation' &&
                ((ownerKind !== 'ordinary' && ownerKind !== 'restore') ||
                  ownerId !== request.operationId || status !== 'busy')) {
                throw new Error('PROFILE_MAINTENANCE_OPERATION_MISMATCH');
              }
              if (request.updateMaintenanceOperationId !== undefined) {
                assertUpdateMaintenance(request.updateMaintenanceOperationId);
              } else if (ownerKind === 'update') {
                throw new Error('PROFILE_MAINTENANCE_OPERATION_MISMATCH');
              }
              if (ownerKind === 'restore') {
                if (ownerId !== request.operationId) {
                  throw new Error('PROFILE_MAINTENANCE_OPERATION_MISMATCH');
                }
                assertRestoreMaintenance(request.operationId);
              }
              if (request.deleteMaintenanceOperationId !== undefined) {
                assertDeleteMaintenance(request.deleteMaintenanceOperationId);
              } else if (ownerKind === 'delete') {
                throw new Error('PROFILE_MAINTENANCE_OPERATION_MISMATCH');
              }
            };
            assertContextOwner();
            const context = await input.snapshot.readProfileInspectionContext();
            assertContextOwner();
            input.transport.send({
              ok: true, protocolVersion: profileSnapshotBrokerProtocolVersion,
              requestId: request.requestId,
              result: { type: 'profileInspectionContext',
                activeProfileId: context.activeProfileId, activeProfileIsEmpty: context.activeProfileIsEmpty },
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
          if (!closed) {
            input.transport.send(
              createErrorResponse(request.requestId, mapError(error)),
            );
          }
        }
      })
      .catch(close);
  });
  const unsubscribeClose = input.transport.subscribeClose(close);
  input.transport.send(createProfileSnapshotBrokerReady());

  return {
    assertUpdateMaintenance,
    assertRestoreMaintenance,
    assertDeleteMaintenance,
    close,
  };
}

function mapError(error: unknown): ProfileSnapshotBrokerErrorCode {
  const name = readErrorProperty(error, 'name');
  const message = readErrorProperty(error, 'message');

  if (
    name === 'ProfileMaintenanceBusyError' || message === 'PROFILE_MAINTENANCE_BUSY'
  ) {
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
  if (message === 'PROFILE_SNAPSHOT_BROKER_UNAVAILABLE') {
    return 'PROFILE_SNAPSHOT_BROKER_UNAVAILABLE';
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
  if (
    message === 'PROFILE_SNAPSHOT_PATH_INVALID' ||
    message === 'PROFILE_SNAPSHOT_STAGING_INVALID' ||
    message === 'PROFILE_SNAPSHOT_DESTINATION_EXISTS'
  ) {
    return 'PROFILE_SNAPSHOT_STAGING_FAILED';
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
