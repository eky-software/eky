import { isAbsolute } from 'node:path';

import { isDesktopRuntimeSession } from './runtimeSession.js';

export interface DesktopBackendStartMessage {
  config: {
    appVersion: string;
    architecture: string;
    backendRoot: string;
    buildCreatedAt: string;
    buildDirty: boolean;
    buildRevision: string;
    createSmokePdf: boolean;
    databaseFilePath: string;
    electronVersion: string;
    invoiceDocumentStorageRoot: string;
    migrationsDirectory: string;
    migrationStartupPolicy:
      | 'exactCurrentManifest'
      | 'restoreCompatible';
    operationalLogsRoot: string;
    platform: string;
    profileSnapshotStagingRoot: string;
    runtimeInstanceId: string;
    runtimeSessionSecret: string;
    smokePdfPath: string;
    verifySmokeSecretBroker: boolean;
  };
  type: 'start';
}

export interface DesktopBackendShutdownMessage {
  type: 'shutdown';
}

export interface DesktopBackendContinueStartupMessage {
  type: 'continueStartup';
}

export interface DesktopBackendAbortStartupMessage {
  type: 'abortStartup';
}

export type DesktopBackendCommand =
  | DesktopBackendAbortStartupMessage
  | DesktopBackendContinueStartupMessage
  | DesktopBackendShutdownMessage
  | DesktopBackendStartMessage;

export interface DesktopBackendMigrationGateReadyMessage {
  inspection: {
    appliedMigrationCount: number;
    migrationChainIdentity: string;
    pendingMigrationCount: number;
    profileState: 'empty' | 'existing';
  };
  type: 'migrationGateReady';
}

export interface DesktopBackendReadyMessage {
  port: number;
  smokePdfCreated: boolean;
  smokeSecretBrokerVerified: boolean;
  type: 'ready';
}

export interface DesktopBackendFailedMessage {
  code: DesktopBackendFailureCode;
  type: 'failed';
}

export type DesktopBackendFailureCode =
  | 'BACKEND_INVOICE_PDF_ARCHIVE_BROKER_FAILED'
  | 'BACKEND_MODULE_IMPORT_FAILED'
  | 'BACKEND_MIGRATION_STARTUP_GATE_FAILED'
  | 'BACKEND_PROFILE_SNAPSHOT_BROKER_FAILED'
  | 'BACKEND_SECRET_BROKER_FAILED'
  | 'BACKEND_SERVER_START_FAILED'
  | 'BACKEND_SMOKE_PDF_FAILED';

export type DesktopBackendStatusMessage =
  | DesktopBackendFailedMessage
  | DesktopBackendMigrationGateReadyMessage
  | DesktopBackendReadyMessage;

