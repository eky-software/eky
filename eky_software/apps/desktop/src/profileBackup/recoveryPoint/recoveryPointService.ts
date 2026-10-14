import { randomUUID } from 'node:crypto';
import { join } from 'node:path';

import { readProfileInspectionFailureCause } from '../../runtime/profileInspectionFailure.js';
import type { ProfileInspectionReceipt } from '../../runtime/profileInspectionMessages.js';
import {
  assertProfileBackupSourceReceipt,
  createProfileBackupSourceEntries,
} from '../createProfileBackupSourceEntries.js';
import type { ProfileSnapshotInspectionPort } from '../profileSnapshotInspectionPort.js';
import type { ProfileSnapshotMigrationPolicy } from '../profileSnapshotBrokerProtocol.js';
import type {
  RecoveryPointIndexEntry,
  RecoveryPointKind,
} from './recoveryPointIndexStore.js';
import {
  noOpProfileRecoveryOperationalObserver,
  observeProfileRecoverySafely,
  type ProfileRecoveryOperationalObserver,
} from '../profileRecoveryOperationalObserver.js';
import type { RecoveryPointRotationService } from './recoveryPointRotationService.js';
import type { RecoveryPointStore } from './recoveryPointStore.js';
import {
  RecoveryPointCleanupError,
  readSafeRecoveryPointErrorCode as readSafeErrorCode,
} from './recoveryPointOperationError.js';

export { RecoveryPointCleanupError } from './recoveryPointOperationError.js';

const automaticIntervalMilliseconds = 24 * 60 * 60 * 1_000;
const operationIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type RecoveryPointOperationState =
  | 'checking'
  | 'creating'
  | 'idle';

export interface RecoveryPointStatus {
  availability: 'available' | 'unavailable';
  budgetState: 'protectedPointsExceedBudget' | 'withinBudget';
  lastSafeErrorCode?: string;
  latestValidatedGoodAt?: string;
  nextAutomaticCheckAt?: string;
  operationState: RecoveryPointOperationState;
  pointCount: number;
}

interface RecoveryPointServiceDependencies {
  appVersion: string;
  now?(): Date;
  operationIdFactory?(): string;
  observer?: ProfileRecoveryOperationalObserver;
  profileSnapshotClient: Pick<
    ProfileSnapshotInspectionPort,
    | 'assertUpdateMaintenance'
    | 'beginMaintenance'
    | 'createProfileSnapshot'
    | 'endMaintenance'
    | 'validateProfileSnapshot'
    | 'withInspectionOperation'
    | 'withProfileSnapshot'
    | 'removeProfileSnapshot'
  >;
  rotation: Pick<
    RecoveryPointRotationService,
    'maintain' | 'resumePending'
  >;
  stagingRoot: string;
  store: Pick<RecoveryPointStore, 'create' | 'list'>;
}

export function isRecoveryPointCleanupUnverified(error: unknown): boolean {
  return (
    error instanceof RecoveryPointCleanupError ||
    readProfileInspectionFailureCause(error) ===
      'PROFILE_INSPECTION_CLEANUP_UNVERIFIED'
  );
}

export class RecoveryPointService {
  private availability: RecoveryPointStatus['availability'] =
    'available';
  private budgetState: RecoveryPointStatus['budgetState'] =
    'withinBudget';
  private lastSafeErrorCode: string | undefined;
  private latestValidatedGoodAt: string | undefined;
  private nextAutomaticCheckAt: string | undefined;
  private operationState: RecoveryPointOperationState = 'idle';
  private pointCount = 0;

  constructor(
    private readonly dependencies: RecoveryPointServiceDependencies,
  ) {}

  checkAutomatic(
    correlationId = this.createOperationId(),
  ): Promise<RecoveryPointIndexEntry | undefined> {
    return this.runExclusive('checking', async () => {
      let creation: { kind: RecoveryPointKind; startedAt: number } | undefined;
      const point = await this.withHealthySnapshot(
        correlationId,
        'exactCurrentManifest',
        async (snapshot) => {
          await this.dependencies.rotation.resumePending(
            snapshot.validation.profileId,
          );
          const points = await this.dependencies.store.list(
            snapshot.validation.profileId,
          );
          this.updatePointStatus(points);
          if (!isAutomaticPointDue(points, this.now())) {
            return undefined;
          }
          const kind = chooseAutomaticPointKind(points, this.now());
          const startedAt = Date.now();
          creation = { kind, startedAt };
          this.observe({
            correlationId,
            eventName: 'recoveryPoint.started',
            recoveryPointKind: kind,
            stage: 'creation',
          });
          return this.persistSnapshot(snapshot, kind);
        },
      );
      if (creation !== undefined) {
        this.observe({
          correlationId,
          durationMs: Date.now() - creation.startedAt,
          eventName: 'recoveryPoint.completed',
          recoveryPointKind: creation.kind,
          stage: 'creation',
        });
      }
      return point;
    });
  }

