export interface DiagnosticReadFailureObserver {
  captureOriginalException(error: unknown): void;
}
