import { createHash, randomUUID } from 'node:crypto';
import {
  lstatSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gunzipSync } from 'node:zlib';

const supportedFormatVersion = 2;
const maximumCompressedBytes = 25 * 1024 * 1024;
const maximumUncompressedBytes = 25 * 1024 * 1024;
const topLevelKeys = [
  'database',
  'diagnosticEvents',
  'incidentSummaries',
  'manifest',
  'operationalSummary',
  'runtimeSummary',
  'system',
];
const sectionNames = [
  'database',
  'diagnosticEvents',
  'incidentSummaries',
  'operationalSummary',
  'runtimeSummary',
  'system',
];
const manifestKeys = [
  'createdAt',
  'creationCorrelationId',
  'diagnosticPeriodDays',
  'sectionChecksums',
  'supportBundleFormatVersion',
  'truncatedSections',
];
const knownTruncatedSections = new Set([
  'diagnosticEvents',
  'incidentSummaries',
]);

// Independent Node-only mirror of supportBundleDesktopData.ts and its named
// desktopBuildInfo, desktopOperationalEventValidator, workspaceManagementFailureContext
// and workspaceCandidateMessages/profileInspectionFailure owners. No runtime imports.
const desktopOnlySupportBundleFormatVersion = 3;
const desktopOnlySupportBundleKind = 'desktopOnly';
const desktopOnlySupportBundleSections = ['system', 'availability', 'observation'];
const desktopFailureFields = [
  'appVersion', 'buildRevision', 'category', 'component', 'correlationId',
  'durationMs', 'errorCode', 'eventId', 'eventName', 'level', 'outcome',
  'retryable', 'runtimeInstanceId', 'schemaVersion', 'sideEffectState', 'stage', 'timestamp',
];
const technicalUuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const operationalUuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const desktopSemVerPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|[a-zA-Z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|[a-zA-Z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const workspaceManagementOperationIds = [
  'workspace.create', 'workspace.import', 'workspace.replace', 'workspace.switch',
  'workspace.rename', 'workspace.delete', 'workspace.deleteResume',
];
const workspaceDeletionFailureStages = [
  'admission', 'deletePreparation', 'deleteAuthorization',
  'deletePurge', 'deleteRegistry', 'deleteCleanup',
];
const workspaceDeletionFailureCodes = [
  'WORKSPACE_MANAGEMENT_BUSY', 'WORKSPACE_MANAGEMENT_INVALID',
  'WORKSPACE_DELETE_STALE_CONFIRMATION', 'WORKSPACE_DELETE_BACKUP_UNAVAILABLE',
  'WORKSPACE_DELETE_OWNERSHIP_UNCERTAIN', 'WORKSPACE_DELETE_INVENTORY_INVALID',
  'WORKSPACE_DELETE_JOURNAL_CONFLICT', 'WORKSPACE_DELETE_IO_FAILED',
  'WORKSPACE_DELETE_CLEANUP_FAILED', 'WORKSPACE_DELETE_FAILED',
];
const failureOperationIds = {
  WORKSPACE_CREATION_LABEL_EXISTS: 'workspace.create',
  WORKSPACE_IMPORT_LABEL_EXISTS: 'workspace.import',
  WORKSPACE_MANAGEMENT_CREATE_FAILED: 'workspace.create',
  WORKSPACE_MANAGEMENT_IMPORT_FAILED: 'workspace.import',
  WORKSPACE_MANAGEMENT_REPLACE_FAILED: 'workspace.replace',
  WORKSPACE_MANAGEMENT_SWITCH_FAILED: 'workspace.switch',
  WORKSPACE_MANAGEMENT_RENAME_FAILED: 'workspace.rename',
};
const workspaceCandidateFailureCauses = [
  'unknown',
  'PROFILE_SCHEMA_UNSUPPORTED', 'PROFILE_INSPECTION_LIMIT_EXCEEDED',
  'PROFILE_INSPECTION_TIMEOUT', 'PROFILE_INSPECTION_PROTOCOL_INVALID',
  'PROFILE_INSPECTION_CLEANUP_UNVERIFIED', 'MIGRATION_HISTORY_INVALID',
  'PROFILE_SNAPSHOT_DATABASE_INVALID', 'PROFILE_SNAPSHOT_MIGRATIONS_INVALID',
  'PROFILE_SNAPSHOT_ARTIFACTS_INVALID', 'WORKSPACE_CANDIDATE_SOURCE_MISMATCH',
  'WORKSPACE_CANDIDATE_DATABASE_CHANGED', 'WORKSPACE_CANDIDATE_DATABASE_INVALID',
  'WORKSPACE_CANDIDATE_DATABASE_CLOSE_FAILED', 'WORKSPACE_CANDIDATE_OPERATION_CANCELLED',
];

export const supportBundleInspectorErrorCodes = Object.freeze({
  checksumFailed: 'SUPPORT_BUNDLE_CHECKSUM_FAILED',
  fileInvalid: 'SUPPORT_BUNDLE_FILE_INVALID',
  formatUnsupported: 'SUPPORT_BUNDLE_FORMAT_UNSUPPORTED',
  gzipInvalid: 'SUPPORT_BUNDLE_GZIP_INVALID',
  jsonInvalid: 'SUPPORT_BUNDLE_JSON_INVALID',
  outputExists: 'SUPPORT_BUNDLE_OUTPUT_EXISTS',
  outputFailed: 'SUPPORT_BUNDLE_OUTPUT_FAILED',
  tooLarge: 'SUPPORT_BUNDLE_TOO_LARGE',
});

export const supportBundleInspectorExitCodes = Object.freeze({
  SUPPORT_BUNDLE_CHECKSUM_FAILED: 7,
  SUPPORT_BUNDLE_FILE_INVALID: 2,
  SUPPORT_BUNDLE_FORMAT_UNSUPPORTED: 6,
  SUPPORT_BUNDLE_GZIP_INVALID: 3,
  SUPPORT_BUNDLE_JSON_INVALID: 5,
  SUPPORT_BUNDLE_OUTPUT_EXISTS: 8,
  SUPPORT_BUNDLE_OUTPUT_FAILED: 9,
  SUPPORT_BUNDLE_TOO_LARGE: 4,
});

export class SupportBundleInspectorError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
    this.name = 'SupportBundleInspectorError';
  }
}

