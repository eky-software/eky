import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import { gunzipSync } from 'node:zlib';

import type { BrowserWindow } from 'electron';

import {
  maximumUncompressedSupportBundleBytes,
  supportBundleFormatVersion,
} from '../supportBundle/supportBundleArchive.js';

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

export async function runPackagedSupportBundleSmoke(options: {
  appVersion: string;
  buildRevision: string;
  mainWindow: BrowserWindow;
  runtimeSessionSecret: string;
  supportBundlePath: string;
}): Promise<void> {
  try {
    await mkdir(dirname(options.supportBundlePath), { recursive: true });
    const result: unknown =
      await options.mainWindow.webContents.executeJavaScript(
        `window.ekyDesktop.createSupportBundle()`,
        true,
      );
    if (result !== 'created') {
      throw new Error('DESKTOP_SMOKE_SUPPORT_BUNDLE_CREATE_FAILED');
    }

    const metadata = await lstat(options.supportBundlePath);
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      throw new Error('DESKTOP_SMOKE_SUPPORT_BUNDLE_FILE_FAILED');
    }
    const compressed = await readFile(options.supportBundlePath);
    const uncompressed = gunzipSync(compressed, {
      maxOutputLength: maximumUncompressedSupportBundleBytes,
    });
    const document = JSON.parse(uncompressed.toString('utf8')) as unknown;

    validateSupportBundleDocument(document, {
      appVersion: options.appVersion,
      buildRevision: options.buildRevision,
      runtimeSessionSecret: options.runtimeSessionSecret,
    });
  } catch (error) {
    if (
      error instanceof Error &&
      /^DESKTOP_SMOKE_SUPPORT_BUNDLE_[A-Z_]+$/.test(error.message)
    ) {
      throw error;
    }
    throw new Error('DESKTOP_SMOKE_SUPPORT_BUNDLE_INVALID');
  } finally {
    await rm(options.supportBundlePath, { force: true });
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
