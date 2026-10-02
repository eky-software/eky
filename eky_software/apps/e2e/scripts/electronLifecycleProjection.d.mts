export function projectElectronLifecycle(result: unknown): unknown;

export function recordElectronEvidenceFailure(
  testInfo: { annotations: Array<{ type: string; description?: string }> },
  kind: 'captureFailed' | 'reportFailed' | 'fileWriteFailed' | 'attachmentFailed',
): void;