export function inspectSupportBundle(sourcePath) {
  const absoluteSourcePath = resolveRequiredPath(sourcePath);
  const compressed = readSafeSourceFile(absoluteSourcePath);
  const uncompressed = decompressBounded(compressed);
  const document = parseJsonDocument(uncompressed);
  validateDocument(document);

  return {
    document,
    summary: createSafeSummary(document),
  };
}

export function writeSupportBundleJson(document, targetPath, options = {}) {
  const absoluteTargetPath = resolveRequiredPath(targetPath);
  const targetDirectory = dirname(absoluteTargetPath);
  const temporaryPath = resolve(
    targetDirectory,
    `.eky-support-inspect-${process.pid}-${randomUUID()}.tmp`,
  );
  let temporaryCreated = false;

  try {
    const directoryMetadata = lstatSync(targetDirectory);
    if (
      !directoryMetadata.isDirectory() ||
      directoryMetadata.isSymbolicLink()
    ) {
      throw new SupportBundleInspectorError(
        supportBundleInspectorErrorCodes.outputFailed,
      );
    }

    const targetState = inspectOutputTarget(absoluteTargetPath);
    if (targetState === 'unsafe') {
      throw new SupportBundleInspectorError(
        supportBundleInspectorErrorCodes.outputFailed,
      );
    }
    if (targetState === 'file' && options.force !== true) {
      throw new SupportBundleInspectorError(
        supportBundleInspectorErrorCodes.outputExists,
      );
    }

    writeFileSync(
      temporaryPath,
      `${JSON.stringify(document, null, 2)}\n`,
      {
        encoding: 'utf8',
        flag: 'wx',
        mode: 0o600,
      },
    );
    temporaryCreated = true;

    if (targetState === 'file') {
      rmSync(absoluteTargetPath);
    }
    renameSync(temporaryPath, absoluteTargetPath);
    temporaryCreated = false;
  } catch (error) {
    if (error instanceof SupportBundleInspectorError) {
      throw error;
    }
    throw new SupportBundleInspectorError(
      supportBundleInspectorErrorCodes.outputFailed,
    );
  } finally {
    if (temporaryCreated) {
      try {
        rmSync(temporaryPath, { force: true });
      } catch {
        // A failed cleanup must not replace the original safe error code.
      }
    }
  }
}

