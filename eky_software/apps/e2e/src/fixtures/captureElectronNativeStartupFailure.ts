import { electronE2eBackendStartupStages, parseElectronE2eBackendFailureObservation, readElectronE2eBackendFailureCode, type ElectronE2eBackendFailureObservation } from '../../../desktop/e2e/electronE2eBackendStatus.js';
import { readSafeStartupFailureCode } from '../../../desktop/src/main/earlyStartup.js';
import { electronNativeObservationsPath } from '../environment/electronNativeObservationsPath.js';
import { readElectronGenerationFile } from './readElectronGenerationFile.js';

const maximumBytes = 64 * 1024;
const maximumRecords = 128;
const backendFailureCodes = new Set<string>(
  electronE2eBackendStartupStages.map(readElectronE2eBackendFailureCode),
);
const errorBoxReasons = ['backendUnexpectedExit', 'other', 'startupFailed', 'uiLoadFailed'] as const;
type ErrorBoxReason = typeof errorBoxReasons[number];

export type ElectronNativeStartupFailureCapture =
  | Readonly<{ status: 'notRequested' | 'missing' | 'invalid' | 'tooLarge' | 'sourceChanged' | 'readFailed' }>
  | Readonly<{
      status: 'captured';
      startupFailureCodes: readonly string[];
      errorBoxReasons: readonly ErrorBoxReason[];
      backendFailure?: ElectronE2eBackendFailureObservation;
    }>;

// Each generation has its own fixed file. Capture before cleanup; a missing
// record does not prove that startup succeeded or that no error box occurred.
export function captureElectronNativeStartupFailure(input: {
  runRoot: string;
  artifactsRoot: string;
  runtimeInstanceId: string;
}): ElectronNativeStartupFailureCapture {
  try {
    return readElectronGenerationFile({ ...input, maximumBytes, parse: parseRecords,
      path: electronNativeObservationsPath(input.artifactsRoot, input.runtimeInstanceId) });
  } catch { return { status: 'invalid' }; }
}

function parseRecords(text: string): ElectronNativeStartupFailureCapture {
  if (text !== '' && !text.endsWith('\n')) return { status: 'invalid' };
  const lines = text.split('\n').filter((line) => line !== '');
  if (lines.length > maximumRecords) return { status: 'tooLarge' };
  const codes = new Set<string>();
  const reasons = new Set<ErrorBoxReason>();
  let firstStartupFailure = true;
  let backendFailure: ElectronE2eBackendFailureObservation | undefined;
  for (const line of lines) {
    let value: unknown;
    try { value = JSON.parse(line) as unknown; } catch { return { status: 'invalid' }; }
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return { status: 'invalid' };
    const record = value as Record<string, unknown>;
    if (record.operation === 'startupFailure') {
      if (typeof record.errorCode !== 'string') return { status: 'invalid' };
      const code = readSafeStartupFailureCode(new Error(record.errorCode));
      // Only the test backend's closed catalog may retain a smoke suffix.
      codes.add(code.startsWith('DESKTOP_SMOKE_') && !backendFailureCodes.has(code)
        ? 'PACKAGED_SMOKE_FAILED' : code);
      if (record.backendFailure !== undefined) {
        const parsed = parseElectronE2eBackendFailureObservation(record.backendFailure);
        if (parsed === undefined || code !== readElectronE2eBackendFailureCode(parsed.status.stage)) {
          return { status: 'invalid' };
        }
        if (firstStartupFailure) backendFailure = parsed;
      }
      firstStartupFailure = false;
    } else if (record.operation === 'showErrorBox') {
      const reason = errorBoxReasons.find((candidate) => candidate === record.reason);
      if (reason === undefined) return { status: 'invalid' };
      reasons.add(reason);
    }
  }
  return Object.freeze({
    status: 'captured',
    startupFailureCodes: Object.freeze([...codes].sort()),
    errorBoxReasons: Object.freeze(errorBoxReasons.filter((reason) => reasons.has(reason))),
    ...(backendFailure === undefined ? {} : { backendFailure }),
  });
}
