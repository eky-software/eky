import { basename, dirname, isAbsolute, join, resolve } from 'node:path';

import type { ProfileSnapshotMigrationPolicy } from '../profileBackup/profileSnapshotBrokerProtocol.js';
import { profileInspectionFailureCauses, type ProfileInspectionFailureCause } from './profileInspectionFailure.js';
import {
  profileInspectionMaximumCatalogBytes, profileInspectionMaximumDocumentCount, profileInspectionMaximumDocumentTotalBytes,
} from './profileInspectionDocumentBindings.js';
import { parseWorkspaceProcessReservationDescriptor, type WorkspaceProcessReservationDescriptor } from './workspaceProcessReservationDescriptor.js';

export const profileInspectionProtocolVersion = 1;
export const profileInspectionMaximumMessageBytes = 4 * 1024;
export const profileInspectionWorkMilliseconds = 35_000;
export const profileInspectionShutdownMilliseconds = 3_000;
export const profileInspectionV8HeapMiB = 512;

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const sha256Pattern = /^[0-9a-f]{64}$/;
const sessionPattern = /^[A-Za-z0-9_-]{43}$/;
const bindingKeys = ['generationId', 'operationId', 'protocolVersion', 'runtimeSession', 'type'];

export interface ProfileInspectionRequestIdentity {
  readonly protocolVersion: typeof profileInspectionProtocolVersion;
  readonly generationId: string;
  readonly operationId: string;
  readonly runtimeSession: string;
}

export interface ProfileInspectionDeployment {
  readonly backendRoot: string;
  readonly migrationsDirectory: string;
  readonly nativeResourceRoot: string;
}

export type ProfileInspectionMigrationPolicy = ProfileSnapshotMigrationPolicy | 'restoreCompatible';

export function isProfileInspectionMigrationPolicy(value: unknown): value is ProfileInspectionMigrationPolicy {
  return value === 'exactCurrentManifest' || value === 'compatibleHistoricalPrefix' || value === 'restoreCompatible';
}

/** Both owners derive the copy slot from the bound generation, never a child-supplied path. */
export function resolveProfileInspectionCopyRoot(descriptor: WorkspaceProcessReservationDescriptor): string {
  const reservation = parseWorkspaceProcessReservationDescriptor(descriptor);
  if (reservation === undefined) throw new Error('PROFILE_INSPECTION_PROTOCOL_INVALID');
  return join(dirname(reservation.userDataRoot), `profile-inspection-${reservation.generationId}`);
}

interface ProfileInspectionContentFields {
  readonly artifactIdentity: string;
  readonly artifactCount: number;
  readonly artifactTotalByteSize: number;
  readonly databaseHealth: 'healthy';
  readonly migrationChainIdentity: string;
  readonly profileId: string;
  readonly migrationPolicy: ProfileInspectionMigrationPolicy;
  readonly database: { readonly byteSize: number; readonly sha256: string };
}

export interface ProfileInspectionReceipt extends ProfileInspectionContentFields {
  readonly artifactCatalog: { readonly byteSize: number; readonly sha256: string };
}

export interface ProfileInspectionColdSources {
  readonly workspaceRoot: string;
  readonly databaseSlot: 'active' | 'staged';
  readonly documentsSlot: 'active' | 'staged';
}

export interface ColdProfileInspectionReceipt extends ProfileInspectionContentFields {
  readonly documentBindings: { readonly byteSize: number; readonly sha256: string };
  readonly migrationPolicy: 'restoreCompatible';
  readonly databaseSlot: ProfileInspectionColdSources['databaseSlot'];
  readonly documentsSlot: ProfileInspectionColdSources['documentsSlot'];
}

export interface ProfileInspectionOriginalSources {
  readonly workspaceRoot: string;
  readonly layout: 'profileRestore' | 'workspaceReplacement';
  readonly databaseSlot: 'active' | 'rollback' | 'absent';
  readonly documentsSlot: 'active' | 'rollback' | 'absent';
}

interface OriginalProfileInspectionFields {
  readonly sourceRole: 'original';
  readonly layout: ProfileInspectionOriginalSources['layout'];
  readonly documentsSlot: ProfileInspectionOriginalSources['documentsSlot'];
}