export function formatSupportBundleSummary(summary) {
  if (summary.kind === desktopOnlySupportBundleKind) {
    return [
      `Tukipaketin formaatti: ${summary.formatVersion} (${summary.kind})`,
      `Luotu: ${summary.createdAt}`,
      `Sovellusversio: ${summary.appVersion}`,
      `Build-revisio: ${summary.buildRevision}`,
      `Backend: ${summary.backend}`,
      `Tietokannan tila: ${summary.database}`,
      `Diagnostiikkahistoria: ${summary.diagnosticHistory}`,
      `Incident-historia: ${summary.incidentHistory}`,
      `Nykyisen operaation havainto: ${summary.observationStatus}`,
      ...(summary.firstErrorCode === undefined ? [] : [`Ensivirheen koodi: ${summary.firstErrorCode}`]),
      ...(summary.cleanupErrorCode === undefined ? [] : [`Siivousvirheen koodi: ${summary.cleanupErrorCode}`]),
      'Checksumit: kunnossa',
    ].join('\n');
  }
  return [
    `Tukipaketin formaatti: ${summary.formatVersion}`,
    `Luotu: ${summary.createdAt}`,
    `Sovellusversio: ${summary.appVersion}`,
    `Build-revisio: ${summary.buildRevision}`,
    `Tietokannan tila: ${summary.databaseHealth}`,
    `Migraatioita: ${summary.appliedMigrationCount}`,
    `Uusin migraatio: ${summary.latestMigrationName ?? '-'}`,
    `Diagnostiikkatapahtumia: ${summary.diagnosticEventCount}`,
    `Incident-yhteenvetoja: ${summary.incidentSummaryCount}`,
    `Katkaistut osiot: ${
      summary.truncatedSections.length === 0
        ? '-'
        : summary.truncatedSections.join(', ')
    }`,
    'Checksumit: kunnossa',
  ].join('\n');
}

export function runSupportBundleInspectorCli(
  args,
  output = console,
) {
  try {
    const options = parseArguments(args);
    const inspected = inspectSupportBundle(options.sourcePath);
    output.log(formatSupportBundleSummary(inspected.summary));

    if (options.writeJsonPath !== null) {
      output.warn(
        'Varoitus: purettu JSON ei ole salattu. Säilytä ja poista se hallitusti.',
      );
      writeSupportBundleJson(inspected.document, options.writeJsonPath, {
        force: options.force,
      });
      output.log('Purettu JSON kirjoitettiin pyydettyyn tiedostoon.');
    }

    return 0;
  } catch (error) {
    const code =
      error instanceof SupportBundleInspectorError
        ? error.code
        : supportBundleInspectorErrorCodes.fileInvalid;
    output.error(code);
    return supportBundleInspectorExitCodes[code] ?? 1;
  }
}

function parseArguments(args) {
  let sourcePath = null;
  let writeJsonPath = null;
  let force = false;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--') {
      continue;
    }
    if (argument === '--write-json') {
      const value = args[index + 1];
      if (value === undefined || value.startsWith('--')) {
        throw new SupportBundleInspectorError(
          supportBundleInspectorErrorCodes.fileInvalid,
        );
      }
      writeJsonPath = value;
      index += 1;
      continue;
    }
    if (argument === '--force') {
      force = true;
      continue;
    }
    if (argument.startsWith('--') || sourcePath !== null) {
      throw new SupportBundleInspectorError(
        supportBundleInspectorErrorCodes.fileInvalid,
      );
    }
    sourcePath = argument;
  }

  if (
    sourcePath === null ||
    (force && writeJsonPath === null)
  ) {
    throw new SupportBundleInspectorError(
      supportBundleInspectorErrorCodes.fileInvalid,
    );
  }

  return { force, sourcePath, writeJsonPath };
}

