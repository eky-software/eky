import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import { gunzipSync } from 'node:zlib';

import type { BrowserWindow } from 'electron';
import { isPackagedBuildRevision } from '../release/desktopBuildInfo.js';
import {
  desktopOnlySupportBundleFormatVersion,
  desktopOnlySupportBundleKind,
  desktopOnlySupportBundleSections,
  isSupportBundleTechnicalId,
  readSupportBundleDesktopData,
  type SupportBundleDesktopData,
  type SupportBundleDesktopSystem,
} from '../supportBundle/supportBundleDesktopData.js';
import { hasExactDataKeys, isPlainDataRecord } from '../workspaces/registry/workspaceRegistryValueShape.js';
import { validatePackagedDiagnosticEvidence } from './packagedDiagnosticEvidence.js';

import {
  maximumUncompressedSupportBundleBytes,
  supportBundleFormatVersion,
} from '../supportBundle/supportBundleArchive.js';

const sha256ChecksumPattern = /^[0-9a-f]{64}$/;

const forbiddenSerializedMarkers = [
  'actorId',
  'actorUserId',
  'authorization',
  'companyId',
  'cookie',
  'emailBody',
  'entityId',
  'entityType',
  'iban',
  'mime',
  'password',
  'requestBody',
  'responseBody',
  'stack',
  'token',
  'userData',
];

type PackagedSupportBundleSmokeOptions = {
  mainWindow: Pick<BrowserWindow, 'webContents'>;
  observeFailure?(error: unknown): void;
  supportBundlePath: string;
} & (
  | { kind?: 'full'; appVersion: string; buildRevision: string; runtimeSessionSecret: string }
  | { kind: typeof desktopOnlySupportBundleKind; system: Readonly<SupportBundleDesktopSystem> }
);

export async function runPackagedSupportBundleSmoke(options: PackagedSupportBundleSmokeOptions): Promise<void> {
  if (options.kind !== undefined && options.kind !== 'full' && options.kind !== desktopOnlySupportBundleKind) {
    throw new Error('DESKTOP_SMOKE_SUPPORT_BUNDLE_INVALID');
  }
  const { mainWindow, observeFailure, supportBundlePath } = options;
  let firstFailure: { error: Error } | undefined;
  try {
    let validate: (document: unknown) => void;
    if (options.kind === desktopOnlySupportBundleKind) {
      const system = Object.freeze({ ...options.system });
      validate = document => { validateDesktopOnlySupportBundleDocument(document, system); };
    } else {
      const identity = Object.freeze({ appVersion: options.appVersion, buildRevision: options.buildRevision,
        runtimeSessionSecret: options.runtimeSessionSecret });
      validate = document => { validateSupportBundleDocument(document, identity); };
    }
    await mkdir(dirname(supportBundlePath), { recursive: true });
    const result: unknown =
      await mainWindow.webContents.executeJavaScript(
        `window.ekyDesktop.createSupportBundle()`,
        true,
      );
    if (result !== 'created') {
      throw new Error('DESKTOP_SMOKE_SUPPORT_BUNDLE_CREATE_FAILED');
    }

    const metadata = await lstat(supportBundlePath);
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      throw new Error('DESKTOP_SMOKE_SUPPORT_BUNDLE_FILE_FAILED');
    }
    const compressed = await readFile(supportBundlePath);
    const uncompressed = gunzipSync(compressed, {
      maxOutputLength: maximumUncompressedSupportBundleBytes,
    });
    const document = JSON.parse(uncompressed.toString('utf8')) as unknown;

    validate(document);
  } catch (error) {
    try { observeFailure?.(error); } catch { /* Private evidence must not change the result. */ }
    const safeError =
      error instanceof Error &&
      /^DESKTOP_SMOKE_SUPPORT_BUNDLE_[A-Z_]+$/.test(error.message)
        ? error : new Error('DESKTOP_SMOKE_SUPPORT_BUNDLE_INVALID');
    firstFailure = { error: safeError };
    throw safeError;
  } finally {
    try { await rm(supportBundlePath, { force: true }); }
    catch (error) {
      try { observeFailure?.(error); } catch { /* Keep the original result and cleanup failure. */ }
      const cleanup = new Error('DESKTOP_SMOKE_SUPPORT_BUNDLE_CLEANUP_FAILED');
      if (firstFailure !== undefined) {
        throw new AggregateError([firstFailure.error, cleanup], firstFailure.error.message, { cause: firstFailure.error });
      }
      throw cleanup;
    }
  }
}