/** Absence echoes the main-owned journal/census selection, never a healthy DB. */
export type OriginalProfileInspectionReceipt = OriginalProfileInspectionFields & (
  | { readonly databaseSlot: 'absent' }
  | (ProfileInspectionContentFields & {
      readonly databaseSlot: 'active' | 'rollback';
      readonly migrationPolicy: 'restoreCompatible';
      readonly documentBindings: { readonly byteSize: number; readonly sha256: string };
    })
);

const contentReceiptKeys = ['artifactCount', 'artifactIdentity', 'artifactTotalByteSize', 'databaseHealth',
  'migrationChainIdentity', 'profileId', 'migrationPolicy', 'database'];

export interface ProfileInspectionActiveContext {
  readonly activeProfileId: string;
  readonly activeProfileIsEmpty: boolean;
}

export function isProfileInspectionOperationId(value: unknown): value is string {
  return typeof value === 'string' && uuidPattern.test(value);
}

export function parseProfileInspectionActiveContext(value: unknown): ProfileInspectionActiveContext | undefined {
  const row = dataRecord(value);
  if (row === undefined || !exactKeys(row, ['activeProfileId', 'activeProfileIsEmpty']) ||
      !isHash(row.activeProfileId) || typeof row.activeProfileIsEmpty !== 'boolean') return undefined;
  return Object.freeze({ activeProfileId: row.activeProfileId, activeProfileIsEmpty: row.activeProfileIsEmpty });
}

export type ProfileInspectionCommand = ProfileInspectionRequestIdentity & (
  | {
      readonly type: 'prepare';
      readonly kind: 'inspect' | 'prepareRestoreActivation';
      readonly migrationPolicy: ProfileInspectionMigrationPolicy;
      readonly deployment: ProfileInspectionDeployment;
      readonly reservation: WorkspaceProcessReservationDescriptor;
    }
  | {
      readonly type: 'prepare';
      readonly kind: 'inspectColdRestoreContent';
      readonly sources: ProfileInspectionColdSources;
      readonly deployment: ProfileInspectionDeployment;
      readonly reservation: WorkspaceProcessReservationDescriptor;
    }
  | {
      readonly type: 'prepare';
      readonly kind: 'inspectColdRestoreOriginal';
      readonly sources: ProfileInspectionOriginalSources;
      readonly deployment: ProfileInspectionDeployment;
      readonly reservation: WorkspaceProcessReservationDescriptor;
    }
  | { readonly type: 'grant' | 'shutdown' }
);

export type ProfileInspectionStatus =
  | { readonly type: 'ready'; readonly protocolVersion: typeof profileInspectionProtocolVersion }
  | (ProfileInspectionRequestIdentity & { readonly type: 'reservationReady'; readonly reservation: WorkspaceProcessReservationDescriptor })
  | (ProfileInspectionRequestIdentity & { readonly type: 'completed'; readonly result: ProfileInspectionReceipt })
  | (ProfileInspectionRequestIdentity & { readonly type: 'coldCompleted'; readonly result: ColdProfileInspectionReceipt })
  | (ProfileInspectionRequestIdentity & { readonly type: 'originalCompleted'; readonly result: OriginalProfileInspectionReceipt })
  | (ProfileInspectionRequestIdentity & { readonly type: 'failed'; readonly causeCode: ProfileInspectionFailureCause | 'unknown' });

export function createProfileInspectionCommand(value: ProfileInspectionCommand): ProfileInspectionCommand {
  const command = parseProfileInspectionCommand(value);
  if (command === undefined) throw new Error('PROFILE_INSPECTION_PROTOCOL_INVALID');
  return command;
}

export function createProfileInspectionStatus(value: ProfileInspectionStatus): ProfileInspectionStatus {
  const status = parseProfileInspectionStatus(value);
  if (status === undefined) throw new Error('PROFILE_INSPECTION_PROTOCOL_INVALID');
  return status;
}