function readSafeSourceFile(sourcePath) {
  try {
    const metadata = lstatSync(sourcePath);
    if (
      !metadata.isFile() ||
      metadata.isSymbolicLink()
    ) {
      throw new SupportBundleInspectorError(
        supportBundleInspectorErrorCodes.fileInvalid,
      );
    }
    if (metadata.size > maximumCompressedBytes) {
      throw new SupportBundleInspectorError(
        supportBundleInspectorErrorCodes.tooLarge,
      );
    }
    return readFileSync(sourcePath);
  } catch (error) {
    if (error instanceof SupportBundleInspectorError) {
      throw error;
    }
    throw new SupportBundleInspectorError(
      supportBundleInspectorErrorCodes.fileInvalid,
    );
  }
}

function decompressBounded(compressed) {
  try {
    return gunzipSync(compressed, {
      maxOutputLength: maximumUncompressedBytes,
    });
  } catch (error) {
    if (
      isNodeErrorWithCode(error, 'ERR_BUFFER_TOO_LARGE') ||
      isNodeErrorWithCode(error, 'ERR_OUT_OF_RANGE')
    ) {
      throw new SupportBundleInspectorError(
        supportBundleInspectorErrorCodes.tooLarge,
      );
    }
    throw new SupportBundleInspectorError(
      supportBundleInspectorErrorCodes.gzipInvalid,
    );
  }
}

function parseJsonDocument(uncompressed) {
  try {
    return JSON.parse(uncompressed.toString('utf8'));
  } catch {
    throw new SupportBundleInspectorError(
      supportBundleInspectorErrorCodes.jsonInvalid,
    );
  }
}

function validateDocument(value) {
  if (isRecord(value) && isRecord(value.manifest) &&
      value.manifest.kind === desktopOnlySupportBundleKind) {
    validateDesktopOnlyDocument(value);
    return;
  }
  if (!isRecord(value) || !hasOnlyKeys(value, topLevelKeys)) {
    throw new SupportBundleInspectorError(
      supportBundleInspectorErrorCodes.jsonInvalid,
    );
  }
  if (
    !isRecord(value.manifest) ||
    value.manifest.supportBundleFormatVersion !==
      supportedFormatVersion
  ) {
    if (
      isRecord(value.manifest) &&
      Number.isSafeInteger(
        value.manifest.supportBundleFormatVersion,
      )
    ) {
      throw new SupportBundleInspectorError(
        supportBundleInspectorErrorCodes.formatUnsupported,
      );
    }
    throw new SupportBundleInspectorError(
      supportBundleInspectorErrorCodes.jsonInvalid,
    );
  }
  if (
    !hasOnlyKeys(value.manifest, manifestKeys) ||
    !isTimestamp(value.manifest.createdAt) ||
    !isBoundedString(value.manifest.creationCorrelationId, 200) ||
    value.manifest.diagnosticPeriodDays !== 30 ||
    !isRecord(value.manifest.sectionChecksums) ||
    !hasOnlyKeys(
      value.manifest.sectionChecksums,
      sectionNames,
    ) ||
    Object.values(value.manifest.sectionChecksums).some(
      (checksumValue) =>
        typeof checksumValue !== 'string' ||
        !/^[0-9a-f]{64}$/.test(checksumValue),
    ) ||
    !Array.isArray(value.manifest.truncatedSections) ||
    new Set(value.manifest.truncatedSections).size !==
      value.manifest.truncatedSections.length ||
    value.manifest.truncatedSections.some(
      (section) =>
        typeof section !== 'string' ||
        !knownTruncatedSections.has(section),
    ) ||
    !isSystemSection(value.system) ||
    !isDatabaseSection(value.database) ||
    !isOperationalSummary(value.operationalSummary) ||
    !isRuntimeSummary(value.runtimeSummary) ||
    !Array.isArray(value.diagnosticEvents) ||
    !Array.isArray(value.incidentSummaries)
  ) {
    throw new SupportBundleInspectorError(
      supportBundleInspectorErrorCodes.jsonInvalid,
    );
  }

  const sections = Object.fromEntries(
    sectionNames.map((name) => [name, value[name]]),
  );
  if (
    Object.entries(sections).some(
      ([name, section]) =>
        value.manifest.sectionChecksums[name] !==
        checksum(section),
    )
  ) {
    throw new SupportBundleInspectorError(
      supportBundleInspectorErrorCodes.checksumFailed,
    );
  }
}