export function validateSupportBundleDocument(
  value: unknown,
  expected: {
    appVersion: string;
    buildRevision: string;
    runtimeSessionSecret: string;
  },
): void {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      'database',
      'diagnosticEvents',
      'incidentSummaries',
      'manifest',
      'operationalSummary',
      'runtimeSummary',
      'system',
    ]) ||
    !isRecord(value.manifest) ||
    value.manifest.supportBundleFormatVersion !==
      supportBundleFormatVersion ||
    value.manifest.diagnosticPeriodDays !== 30 ||
    !Array.isArray(value.manifest.truncatedSections) ||
    value.manifest.truncatedSections.some(
      (section) =>
        section !== 'diagnosticEvents' &&
        section !== 'incidentSummaries',
    ) ||
    !isRecord(value.system) ||
    value.system.appVersion !== expected.appVersion ||
    value.system.backendVersion !== expected.appVersion ||
    !isRecord(value.runtimeSummary) ||
    value.runtimeSummary.appVersion !== expected.appVersion ||
    value.runtimeSummary.buildRevision !== expected.buildRevision ||
    !isRecord(value.database) ||
    value.database.health !== 'ok' ||
    !Number.isSafeInteger(value.database.appliedMigrationCount) ||
    !Array.isArray(value.diagnosticEvents) ||
    value.manifest.truncatedSections.includes('diagnosticEvents') ||
    !hasExpectedSmokeDiagnosticEvent(value.diagnosticEvents) ||
    !Array.isArray(value.incidentSummaries) ||
    !hasExpectedMinimizedSmokeIncident(value.incidentSummaries) ||
    !isRecord(value.manifest.sectionChecksums)
  ) {
    throw new Error('DESKTOP_SMOKE_SUPPORT_BUNDLE_INVALID');
  }

  const sections = {
    database: value.database,
    diagnosticEvents: value.diagnosticEvents,
    incidentSummaries: value.incidentSummaries,
    operationalSummary: value.operationalSummary,
    runtimeSummary: value.runtimeSummary,
    system: value.system,
  };
  const sectionChecksums = value.manifest.sectionChecksums;
  if (
    !hasOnlyKeys(
      sectionChecksums,
      Object.keys(sections),
    ) ||
    Object.entries(sections).some(
      ([name, section]) =>
        sectionChecksums[name] !== checksum(section),
    )
  ) {
    throw new Error('DESKTOP_SMOKE_SUPPORT_BUNDLE_CHECKSUM_FAILED');
  }

  validatePackagedDiagnosticEvidence({
    backendVersion: value.system.backendVersion,
    database: value.database,
    diagnosticEvents: value.diagnosticEvents,
    diagnosticPeriodDays: value.manifest.diagnosticPeriodDays,
    incidentSummaries: value.incidentSummaries,
    incidentSummariesTruncated: value.manifest.truncatedSections.includes('incidentSummaries'),
    runtimeSummary: value.runtimeSummary,
    truncated: false,
  });

  const serialized = JSON.stringify(value);
  if (
    serialized.includes(expected.runtimeSessionSecret) ||
    serialized.includes('eky-http-secret-smoke-') ||
    serialized.includes('eky-safe-storage-smoke-') ||
    serialized.includes('@') ||
    forbiddenSerializedMarkers.some((marker) =>
      serialized.toLowerCase().includes(marker.toLowerCase()),
    )
  ) {
    throw new Error('DESKTOP_SMOKE_SUPPORT_BUNDLE_CONTENT_FAILED');
  }
}