export function parseProfileInspectionCommand(value: unknown): ProfileInspectionCommand | undefined {
  const row = dataRecord(value);
  if (row === undefined) return undefined;
  const identity = parseIdentity(row);
  if (identity === undefined) return undefined;
  if (row.type === 'grant' || row.type === 'shutdown') {
    if (!exactKeys(row, bindingKeys)) return undefined;
    return bounded(Object.freeze({ ...identity, type: row.type }));
  }
  if (row.type !== 'prepare') return undefined;
  const deployment = parseProfileInspectionDeployment(row.deployment);
  const reservation = parseReservation(row.reservation);
  if (deployment === undefined || reservation === undefined ||
      reservation.generationId !== identity.generationId ||
      basename(reservation.userDataRoot) !== identity.operationId) return undefined;
  if (row.kind === 'inspectColdRestoreContent') {
    const sources = parseProfileInspectionColdSources(row.sources);
    if (!exactKeys(row, [...bindingKeys, 'kind', 'sources', 'deployment', 'reservation']) || sources === undefined) return undefined;
    return bounded(Object.freeze({ ...identity, type: 'prepare' as const, kind: row.kind, sources, deployment, reservation }));
  }
  if (row.kind === 'inspectColdRestoreOriginal') {
    const sources = parseProfileInspectionOriginalSources(row.sources);
    if (!exactKeys(row, [...bindingKeys, 'kind', 'sources', 'deployment', 'reservation']) || sources === undefined) return undefined;
    return bounded(Object.freeze({ ...identity, type: 'prepare' as const, kind: row.kind, sources, deployment, reservation }));
  }
  if (!exactKeys(row, [...bindingKeys, 'kind', 'migrationPolicy', 'deployment', 'reservation']) ||
      (row.kind !== 'inspect' && row.kind !== 'prepareRestoreActivation') ||
      !isProfileInspectionMigrationPolicy(row.migrationPolicy)) return undefined;
  return bounded(Object.freeze({ ...identity, type: 'prepare' as const, kind: row.kind,
    migrationPolicy: row.migrationPolicy, deployment, reservation }));
}

export function parseProfileInspectionStatus(value: unknown): ProfileInspectionStatus | undefined {
  const row = dataRecord(value);
  if (row === undefined) return undefined;
  if (row.type === 'ready') {
    return exactKeys(row, ['protocolVersion', 'type']) && row.protocolVersion === profileInspectionProtocolVersion
      ? Object.freeze({ type: 'ready' as const, protocolVersion: profileInspectionProtocolVersion }) : undefined;
  }
  const identity = parseIdentity(row);
  if (identity === undefined) return undefined;
  if (row.type === 'reservationReady') {
    const reservation = parseReservation(row.reservation);
    if (!exactKeys(row, [...bindingKeys, 'reservation']) || reservation === undefined ||
        reservation.generationId !== identity.generationId || basename(reservation.userDataRoot) !== identity.operationId) return undefined;
    return bounded(Object.freeze({ ...identity, type: 'reservationReady' as const, reservation }));
  }
  if (row.type === 'failed') {
    if (!exactKeys(row, [...bindingKeys, 'causeCode']) || typeof row.causeCode !== 'string' ||
        (row.causeCode !== 'unknown' && !profileInspectionFailureCauses.some(cause => cause === row.causeCode))) return undefined;
    return bounded(Object.freeze({ ...identity, type: 'failed' as const, causeCode: row.causeCode as ProfileInspectionFailureCause | 'unknown' }));
  }
  if (!exactKeys(row, [...bindingKeys, 'result'])) return undefined;
  if (row.type === 'coldCompleted') {
    const result = parseColdProfileInspectionReceipt(row.result);
    return result === undefined ? undefined : bounded(Object.freeze({ ...identity, type: 'coldCompleted' as const, result }));
  }
  if (row.type === 'originalCompleted') {
    const result = parseOriginalProfileInspectionReceipt(row.result);
    return result === undefined ? undefined : bounded(Object.freeze({ ...identity, type: 'originalCompleted' as const, result }));
  }
  if (row.type !== 'completed') return undefined;
  const result = parseProfileInspectionReceipt(row.result);
  return result === undefined ? undefined : bounded(Object.freeze({ ...identity, type: 'completed' as const, result }));
}