function validateDesktopOnlyDocument(value) {
  const manifest = value.manifest;
  if (Number.isSafeInteger(manifest.supportBundleFormatVersion) &&
      manifest.supportBundleFormatVersion !== desktopOnlySupportBundleFormatVersion) {
    throw new SupportBundleInspectorError(supportBundleInspectorErrorCodes.formatUnsupported);
  }
  if (!hasOnlyKeys(value, ['manifest', ...desktopOnlySupportBundleSections]) ||
      !hasOnlyKeys(manifest, [
        'supportBundleFormatVersion', 'kind', 'createdAt', 'creationCorrelationId', 'sectionChecksums',
      ]) || manifest.supportBundleFormatVersion !== desktopOnlySupportBundleFormatVersion ||
      !isCanonicalTimestamp(manifest.createdAt) ||
      !isUuid(manifest.creationCorrelationId, technicalUuidPattern) ||
      !hasExactRecordKeys(manifest.sectionChecksums, desktopOnlySupportBundleSections) ||
      Object.values(manifest.sectionChecksums).some(item => typeof item !== 'string' || !/^[0-9a-f]{64}$/.test(item)) ||
      !isDesktopSystemSection(value.system) || !isDesktopAvailability(value.availability) ||
      !isDesktopObservation(value.observation, value.system)) {
    throw new SupportBundleInspectorError(supportBundleInspectorErrorCodes.jsonInvalid);
  }
  if (desktopOnlySupportBundleSections.some(name => manifest.sectionChecksums[name] !== checksum(value[name]))) {
    throw new SupportBundleInspectorError(supportBundleInspectorErrorCodes.checksumFailed);
  }
  // Validation deliberately leaves the parsed sections and their key order intact.
}

function isDesktopSystemSection(value) {
  return hasExactRecordKeys(value, ['appVersion', 'architecture', 'buildRevision', 'electronVersion', 'platform']) &&
    isDesktopVersion(value.appVersion) && isDesktopVersion(value.electronVersion) &&
    typeof value.buildRevision === 'string' && /^(?:[0-9a-f]{7,40}|development)$/.test(value.buildRevision) &&
    ['x64', 'arm64'].includes(value.architecture) && ['win32', 'linux', 'darwin'].includes(value.platform);
}

function isDesktopAvailability(value) {
  return hasExactRecordKeys(value, ['backend', 'database', 'diagnosticHistory', 'incidentHistory']) &&
    ['notRunning', 'exitUnconfirmed'].includes(value.backend) && value.database === 'notInspected' &&
    value.diagnosticHistory === 'notCollected' && value.incidentHistory === 'notCollected';
}

function isDesktopObservation(value, system) {
  if (hasExactRecordKeys(value, ['scope', 'status']) &&
      value.scope === 'currentOperation' && value.status === 'unavailable') return true;
  if (!hasExactRecordKeys(value, ['scope', 'status', 'firstError', 'cleanupError']) ||
      value.scope !== 'currentOperation' || value.status !== 'available') return false;
  const { firstError, cleanupError } = value;
  if ((firstError === null && cleanupError === null) ||
      !isDesktopFailure(firstError, 'firstError', system) ||
      !isDesktopFailure(cleanupError, 'cleanupError', system)) return false;
  return firstError === null || cleanupError === null || (
    firstError.correlationId === cleanupError.correlationId &&
    firstError.runtimeInstanceId === cleanupError.runtimeInstanceId &&
    desktopOperationKey(firstError) === desktopOperationKey(cleanupError) &&
    firstError.eventId !== cleanupError.eventId
  );
}