  createManual(): Promise<RecoveryPointIndexEntry> {
    return this.createNamedPoint('manual', 'exactCurrentManifest');
  }

  createPreMigration(): Promise<RecoveryPointIndexEntry> {
    return this.createNamedPoint('preUpdate', 'compatibleHistoricalPrefix');
  }

  createPreRestore(): Promise<RecoveryPointIndexEntry> {
    return this.createNamedPoint('preRestore', 'exactCurrentManifest');
  }

  async createPreUpdateWithMaintenance(
    operationId: string,
  ): Promise<RecoveryPointIndexEntry> {
    if (!operationIdPattern.test(operationId)) {
      throw new Error('RECOVERY_POINT_OPERATION_INVALID');
    }
    return this.createNamedPoint(
      'preUpdate',
      'exactCurrentManifest',
      operationId,
    );
  }

  getStatus(): RecoveryPointStatus {
    return {
      availability: this.availability,
      budgetState: this.budgetState,
      ...(this.lastSafeErrorCode === undefined
        ? {}
        : { lastSafeErrorCode: this.lastSafeErrorCode }),
      ...(this.latestValidatedGoodAt === undefined
        ? {}
        : { latestValidatedGoodAt: this.latestValidatedGoodAt }),
      ...(this.nextAutomaticCheckAt === undefined
        ? {}
        : { nextAutomaticCheckAt: this.nextAutomaticCheckAt }),
      operationState: this.operationState,
      pointCount: this.pointCount,
    };
  }

  private createNamedPoint(
    kind: 'manual' | 'preRestore' | 'preUpdate',
    migrationPolicy: ProfileSnapshotMigrationPolicy,
    updateOperationId?: string,
  ): Promise<RecoveryPointIndexEntry> {
    const correlationId = updateOperationId ?? this.createOperationId();
    const startedAt = Date.now();
    this.observe({
      correlationId,
      eventName: 'recoveryPoint.started',
      recoveryPointKind: kind,
      stage: 'creation',
    });
    return this.runExclusive('creating', () =>
      updateOperationId === undefined
        ? this.withHealthySnapshot(
            correlationId,
            migrationPolicy,
            (snapshot) => this.persistSnapshot(snapshot, kind),
          )
        : this.withUpdateSnapshot(
            updateOperationId,
            (snapshot) =>
              this.persistSnapshot(snapshot, kind, updateOperationId),
          ),
    ).then(
      (point) => {
        this.observe({
          correlationId,
          durationMs: Date.now() - startedAt,
          eventName: 'recoveryPoint.completed',
          recoveryPointKind: kind,
          stage: 'creation',
        });
        return point;
      },
      (error: unknown) => {
        this.observe({
          correlationId,
          durationMs: Date.now() - startedAt,
          errorCode: readProfileInspectionFailureCause(error) ??
            readSafeErrorCode(error),
          eventName: 'recoveryPoint.failed',
          recoveryPointKind: kind,
          retryable:
            updateOperationId === undefined &&
            !isRecoveryPointCleanupUnverified(error),
          sideEffectState: 'unknown',
          stage: 'creation',
        });
        throw error;
      },
    );
  }

  private withUpdateSnapshot<T>(
    operationId: string,
    useSnapshot: (snapshot: HealthySnapshot) => Promise<T>,
  ): Promise<T> {
    return this.withSnapshot(
      operationId,
      'exactCurrentManifest',
      useSnapshot,
      operationId,
    );
  }