export function parseProfileInspectionDeployment(value: unknown): ProfileInspectionDeployment | undefined {
  const row = dataRecord(value);
  if (row === undefined || !exactKeys(row, ['backendRoot', 'migrationsDirectory', 'nativeResourceRoot']) ||
      ![row.backendRoot, row.migrationsDirectory, row.nativeResourceRoot].every(isPath)) return undefined;
  return Object.freeze({
    backendRoot: row.backendRoot as string,
    migrationsDirectory: row.migrationsDirectory as string,
    nativeResourceRoot: row.nativeResourceRoot as string,
  });
}

export function parseProfileInspectionReceipt(value: unknown): ProfileInspectionReceipt | undefined {
  const row = dataRecord(value);
  if (row === undefined || !exactKeys(row, [...contentReceiptKeys, 'artifactCatalog'])) return undefined;
  const content = parseContentFields(row);
  const artifactCatalog = parseFileReceipt(row.artifactCatalog, profileInspectionMaximumCatalogBytes);
  if (content === undefined || artifactCatalog === undefined) return undefined;
  return Object.freeze({ ...content, artifactCatalog });
}

export function parseColdProfileInspectionReceipt(value: unknown): ColdProfileInspectionReceipt | undefined {
  const row = dataRecord(value, 11);
  if (row === undefined || !exactKeys(row, [...contentReceiptKeys, 'databaseSlot', 'documentsSlot', 'documentBindings']) ||
      row.migrationPolicy !== 'restoreCompatible' || !isContentSlot(row.databaseSlot) || !isContentSlot(row.documentsSlot)) return undefined;
  const content = parseContentFields(row);
  const documentBindings = parseFileReceipt(row.documentBindings, profileInspectionMaximumCatalogBytes);
  return content === undefined || documentBindings === undefined ? undefined : Object.freeze({ ...content, documentBindings,
    migrationPolicy: 'restoreCompatible' as const, databaseSlot: row.databaseSlot, documentsSlot: row.documentsSlot });
}

export function parseProfileInspectionColdSources(value: unknown): ProfileInspectionColdSources | undefined {
  const row = dataRecord(value);
  if (row === undefined || !exactKeys(row, ['workspaceRoot', 'databaseSlot', 'documentsSlot']) ||
      !isPath(row.workspaceRoot) || !isContentSlot(row.databaseSlot) || !isContentSlot(row.documentsSlot)) return undefined;
  return Object.freeze({ workspaceRoot: row.workspaceRoot, databaseSlot: row.databaseSlot, documentsSlot: row.documentsSlot });
}

export function parseProfileInspectionOriginalSources(value: unknown): ProfileInspectionOriginalSources | undefined {
  const row = dataRecord(value);
  if (row === undefined || !exactKeys(row, ['workspaceRoot', 'layout', 'databaseSlot', 'documentsSlot']) ||
      !isPath(row.workspaceRoot) || !isOriginalLayout(row.layout) ||
      !isOriginalSlot(row.databaseSlot) || !isOriginalSlot(row.documentsSlot)) return undefined;
  return Object.freeze({ workspaceRoot: row.workspaceRoot, layout: row.layout,
    databaseSlot: row.databaseSlot, documentsSlot: row.documentsSlot });
}

export function parseOriginalProfileInspectionReceipt(value: unknown): OriginalProfileInspectionReceipt | undefined {
  const row = dataRecord(value, 13);
  const originalKeys = ['sourceRole', 'layout', 'databaseSlot', 'documentsSlot'];
  if (row === undefined || row.sourceRole !== 'original' || !isOriginalLayout(row.layout) ||
      !isOriginalSlot(row.databaseSlot) || !isOriginalSlot(row.documentsSlot)) return undefined;
  const original = { sourceRole: 'original' as const, layout: row.layout, documentsSlot: row.documentsSlot };
  if (row.databaseSlot === 'absent') {
    return exactKeys(row, originalKeys) ? Object.freeze({ ...original, databaseSlot: 'absent' as const }) : undefined;
  }
  if (!exactKeys(row, [...originalKeys, ...contentReceiptKeys, 'documentBindings']) ||
      row.migrationPolicy !== 'restoreCompatible' ||
      (row.documentsSlot === 'absent' && (row.artifactCount !== 0 || row.artifactTotalByteSize !== 0))) return undefined;
  const content = parseContentFields(row);
  const documentBindings = parseFileReceipt(row.documentBindings, profileInspectionMaximumCatalogBytes);
  return content === undefined || documentBindings === undefined ? undefined : Object.freeze({ ...original, ...content,
    migrationPolicy: 'restoreCompatible' as const, databaseSlot: row.databaseSlot, documentBindings });
}