function isDesktopFailure(value, role, system) {
  if (value === null) return true;
  if (!isRecord(value)) return false;
  const management = value.eventName === 'workspaceManagement.operationFailed';
  const backup = value.eventName === 'workspaceBackup.operationFailed' || value.eventName === 'workspaceBackup.cleanupFailed';
  if ((!management && !backup) ||
      !hasOnlyKeys(value, management ? [...desktopFailureFields, 'operationId'] : desktopFailureFields) ||
      Object.values(value).some(field => typeof field === 'string' &&
        field.replace(/[\u0000-\u001f\u007f-\u009f]/g, '').trim() !== field) ||
      value.schemaVersion !== 1 || value.component !== 'desktop' ||
      value.category !== (management ? 'workspaceManagement' : 'backup') ||
      value.level !== 'error' || value.outcome !== 'failure' ||
      !isUuid(value.eventId, technicalUuidPattern) ||
      !isUuid(value.correlationId, operationalUuidPattern) ||
      !isUuid(value.runtimeInstanceId, operationalUuidPattern) ||
      !isTimestamp(value.timestamp) || value.appVersion !== system.appVersion ||
      !isBoundedString(value.appVersion, 80) || value.buildRevision !== system.buildRevision ||
      !Number.isSafeInteger(value.durationMs) || value.durationMs < 0 ||
      !['none', 'unknown'].includes(value.sideEffectState) ||
      Buffer.byteLength(JSON.stringify(value), 'utf8') > 16 * 1024) return false;
  const cleanup = value.eventName === 'workspaceBackup.cleanupFailed' || (management && value.stage === 'deleteCleanup');
  if ((role === 'cleanupError') !== cleanup ||
      (management && cleanup && value.errorCode !== 'WORKSPACE_DELETE_CLEANUP_FAILED')) return false;
  if (management) return isWorkspaceManagementFailureContext(value);
  return ['import', 'replace'].includes(value.stage) && value.retryable === false &&
    workspaceCandidateFailureCauses.includes(value.errorCode);
}

function isWorkspaceManagementFailureContext(value) {
  if (typeof value.errorCode !== 'string' || !workspaceManagementOperationIds.includes(value.operationId)) return false;
  if (value.operationId === 'workspace.delete' || value.operationId === 'workspace.deleteResume') {
    if (!workspaceDeletionFailureStages.includes(value.stage) ||
        !workspaceDeletionFailureCodes.includes(value.errorCode)) return false;
    if (value.sideEffectState === 'none' && (value.operationId === 'workspace.deleteResume' ||
        (value.stage !== 'admission' &&
          !(value.stage === 'deletePreparation' && value.errorCode === 'WORKSPACE_MANAGEMENT_BUSY')))) return false;
    return value.retryable === (value.errorCode === 'WORKSPACE_MANAGEMENT_BUSY');
  }
  if (value.errorCode === 'WORKSPACE_MANAGEMENT_BUSY') {
    return ['admission', 'operation'].includes(value.stage) && value.retryable === true;
  }
  if (value.retryable !== false) return false;
  if (value.errorCode === 'WORKSPACE_REPLACEMENT_LINEAGE_MISMATCH') {
    return value.operationId === 'workspace.replace' && value.stage === 'lineageCheck';
  }
  return value.stage === 'operation' && (
    (value.errorCode === 'WORKSPACE_MANAGEMENT_LABEL_EXISTS' &&
      ['workspace.create', 'workspace.import', 'workspace.rename'].includes(value.operationId)) ||
    value.errorCode === 'WORKSPACE_MANAGEMENT_INVALID' || value.errorCode === 'WORKSPACE_MANAGEMENT_RECOVERY_REQUIRED' ||
    (Object.hasOwn(failureOperationIds, value.errorCode) && failureOperationIds[value.errorCode] === value.operationId)
  );
}

function desktopOperationKey(event) {
  return event.eventName === 'workspaceManagement.operationFailed' ? event.operationId : `workspace.${event.stage}`;
}

function hasExactRecordKeys(value, keys) {
  return isRecord(value) && hasOnlyKeys(value, keys);
}

function isDesktopVersion(value) {
  return isBoundedString(value, 100) && desktopSemVerPattern.test(value);
}

function isUuid(value, pattern) {
  return typeof value === 'string' && pattern.test(value);
}

function isCanonicalTimestamp(value) {
  if (typeof value !== 'string') return false;
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString() === value;
}

