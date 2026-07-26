import { isAbsolute } from 'node:path';

import { isDesktopRuntimeSession } from './runtimeSession.js';

export interface DesktopBackendStartMessage {
  config: {
    appVersion: string;
    backendRoot: string;
    createSmokePdf: boolean;
    databaseFilePath: string;
    invoiceDocumentStorageRoot: string;
    migrationsDirectory: string;
    operationalLogsRoot: string;
    runtimeSessionSecret: string;
    smokePdfPath: string;
  };
  type: 'start';
}

export interface DesktopBackendShutdownMessage {
  type: 'shutdown';
}

export type DesktopBackendCommand =
  | DesktopBackendShutdownMessage
  | DesktopBackendStartMessage;

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
  | 'BACKEND_MODULE_IMPORT_FAILED'
  | 'BACKEND_SECRET_BROKER_FAILED'
  | 'BACKEND_SERVER_START_FAILED'
  | 'BACKEND_SMOKE_PDF_FAILED';

export type DesktopBackendStatusMessage =
  | DesktopBackendFailedMessage
  | DesktopBackendReadyMessage;

const backendFailureCodes = new Set<DesktopBackendFailureCode>([
  'BACKEND_MODULE_IMPORT_FAILED',
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

export function parseDesktopBackendCommand(
  value: unknown,
): DesktopBackendCommand | undefined {
  if (!isRecord(value) || typeof value.type !== 'string') {
    return undefined;
  }

  if (value.type === 'shutdown') {
    return { type: 'shutdown' };
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
    'smokePdfPath',
  ] as const;

  if (
    typeof config.appVersion !== 'string' ||
    !/^[A-Za-z0-9.+_-]{1,80}$/.test(config.appVersion) ||
    typeof config.createSmokePdf !== 'boolean' ||
    !isDesktopRuntimeSession(config.runtimeSessionSecret) ||
    pathKeys.some((key) => !isSafeAbsolutePath(config[key]))
  ) {
    return undefined;
  }

  return {
    config: {
      appVersion: config.appVersion,
      backendRoot: config.backendRoot as string,
      createSmokePdf: config.createSmokePdf,
      databaseFilePath: config.databaseFilePath as string,
      invoiceDocumentStorageRoot: config.invoiceDocumentStorageRoot as string,
      migrationsDirectory: config.migrationsDirectory as string,
      operationalLogsRoot: config.operationalLogsRoot as string,
      runtimeSessionSecret: config.runtimeSessionSecret,
      smokePdfPath: config.smokePdfPath as string,
    },
    type: 'start',
  };
}

export function parseDesktopBackendStatus(
  value: unknown,
): DesktopBackendStatusMessage | undefined {
  if (!isRecord(value)) {
    return undefined;
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
