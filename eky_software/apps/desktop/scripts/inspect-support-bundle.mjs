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

function createSafeSummary(document) {
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