function createSafeSummary(document) {
  if (document.manifest.kind === desktopOnlySupportBundleKind) {
    return Object.freeze({
      appVersion: document.system.appVersion,
      buildRevision: document.system.buildRevision,
      createdAt: document.manifest.createdAt,
      formatVersion: document.manifest.supportBundleFormatVersion,
      kind: desktopOnlySupportBundleKind,
      ...document.availability,
      observationStatus: document.observation.status,
      ...(document.observation.firstError == null ? {} : {
        firstErrorCode: document.observation.firstError.errorCode,
      }),
      ...(document.observation.cleanupError == null ? {} : {
        cleanupErrorCode: document.observation.cleanupError.errorCode,
      }),
    });
  }
  return Object.freeze({
    appVersion: document.system.appVersion,
    appliedMigrationCount:
      document.database.appliedMigrationCount,
    buildRevision: document.runtimeSummary.buildRevision,
    createdAt: document.manifest.createdAt,
    databaseHealth: document.database.health,
    diagnosticEventCount: document.diagnosticEvents.length,
    formatVersion:
      document.manifest.supportBundleFormatVersion,
    incidentSummaryCount: document.incidentSummaries.length,
    latestMigrationName:
      document.database.latestMigrationName,
    truncatedSections: [
      ...document.manifest.truncatedSections,
    ],
  });
}

function isSystemSection(value) {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, [
      'appVersion',
      'architecture',
      'backendVersion',
      'platform',
    ]) &&
    Object.values(value).every(
      (item) => isBoundedString(item, 120),
    )
  );
}

function isDatabaseSection(value) {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, [
      'appliedMigrationCount',
      'health',
      'latestMigrationName',
    ]) &&
    Number.isSafeInteger(value.appliedMigrationCount) &&
    value.appliedMigrationCount >= 0 &&
    value.health === 'ok' &&
    (value.latestMigrationName === null ||
      isBoundedString(value.latestMigrationName, 160))
  );
}

function isOperationalSummary(value) {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, [
      'byComponent',
      'byLevel',
      'eventCount',
    ]) &&
    isCountRecord(value.byComponent, ['backend', 'desktop']) &&
    isCountRecord(value.byLevel, ['error', 'info', 'warn']) &&
    Number.isSafeInteger(value.eventCount) &&
    value.eventCount >= 0
  );
}

function isRuntimeSummary(value) {
  return (
    isRecord(value) &&
    isBoundedString(value.appVersion, 120) &&
    isBoundedString(value.buildRevision, 120)
  );
}

function isCountRecord(value, keys) {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, keys) &&
    Object.values(value).every(
      (item) => Number.isSafeInteger(item) && item >= 0,
    )
  );
}

function inspectOutputTarget(targetPath) {
  try {
    const metadata = lstatSync(targetPath);
    return metadata.isFile() && !metadata.isSymbolicLink()
      ? 'file'
      : 'unsafe';
  } catch (error) {
    if (isNodeErrorWithCode(error, 'ENOENT')) {
      return 'missing';
    }
    return 'unsafe';
  }
}

function resolveRequiredPath(value) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new SupportBundleInspectorError(
      supportBundleInspectorErrorCodes.fileInvalid,
    );
  }
  return resolve(value);
}

function checksum(value) {
  return createHash('sha256')
    .update(JSON.stringify(value), 'utf8')
    .digest('hex');
}

function hasOnlyKeys(value, keys) {
  const allowed = new Set(keys);
  return (
    Object.keys(value).length === keys.length &&
    Object.keys(value).every((key) => allowed.has(key))
  );
}

function isRecord(value) {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value)
  );
}

function isBoundedString(value, maximumLength) {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= maximumLength
  );
}

function isTimestamp(value) {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(
      value,
    )
  ) {
    return false;
  }
  const parsed = Date.parse(value);
  return (
    Number.isFinite(parsed) &&
    new Date(parsed).toISOString() === value
  );
}

function isNodeErrorWithCode(error, code) {
  return (
    error instanceof Error &&
    'code' in error &&
    error.code === code
  );
}

const isMainModule =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMainModule) {
  process.exitCode = runSupportBundleInspectorCli(
    process.argv.slice(2),
  );
}
