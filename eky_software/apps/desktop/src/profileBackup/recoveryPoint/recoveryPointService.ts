import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';

import { createProfileBackupSourceEntries } from '../createProfileBackupSourceEntries.js';
import type { ProfileSnapshotBrokerClient } from '../profileSnapshotBrokerClient.js';
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
    ProfileSnapshotBrokerClient,
    | 'beginMaintenance'
    | 'createProfileSnapshot'
    | 'endMaintenance'
    | 'validateProfileSnapshot'
  >;
  rotation: Pick<
    RecoveryPointRotationService,
    'maintain' | 'resumePending'
  >;
  stagingRoot: string;
  store: Pick<RecoveryPointStore, 'create' | 'list'>;
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
    return this.runExclusive('checking', async () =>
      this.withHealthySnapshot(correlationId, async (snapshot) => {
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
        this.observe({
          correlationId,
          eventName: 'recoveryPoint.started',
          recoveryPointKind: kind,
          stage: 'creation',
        });
        const point = await this.persistSnapshot(snapshot, kind);
        this.observe({
          correlationId,
          durationMs: Date.now() - startedAt,
          eventName: 'recoveryPoint.completed',
          recoveryPointKind: kind,
          stage: 'creation',
        });
        return point;
      }),
    );
  }

  createManual(): Promise<RecoveryPointIndexEntry> {
    return this.createNamedPoint('manual');
  }

  createPreMigration(): Promise<RecoveryPointIndexEntry> {
    return this.createNamedPoint('preUpdate');
  }

  createPreRestore(): Promise<RecoveryPointIndexEntry> {
    return this.createNamedPoint('preRestore');
  }

  createPreUpdate(): Promise<RecoveryPointIndexEntry> {
    return this.createNamedPoint('preUpdate');
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
  ): Promise<RecoveryPointIndexEntry> {
    const correlationId = this.createOperationId();
    const startedAt = Date.now();
    this.observe({
      correlationId,
      eventName: 'recoveryPoint.started',
      recoveryPointKind: kind,
      stage: 'creation',
    });
    return this.runExclusive('creating', () =>
      this.withHealthySnapshot(correlationId, (snapshot) =>
        this.persistSnapshot(snapshot, kind),
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
          errorCode: readSafeErrorCode(error),
          eventName: 'recoveryPoint.failed',
          recoveryPointKind: kind,
          retryable: true,
          sideEffectState: 'unknown',
          stage: 'creation',
        });
        throw error;
      },
    );
  }

  private async persistSnapshot(
    snapshot: HealthySnapshot,
    kind: RecoveryPointKind,
  ): Promise<RecoveryPointIndexEntry> {
    const timestamp = this.now();
    const point = await this.dependencies.store.create({
      entries: await createProfileBackupSourceEntries(
        snapshot.operationRoot,
      ),
      kind,
      manifest: {
        appVersion: this.dependencies.appVersion,
        createdAtEpochMilliseconds: BigInt(timestamp.getTime()),
        migrationChainIdentity:
          snapshot.validation.migrationChainIdentity,
        profileId: snapshot.validation.profileId,
      },
      validatedAt: timestamp.toISOString(),
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

  private async withHealthySnapshot<T>(
    operationId: string,
    useSnapshot: (snapshot: HealthySnapshot) => Promise<T>,
  ): Promise<T> {
    if (!operationIdPattern.test(operationId)) {
      throw new Error('RECOVERY_POINT_OPERATION_INVALID');
    }
    const operationRoot = join(
      this.dependencies.stagingRoot,
      operationId,
    );
    let maintenanceStarted = false;

    try {
      await this.dependencies.profileSnapshotClient.beginMaintenance(
        operationId,
      );
      maintenanceStarted = true;
      await this.dependencies.profileSnapshotClient.createProfileSnapshot(
        operationId,
      );
      const validation =
        await this.dependencies.profileSnapshotClient.validateProfileSnapshot(
          operationId,
        );
      if (
        validation.databaseHealth !== 'healthy' ||
        !validation.profileMatchesActive
      ) {
        throw new Error('RECOVERY_POINT_SOURCE_UNHEALTHY');
      }
      return await useSnapshot({
        operationRoot,
        validation,
      });
    } finally {
      if (maintenanceStarted) {
        await this.dependencies.profileSnapshotClient
          .endMaintenance(operationId)
          .catch(() => undefined);
      }
      await rm(operationRoot, { force: true, recursive: true }).catch(
        () => undefined,
      );
    }
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
        this.lastSafeErrorCode === 'SECRET_STORAGE_UNAVAILABLE'
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
  validation: Awaited<
    ReturnType<ProfileSnapshotBrokerClient['validateProfileSnapshot']>
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

function readSafeErrorCode(error: unknown): string {
  if (
    error instanceof Error &&
    'code' in error &&
    typeof error.code === 'string' &&
    /^[A-Z][A-Z0-9_]{2,100}$/.test(error.code)
  ) {
    return error.code;
  }
  if (
    error instanceof Error &&
    /^[A-Z][A-Z0-9_]{2,100}$/.test(error.message)
  ) {
    return error.message;
  }
  return 'RECOVERY_POINT_OPERATION_FAILED';
}

export const recoveryPointAutomaticIntervalMilliseconds =
  automaticIntervalMilliseconds;
