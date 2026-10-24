export const diagnosticBrowsePolicy = Object.freeze({
  defaultLimit: 100,
  maximumLimit: 200,
  directoryEntries: 4096,
  sources: 1024,
  sourceBytes: 500 * 1024 * 1024,
  chunkBytes: 64 * 1024,
  lineBytes: 16 * 1024,
  stepBytes: 8 * 1024 * 1024,
  stepChunks: 128,
  stepMetadata: 64,
  stepMilliseconds: 50,
  workMilliseconds: 30_000,
  maximumSteps: 4096,
  sessions: 4,
  stateBytes: 16 * 1024 * 1024,
  idleMilliseconds: 5 * 60_000,
  lifetimeMilliseconds: 30 * 60_000,
});

export type DiagnosticBrowsePolicy = { readonly [K in keyof typeof diagnosticBrowsePolicy]: number };
const diagnosticBrowseCursorPattern = /^[A-Za-z0-9_-]{32}$/u;
export function isDiagnosticBrowseCursor(value: unknown): value is string {
  return typeof value === 'string' && value.length === 32 && diagnosticBrowseCursorPattern.test(value);
}

export class DiagnosticBrowseError extends Error {
  constructor(readonly code: 'diagnostic_browse_stale' | 'diagnostic_browse_busy') {
    super('Diagnostic browsing is unavailable.');
    this.name = 'DiagnosticBrowseError';
  }
}

export class DiagnosticBrowseLimitError extends Error {
  constructor() {
    super('Diagnostic browsing reached its work limit.');
    this.name = 'DiagnosticBrowseLimitError';
  }
}
