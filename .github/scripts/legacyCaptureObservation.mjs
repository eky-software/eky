import { pathToFileURL } from 'node:url';

const OUTCOMES = new Set(['success', 'failure', 'cancelled', 'skipped', 'unknown']);
const FIELDS = ['testOutcome', 'artifactOutcome', 'startOutcome', 'stopOutcome', 'analysisOutcome'];

export function summarizeLegacyCapture({ enabled, ...outcomes }) {
  if (typeof enabled !== 'boolean' || Object.keys(outcomes).length !== FIELDS.length ||
    FIELDS.some((key) => !OUTCOMES.has(outcomes[key]))) {
    throw new Error('LEGACY_CAPTURE_OBSERVATION_INVALID');
  }
  let captureResult;
  if (!enabled) {
    captureResult = ['startOutcome', 'stopOutcome', 'analysisOutcome'].every((key) => outcomes[key] === 'skipped')
      ? 'disabled' : 'unexpectedCapture';
  } else if (outcomes.startOutcome !== 'success') {
    captureResult = 'startUnverified';
  } else if (outcomes.stopOutcome !== 'success') {
    captureResult = 'stopUnverified';
  } else if (outcomes.analysisOutcome !== 'success') {
    captureResult = 'analysisUnverified';
  } else {
    captureResult = 'collected';
  }
  return Object.freeze({ schemaVersion: 1, operation: 'legacyConsumerCapture', enabled,
    ...Object.fromEntries(FIELDS.map((key) => [key, outcomes[key]])), captureResult });
}

export function readLegacyCaptureEnvironment(env) {
  if (!['true', 'false'].includes(env.LEGACY_CAPTURE_ENABLED)) throw new Error('LEGACY_CAPTURE_OBSERVATION_INVALID');
  const outcome = (name) => env[name] === '' || env[name] === undefined ? 'unknown' : env[name];
  return summarizeLegacyCapture({ enabled: env.LEGACY_CAPTURE_ENABLED === 'true',
    testOutcome: outcome('LEGACY_TEST_OUTCOME'), artifactOutcome: outcome('LEGACY_ARTIFACT_OUTCOME'),
    startOutcome: outcome('LEGACY_CAPTURE_START_OUTCOME'), stopOutcome: outcome('LEGACY_CAPTURE_STOP_OUTCOME'),
    analysisOutcome: outcome('LEGACY_CAPTURE_ANALYSIS_OUTCOME') });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.stdout.write(`${JSON.stringify(readLegacyCaptureEnvironment(process.env))}\n`);
  } catch {
    process.stderr.write('LEGACY_CAPTURE_OBSERVATION_INVALID\n');
    process.exitCode = 1;
  }
}