const backendFailureCodes = new Set<DesktopBackendFailureCode>([
  'BACKEND_INVOICE_PDF_ARCHIVE_BROKER_FAILED',
  'BACKEND_MODULE_IMPORT_FAILED',
  'BACKEND_MIGRATION_STARTUP_GATE_FAILED',
  'BACKEND_PROFILE_SNAPSHOT_BROKER_FAILED',
  'BACKEND_SECRET_BROKER_FAILED',
  'BACKEND_SERVER_START_FAILED',
  'BACKEND_SMOKE_PDF_FAILED',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isSafeAbsolutePath(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 4096 &&
    !value.includes('\0') &&
    isAbsolute(value)
  );
}

const buildRevisionPattern = /^(?:[0-9a-f]{7,40}|development)$/;
const utcIsoTimestampPattern =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const runtimeInstanceIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function parseDesktopBackendCommand(
  value: unknown,
): DesktopBackendCommand | undefined {
  if (!isRecord(value) || typeof value.type !== 'string') {
    return undefined;
  }

  if (value.type === 'shutdown') {
    return { type: 'shutdown' };
  }

  if (value.type === 'continueStartup') {
    return hasExactKeys(value, ['type'])
      ? { type: 'continueStartup' }
      : undefined;
  }

  if (value.type === 'abortStartup') {
    return hasExactKeys(value, ['type'])
      ? { type: 'abortStartup' }
      : undefined;
  }

  if (value.type !== 'start' || !isRecord(value.config)) {
    return undefined;
  }

  const config = value.config;
  const pathKeys = [
    'backendRoot',
    'databaseFilePath',
    'invoiceDocumentStorageRoot',
    'migrationsDirectory',
    'operationalLogsRoot',
    'profileSnapshotStagingRoot',
    'smokePdfPath',
  ] as const;

  if (
    typeof config.appVersion !== 'string' ||
    !/^[A-Za-z0-9.+_-]{1,80}$/.test(config.appVersion) ||
    typeof config.architecture !== 'string' ||
    !/^[A-Za-z0-9._-]{1,40}$/.test(config.architecture) ||
    !isUtcIsoTimestamp(config.buildCreatedAt) ||
    typeof config.buildDirty !== 'boolean' ||
    typeof config.buildRevision !== 'string' ||
    !buildRevisionPattern.test(config.buildRevision) ||
    typeof config.createSmokePdf !== 'boolean' ||
    typeof config.electronVersion !== 'string' ||
    !/^[A-Za-z0-9.+_-]{1,80}$/.test(config.electronVersion) ||
    (config.migrationStartupPolicy !== 'exactCurrentManifest' &&
      config.migrationStartupPolicy !== 'restoreCompatible') ||
    typeof config.platform !== 'string' ||
    !/^[A-Za-z0-9._-]{1,40}$/.test(config.platform) ||
    typeof config.runtimeInstanceId !== 'string' ||
    !runtimeInstanceIdPattern.test(config.runtimeInstanceId) ||
    !isDesktopRuntimeSession(config.runtimeSessionSecret) ||
    typeof config.verifySmokeSecretBroker !== 'boolean' ||
    pathKeys.some((key) => !isSafeAbsolutePath(config[key]))
  ) {
    return undefined;
  }

  return {
    config: {
      appVersion: config.appVersion,
      architecture: config.architecture,
      backendRoot: config.backendRoot as string,
      buildCreatedAt: config.buildCreatedAt,
      buildDirty: config.buildDirty,
      buildRevision: config.buildRevision,
      createSmokePdf: config.createSmokePdf,
      databaseFilePath: config.databaseFilePath as string,
      electronVersion: config.electronVersion,
      invoiceDocumentStorageRoot: config.invoiceDocumentStorageRoot as string,
      migrationsDirectory: config.migrationsDirectory as string,
      migrationStartupPolicy: config.migrationStartupPolicy,
      operationalLogsRoot: config.operationalLogsRoot as string,
      platform: config.platform,
      profileSnapshotStagingRoot:
        config.profileSnapshotStagingRoot as string,
      runtimeInstanceId: config.runtimeInstanceId,
      runtimeSessionSecret: config.runtimeSessionSecret,
      smokePdfPath: config.smokePdfPath as string,
      verifySmokeSecretBroker: config.verifySmokeSecretBroker,
    },
    type: 'start',
  };
}

function isUtcIsoTimestamp(value: unknown): value is string {
  if (typeof value !== 'string' || !utcIsoTimestampPattern.test(value)) {
    return false;
  }

  const timestamp = Date.parse(value);
  return (
    Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value
  );
}

export function parseDesktopBackendStatus(
  value: unknown,
): DesktopBackendStatusMessage | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  if (
    value.type === 'migrationGateReady' &&
    hasExactKeys(value, ['inspection', 'type']) &&
    isMigrationStartupInspection(value.inspection)
  ) {
    return {
      inspection: {
        appliedMigrationCount: value.inspection.appliedMigrationCount,
        migrationChainIdentity: value.inspection.migrationChainIdentity,
        pendingMigrationCount: value.inspection.pendingMigrationCount,
        profileState: value.inspection.profileState,
      },
      type: 'migrationGateReady',
    };
  }

  if (
    value.type === 'failed' &&
    typeof value.code === 'string' &&
    backendFailureCodes.has(value.code as DesktopBackendFailureCode)
  ) {
    return { code: value.code as DesktopBackendFailureCode, type: 'failed' };
  }

  if (
    value.type === 'ready' &&
    Number.isInteger(value.port) &&
    typeof value.port === 'number' &&
    value.port >= 1 &&
    value.port <= 65535 &&
    typeof value.smokePdfCreated === 'boolean' &&
    typeof value.smokeSecretBrokerVerified === 'boolean'
  ) {
    return {
      port: value.port,
      smokePdfCreated: value.smokePdfCreated,
      smokeSecretBrokerVerified: value.smokeSecretBrokerVerified,
      type: 'ready',
    };
  }

  return undefined;
}

function isMigrationStartupInspection(value: unknown): value is {
  appliedMigrationCount: number;
  migrationChainIdentity: string;
  pendingMigrationCount: number;
  profileState: 'empty' | 'existing';
} {
  return (
    isRecord(value) &&
    hasExactKeys(value, [
      'appliedMigrationCount',
      'migrationChainIdentity',
      'pendingMigrationCount',
      'profileState',
    ]) &&
    isBoundedMigrationCount(value.appliedMigrationCount) &&
    isBoundedMigrationCount(value.pendingMigrationCount) &&
    typeof value.migrationChainIdentity === 'string' &&
    (value.migrationChainIdentity === '' ||
      /^[0-9a-f]{64}$/.test(value.migrationChainIdentity)) &&
    (value.profileState === 'empty' || value.profileState === 'existing') &&
    (value.profileState !== 'empty' ||
      (value.appliedMigrationCount === 0 &&
        value.migrationChainIdentity === '')) &&
    (value.profileState !== 'existing' ||
      (value.appliedMigrationCount > 0 &&
        value.migrationChainIdentity !== ''))
  );
}

function isBoundedMigrationCount(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= 10_000
  );
}

function hasExactKeys(
  value: Record<string, unknown>,
  expectedKeys: readonly string[],
): boolean {
  const actualKeys = Object.keys(value);
  return (
    actualKeys.length === expectedKeys.length &&
    expectedKeys.every((key) => actualKeys.includes(key))
  );
}
