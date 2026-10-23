import { isRecord } from '../http.js';

export const diagnosticReadStatuses = Object.freeze([
  'complete', 'partial', 'unavailable',
] as const);
export const diagnosticReadReasons = Object.freeze([
  'notConfigured', 'sourceUnavailable', 'invalidEntries', 'limitReached',
] as const);

export type DiagnosticReadStatus = (typeof diagnosticReadStatuses)[number];
export type DiagnosticReadReason = (typeof diagnosticReadReasons)[number];
type PartialDiagnosticReadReason = Exclude<DiagnosticReadReason, 'notConfigured'>;

export type DiagnosticReadState =
  | { status: 'complete'; reasons: [] }
  | {
      status: 'partial';
      reasons:
        | [PartialDiagnosticReadReason]
        | [PartialDiagnosticReadReason, PartialDiagnosticReadReason]
        | [
            PartialDiagnosticReadReason,
            PartialDiagnosticReadReason,
            PartialDiagnosticReadReason,
          ];
    }
  | {
      status: 'unavailable';
      reasons: ['notConfigured'] | ['sourceUnavailable'];
    };

const maximumPartialReasonCount = 3;
const allowedReasons = new Set<string>(diagnosticReadReasons);

export function isDiagnosticReadState(
  value: unknown,
): value is DiagnosticReadState {
  if (
    !isRecord(value) ||
    Object.keys(value).some((key) => key !== 'status' && key !== 'reasons') ||
    !Array.isArray(value.reasons) ||
    value.reasons.length > maximumPartialReasonCount ||
    !Array.from(value.reasons).every(
      (reason) => typeof reason === 'string' && allowedReasons.has(reason),
    ) ||
    new Set(value.reasons).size !== value.reasons.length
  ) {
    return false;
  }

  switch (value.status) {
    case 'complete':
      return value.reasons.length === 0;
    case 'partial':
      return value.reasons.length > 0 && !value.reasons.includes('notConfigured');
    case 'unavailable':
      return (
        value.reasons.length === 1 &&
        (value.reasons[0] === 'notConfigured' || value.reasons[0] === 'sourceUnavailable')
      );
    default:
      return false;
  }
}
