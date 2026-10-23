import type { DiagnosticReadFailureObserver } from '../ports/diagnosticReadFailureObserver.js';

export function observeDiagnosticReadFailure(
  observer: DiagnosticReadFailureObserver | undefined,
  error: unknown,
): void {
  try { observer?.captureOriginalException(error); }
  catch { /* Optional private test evidence never changes the public read result. */ }
}