export function validateDesktopOnlySupportBundleDocument(
  value: unknown,
  expected: Readonly<SupportBundleDesktopSystem>,
): Readonly<SupportBundleDesktopData> {
  let data: Readonly<SupportBundleDesktopData>;
  let sectionChecksums: Record<string, unknown>;
  let document: Record<string, unknown>;
  try {
    if (!isPlainDataRecord(value) || !hasExactDataKeys(value, ['manifest', ...desktopOnlySupportBundleSections])) {
      throw new Error('DESKTOP_SMOKE_SUPPORT_BUNDLE_INVALID');
    }
    document = value;
    const manifest = value.manifest;
    if (!isPlainDataRecord(manifest) || !hasExactDataKeys(manifest, [
      'supportBundleFormatVersion', 'kind', 'createdAt', 'creationCorrelationId', 'sectionChecksums',
    ]) || manifest.supportBundleFormatVersion !== desktopOnlySupportBundleFormatVersion ||
        manifest.kind !== desktopOnlySupportBundleKind || typeof manifest.createdAt !== 'string' ||
        !Number.isFinite(Date.parse(manifest.createdAt)) || new Date(manifest.createdAt).toISOString() !== manifest.createdAt ||
        !isSupportBundleTechnicalId(manifest.creationCorrelationId) ||
        !isPlainDataRecord(manifest.sectionChecksums) || !hasExactDataKeys(manifest.sectionChecksums, desktopOnlySupportBundleSections) ||
        Object.values(manifest.sectionChecksums).some(value => typeof value !== 'string' || !sha256ChecksumPattern.test(value))) {
      throw new Error('DESKTOP_SMOKE_SUPPORT_BUNDLE_INVALID');
    }
    sectionChecksums = manifest.sectionChecksums;
    data = readSupportBundleDesktopData({ system: value.system, availability: value.availability, observation: value.observation });
    if (!isPackagedBuildRevision(expected.buildRevision) ||
        data.system.appVersion !== expected.appVersion || data.system.buildRevision !== expected.buildRevision ||
        data.system.electronVersion !== expected.electronVersion || data.system.platform !== expected.platform ||
        data.system.architecture !== expected.architecture) {
      throw new Error('DESKTOP_SMOKE_SUPPORT_BUNDLE_INVALID');
    }
  } catch {
    throw new Error('DESKTOP_SMOKE_SUPPORT_BUNDLE_INVALID');
  }
  // Hash the validated wire sections, not the projection's canonical key order.
  if (desktopOnlySupportBundleSections.some(name => sectionChecksums[name] !== checksum(document[name]))) {
    throw new Error('DESKTOP_SMOKE_SUPPORT_BUNDLE_CHECKSUM_FAILED');
  }
  return data;
}

function hasExpectedSmokeDiagnosticEvent(values: unknown[]): boolean {
  return values.some(
    (value) =>
      isRecord(value) &&
      value.category === 'security' &&
      value.component === 'desktop' &&
      value.errorCode === null &&
      value.eventName === 'applicationWindow.newWindowBlocked' &&
      value.level === 'warn' &&
      value.outcome === 'blocked' &&
      value.stage === 'window-open',
  );
}

function hasExpectedMinimizedSmokeIncident(values: unknown[]): boolean {
  const allowedKeys = [
    'appVersion',
    'buildRevision',
    'count',
    'errorCode',
    'eventName',
    'fingerprint',
    'firstOccurredAt',
    'lastOccurredAt',
    'outcome',
  ] as const;

  return values.some(
    (value) =>
      isRecord(value) &&
      hasOnlyKeys(value, allowedKeys) &&
      value.eventName === 'applicationWindow.newWindowBlocked' &&
      value.errorCode === 'DESKTOP_SECURITY_EVENT_BLOCKED' &&
      value.outcome === 'blocked' &&
      typeof value.count === 'number' &&
      value.count >= 1,
  );
}

function checksum(value: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(value), 'utf8')
    .digest('hex');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value)
  );
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  const allowed = new Set(keys);
  return (
    Object.keys(value).length === keys.length &&
    Object.keys(value).every((key) => allowed.has(key))
  );
}