function isOriginalLayout(value: unknown): value is ProfileInspectionOriginalSources['layout'] {
  return value === 'profileRestore' || value === 'workspaceReplacement';
}

function isOriginalSlot(value: unknown): value is ProfileInspectionOriginalSources['databaseSlot'] {
  return value === 'active' || value === 'rollback' || value === 'absent';
}

function isContentSlot(value: unknown): value is 'active' | 'staged' {
  return value === 'active' || value === 'staged';
}

function parseContentFields(row: Record<string, unknown>): ProfileInspectionContentFields | undefined {
  if (row.databaseHealth !== 'healthy' || !isProfileInspectionMigrationPolicy(row.migrationPolicy) ||
      !isNumber(row.artifactCount, 0, profileInspectionMaximumDocumentCount) ||
      !isNumber(row.artifactTotalByteSize, 0, profileInspectionMaximumDocumentTotalBytes) ||
      !isHash(row.migrationChainIdentity) || !isHash(row.profileId) || !isHash(row.artifactIdentity)) return undefined;
  const database = parseFileReceipt(row.database, 24 * 1024 ** 3);
  if (database === undefined) return undefined;
  return Object.freeze({
    artifactCount: row.artifactCount, artifactIdentity: row.artifactIdentity,
    artifactTotalByteSize: row.artifactTotalByteSize,
    databaseHealth: 'healthy' as const, migrationPolicy: row.migrationPolicy,
    migrationChainIdentity: row.migrationChainIdentity, profileId: row.profileId,
    database,
  });
}

function parseFileReceipt(value: unknown, maximumBytes: number): ProfileInspectionReceipt['database'] | undefined {
  const row = dataRecord(value);
  if (row === undefined || !exactKeys(row, ['byteSize', 'sha256']) ||
      !isNumber(row.byteSize, 1, maximumBytes) || !isHash(row.sha256)) return undefined;
  return Object.freeze({ byteSize: row.byteSize, sha256: row.sha256 });
}

function parseIdentity(row: Record<string, unknown>): ProfileInspectionRequestIdentity | undefined {
  if (row.protocolVersion !== profileInspectionProtocolVersion ||
      typeof row.generationId !== 'string' || !uuidPattern.test(row.generationId) ||
      typeof row.operationId !== 'string' || !uuidPattern.test(row.operationId) ||
      typeof row.runtimeSession !== 'string' || !sessionPattern.test(row.runtimeSession)) return undefined;
  return Object.freeze({ protocolVersion: profileInspectionProtocolVersion,
    generationId: row.generationId, operationId: row.operationId, runtimeSession: row.runtimeSession });
}

function dataRecord(value: unknown, maximumKeys = 9): Record<string, unknown> | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
  try {
    const prototype: unknown = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return undefined;
    const keys = Reflect.ownKeys(value);
    if (keys.length > maximumKeys || keys.some(key => typeof key !== 'string')) return undefined;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const record: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const key of keys as string[]) {
      const descriptor = descriptors[key]!;
      if (!Object.hasOwn(descriptor, 'value')) return undefined;
      record[key] = descriptor.value;
    }
    return record;
  } catch { return undefined; }
}

function parseReservation(value: unknown): WorkspaceProcessReservationDescriptor | undefined {
  const row = dataRecord(value);
  return row === undefined ? undefined : parseWorkspaceProcessReservationDescriptor(row);
}

function exactKeys(row: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(row).length === keys.length && keys.every(key => Object.hasOwn(row, key));
}

function isPath(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 4_096 &&
    !value.includes('\0') && isAbsolute(value) && resolve(value) === value;
}

function isNumber(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum && value <= maximum;
}

function isHash(value: unknown): value is string {
  return typeof value === 'string' && sha256Pattern.test(value);
}

function bounded<T>(value: T): T | undefined {
  return Buffer.byteLength(JSON.stringify(value), 'utf8') <= profileInspectionMaximumMessageBytes ? value : undefined;
}
