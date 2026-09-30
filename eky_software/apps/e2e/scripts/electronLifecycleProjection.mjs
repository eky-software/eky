import catalog from '../../desktop/e2e/electronE2eBackendFailureCatalog.json' with { type: 'json' };
import launchPhases from '../src/fixtures/electronLaunchPhases.json' with { type: 'json' };

const maximumBytes = 256 * 1024;
const evidenceFailureAnnotation = 'electron-evidence-failure';
const evidenceFailureKinds = ['captureFailed', 'reportFailed', 'fileWriteFailed', 'attachmentFailed'];

export function recordElectronEvidenceFailure(testInfo, kind) {
  if (!evidenceFailureKinds.includes(kind)) return;
  try {
    if (!testInfo.annotations.some(value => value.type === evidenceFailureAnnotation && value.description === kind)) {
      testInfo.annotations.push({ type: evidenceFailureAnnotation, description: kind });
    }
  } catch { /* A metadata failure must not replace the original exception. */ }
}

export function projectElectronEvidenceFailures(result) {
  try {
    return evidenceFailureKinds.filter(kind => result.annotations?.some(
      value => value.type === evidenceFailureAnnotation && value.description === kind,
    ));
  } catch { return []; }
}

const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const keysAre = (value, keys) => record(value) && Object.keys(value).sort().join(',') === keys;
const counter = value => Number.isSafeInteger(value) && value >= 0;
const positive = value => counter(value) && value > 0;
const captureStatuses = new Set([
  'notRequested', 'missing', 'invalid', 'tooLarge', 'sourceChanged', 'readFailed', 'captured',
]);

function backendFailure(value, startupFailureCodes) {
  if (!keysAre(value, 'backendAttempt,status') || !positive(value.backendAttempt)) return undefined;
  const status = value.status;
  if (!keysAre(status, 'brokerCleanupFailures,reason,stage,type') || status.type !== 'failed' ||
      typeof status.stage !== 'string' || typeof status.reason !== 'string' ||
      !Object.hasOwn(catalog.stageCodes, status.stage) || !Object.hasOwn(catalog.reasons, status.reason) ||
      !Array.isArray(status.brokerCleanupFailures) ||
      status.brokerCleanupFailures.length > Object.keys(catalog.brokers).length ||
      !status.brokerCleanupFailures.every(name => typeof name === 'string' && Object.hasOwn(catalog.brokers, name)) ||
      new Set(status.brokerCleanupFailures).size !== status.brokerCleanupFailures.length ||
      !Array.isArray(startupFailureCodes) || startupFailureCodes[0] !== catalog.stageCodes[status.stage]) {
    return undefined;
  }
  return {
    backendAttempt: value.backendAttempt, stage: status.stage, reason: status.reason,
    brokerCleanupFailures: Object.keys(catalog.brokers).filter(name => status.brokerCleanupFailures.includes(name)),
  };
}

// Read the existing in-memory attachment, never arbitrary attachment paths or
// exception text. This observer cannot change a test's verdict or await I/O.
export function projectElectronLifecycle(result) {
  try {
    const attachments = (result.attachments ?? []).filter(value => value.name === 'electron-lifecycle');
    if (attachments.length === 0) return { status: 'notAttached' };
    if (attachments.length !== 1) return { status: 'invalid' };
    const attachment = attachments[0];
    if (attachment.contentType !== 'application/json' || !Buffer.isBuffer(attachment.body)) {
      return { status: 'unavailable' };
    }
    if (attachment.body.length > maximumBytes) return { status: 'tooLarge' };
    const value = JSON.parse(attachment.body.toString('utf8'));
    if (!record(value) || value.schemaVersion !== 1 || !counter(value.attempt) ||
        value.attempt !== result.retry || typeof value.observationsTruncated !== 'boolean') return { status: 'invalid' };
    const cleanup = value.cleanup;
    if (!keysAre(cleanup, 'api,port,runRoot,runtime') ||
        !['completed', 'failed', 'notStarted'].includes(cleanup.api) ||
        !['completed', 'unverified', 'notStarted'].includes(cleanup.runtime) ||
        !['released', 'unverified', 'notStarted'].includes(cleanup.port) ||
        !['removed', 'retained', 'removalFailed'].includes(cleanup.runRoot)) return { status: 'invalid' };
    const first = value.firstLaunchFailure;
    if (first !== undefined && first !== null && (!record(first) ||
        typeof first.phase !== 'string' || !Object.hasOwn(launchPhases, first.phase) ||
        (first.startupGeneration !== null && !positive(first.startupGeneration)))) return { status: 'invalid' };
    const native = value.nativeStartupFailure ?? { status: 'notRequested' };
    if (!record(native) || !captureStatuses.has(native.status)) return { status: 'invalid' };
    let failure = null;
    if (native.backendFailure !== undefined) {
      if (native.status !== 'captured') return { status: 'invalid' };
      failure = backendFailure(native.backendFailure, native.startupFailureCodes);
      if (failure === undefined) return { status: 'invalid' };
    }
    const exitCode = value.launchExitCode ?? null;
    if (exitCode !== null && (!Number.isSafeInteger(exitCode) ||
        exitCode < -0x80000000 || exitCode > 0x7fffffff)) return { status: 'invalid' };
    return {
      status: 'captured', attempt: value.attempt,
      startupGeneration: first?.startupGeneration ?? null,
      launchPhase: first?.phase ?? null,
      nativeCapture: native.status, backendFailure: failure, launchExitCode: exitCode,
      observationsTruncated: value.observationsTruncated,
      cleanup: { api: cleanup.api, runtime: cleanup.runtime, port: cleanup.port, runRoot: cleanup.runRoot },
    };
  } catch {
    return { status: 'invalid' };
  }
}