  private async persistSnapshot(
    snapshot: HealthySnapshot,
    kind: RecoveryPointKind,
    updateMaintenanceOperationId?: string,
  ): Promise<RecoveryPointIndexEntry> {
    const timestamp = this.now();
    const entries = await createProfileBackupSourceEntries(
      snapshot.operationRoot,
    );
    assertProfileBackupSourceReceipt(entries, snapshot.receipt);
    const point = await this.dependencies.store.create({
      entries,
      kind,
      manifest: {
        appVersion: this.dependencies.appVersion,
        createdAtEpochMilliseconds: BigInt(timestamp.getTime()),
        migrationChainIdentity:
          snapshot.validation.migrationChainIdentity,
        profileId: snapshot.validation.profileId,
      },
      validatedAt: timestamp.toISOString(),
      ...(updateMaintenanceOperationId === undefined
        ? {}
        : { updateMaintenanceOperationId }),
    });
    const rotation = await this.dependencies.rotation.maintain(
      snapshot.validation.profileId,
      kind === 'preRestore' || kind === 'preUpdate'
        ? [point.artifactId]
        : [],
    );
    this.budgetState = rotation.budgetExceededAfterRotation
      ? 'protectedPointsExceedBudget'
      : 'withinBudget';
    this.updatePointStatus(
      await this.dependencies.store.list(
        snapshot.validation.profileId,
      ),
    );
    return point;
  }

  private withHealthySnapshot<T>(
    operationId: string,
    migrationPolicy: ProfileSnapshotMigrationPolicy,
    useSnapshot: (snapshot: HealthySnapshot) => Promise<T>,
  ): Promise<T> {
    return this.withSnapshot(operationId, migrationPolicy, useSnapshot);
  }

  private withSnapshot<T>(
    operationId: string,
    migrationPolicy: ProfileSnapshotMigrationPolicy,
    useSnapshot: (snapshot: HealthySnapshot) => Promise<T>,
    updateOperationId?: string,
  ): Promise<T> {
    if (!operationIdPattern.test(operationId)) {
      throw new Error('RECOVERY_POINT_OPERATION_INVALID');
    }
    const client = this.dependencies.profileSnapshotClient;
    return client.withInspectionOperation(async () => {
      let maintenanceStarted = false;
      let snapshotAttempted = false;
      let failed = false;
      let firstFailure: unknown;
      let cleanupFailure: unknown;
      let cleanupUnverified = false;
      let result!: T;
      try {
        if (updateOperationId === undefined) {
          await client.beginMaintenance(operationId);
          maintenanceStarted = true;
        } else {
          await client.assertUpdateMaintenance(updateOperationId);
        }
        snapshotAttempted = true;
        await client.createProfileSnapshot(operationId, migrationPolicy);
        const validation =
          updateOperationId === undefined
            ? await client.validateProfileSnapshot(operationId)
            : await client.validateProfileSnapshot(
                operationId,
                updateOperationId,
              );
        if (
          validation.databaseHealth !== 'healthy' ||
          !validation.profileMatchesActive
        ) {
          throw new Error('RECOVERY_POINT_SOURCE_UNHEALTHY');
        }
        result = await client.withProfileSnapshot(
          operationId,
          async (receipt) => {
            if (updateOperationId !== undefined) {
              await client.assertUpdateMaintenance(updateOperationId);
            }
            return useSnapshot({
              operationRoot: join(this.dependencies.stagingRoot, operationId),
              validation,
              receipt,
            });
          },
        );
      } catch (error) {
        failed = true;
        firstFailure = error;
      }
      // The current native owner, never a broker acknowledgement, authorizes removal.
      if (snapshotAttempted) {
        try {
          await client.removeProfileSnapshot(operationId);
        } catch (error) {
          cleanupUnverified = true;
          cleanupFailure = error;
        }
      }
      if (maintenanceStarted) {
        try {
          await client.endMaintenance(operationId);
        } catch (error) {
          if (!failed) {
            failed = true;
            firstFailure = error;
          }
        }
      }
      if (cleanupUnverified) {
        throw new RecoveryPointCleanupError(
          failed ? firstFailure : cleanupFailure,
        );
      }
      if (failed) {
        throw firstFailure;
      }
      // A late fence loss keeps a durable good point, but rejects update acknowledgement.
      if (updateOperationId !== undefined) {
        await client.assertUpdateMaintenance(updateOperationId);
      }
      return result;
    });
  }

  private updatePointStatus(
    points: readonly RecoveryPointIndexEntry[],
  ): void {
    const latest = [...points].sort(
      (first, second) =>
        Date.parse(second.validatedAt) -
          Date.parse(first.validatedAt) ||
        second.artifactId.localeCompare(first.artifactId, 'en'),
    )[0];
    this.pointCount = points.length;
    this.latestValidatedGoodAt = latest?.validatedAt;
    this.nextAutomaticCheckAt =
      latest === undefined
        ? this.now().toISOString()
        : new Date(
            Date.parse(latest.validatedAt) +
              automaticIntervalMilliseconds,
          ).toISOString();
  }

  private now(): Date {
    return this.dependencies.now?.() ?? new Date();
  }

  private createOperationId(): string {
    const operationId =
      this.dependencies.operationIdFactory?.() ?? randomUUID();
    if (!operationIdPattern.test(operationId)) {
      throw new Error('RECOVERY_POINT_OPERATION_INVALID');
    }
    return operationId;
  }

  private observe(
    event: Parameters<ProfileRecoveryOperationalObserver['observe']>[0],
  ): void {
    observeProfileRecoverySafely(
      this.dependencies.observer ??
        noOpProfileRecoveryOperationalObserver,
      event,
    );
  }

  private async runExclusive<T>(
    operationState: Exclude<RecoveryPointOperationState, 'idle'>,
    operation: () => Promise<T>,
  ): Promise<T> {
    if (this.operationState !== 'idle') {
      throw new Error('RECOVERY_POINT_BUSY');
    }
    this.operationState = operationState;
    this.lastSafeErrorCode = undefined;
    try {
      const result = await operation();
      this.availability = 'available';
      return result;
    } catch (error) {
      this.lastSafeErrorCode = readSafeErrorCode(error);
      if (
        this.lastSafeErrorCode ===
          'RECOVERY_POINT_KEY_PROTECTION_UNAVAILABLE' ||
        this.lastSafeErrorCode === 'SECRET_STORAGE_UNAVAILABLE' ||
        isRecoveryPointCleanupUnverified(error)
      ) {
        this.availability = 'unavailable';
      }
      throw error;
    } finally {
      this.operationState = 'idle';
    }
  }
}

interface HealthySnapshot {
  operationRoot: string;
  receipt: ProfileInspectionReceipt;
  validation: Awaited<
    ReturnType<ProfileSnapshotInspectionPort['validateProfileSnapshot']>
  >;
}

export function isAutomaticPointDue(
  points: readonly RecoveryPointIndexEntry[],
  now: Date,
): boolean {
  const latestValidatedAt = points.reduce(
    (latest, point) =>
      Math.max(latest, Date.parse(point.validatedAt)),
    Number.NEGATIVE_INFINITY,
  );
  return (
    !Number.isFinite(latestValidatedAt) ||
    now.getTime() - latestValidatedAt >= automaticIntervalMilliseconds
  );
}

export function chooseAutomaticPointKind(
  points: readonly RecoveryPointIndexEntry[],
  now: Date,
): 'daily' | 'monthly' | 'weekly' {
  if (
    !points.some(
      (point) =>
        point.kind === 'monthly' &&
        isSameUtcMonth(new Date(point.validatedAt), now),
    )
  ) {
    return 'monthly';
  }
  if (
    !points.some(
      (point) =>
        point.kind === 'weekly' &&
        readIsoWeek(new Date(point.validatedAt)) === readIsoWeek(now),
    )
  ) {
    return 'weekly';
  }
  return 'daily';
}

function isSameUtcMonth(first: Date, second: Date): boolean {
  return (
    first.getUTCFullYear() === second.getUTCFullYear() &&
    first.getUTCMonth() === second.getUTCMonth()
  );
}

function readIsoWeek(date: Date): string {
  const normalized = new Date(
    Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth(),
      date.getUTCDate(),
    ),
  );
  const day = normalized.getUTCDay() || 7;
  normalized.setUTCDate(normalized.getUTCDate() + 4 - day);
  const yearStart = new Date(
    Date.UTC(normalized.getUTCFullYear(), 0, 1),
  );
  const week = Math.ceil(
    ((normalized.getTime() - yearStart.getTime()) / 86_400_000 + 1) /
      7,
  );
  return `${normalized.getUTCFullYear()}-${week
    .toString()
    .padStart(2, '0')}`;
}

export const recoveryPointAutomaticIntervalMilliseconds =
  automaticIntervalMilliseconds;
