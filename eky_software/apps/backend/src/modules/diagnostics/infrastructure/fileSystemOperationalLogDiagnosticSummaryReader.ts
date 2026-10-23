import { resolve } from 'node:path';

import { unavailableOperationalLogSummary } from '../application/getRuntimeDiagnosticSummary.js';
import type { OperationalLogDiagnosticSummary } from '../domain/runtimeDiagnosticSummary.js';
import type { OperationalLogDiagnosticSummaryReader } from '../ports/operationalLogDiagnosticSummaryReader.js';
import { readDiagnosticLogSources } from './diagnosticLogSources.js';
import type { DiagnosticReadFailureObserver } from '../ports/diagnosticReadFailureObserver.js';

const maximumCandidateFiles = 96;

export class FileSystemOperationalLogDiagnosticSummaryReader
  implements OperationalLogDiagnosticSummaryReader {
  readonly #logsRoot: string;
  readonly #failureObserver: DiagnosticReadFailureObserver | undefined;

  constructor(logsRoot: string, failureObserver?: DiagnosticReadFailureObserver) {
    if (resolve(logsRoot) !== logsRoot) throw new Error('Operational logs root must be absolute.');
    this.#logsRoot = logsRoot;
    this.#failureObserver = failureObserver;
  }

  async readOperationalLogSummary(): Promise<OperationalLogDiagnosticSummary> {
    let latestErrorAt: string | null = null;
    let latestWarningAt: string | null = null;
    let latestSecurityEventAt: string | null = null;
    const source = readDiagnosticLogSources({
      logsRoot: this.#logsRoot, maximumCandidateFiles,
      ...(this.#failureObserver === undefined ? {} : { failureObserver: this.#failureObserver }),
      visitEvent(event, security) {
        if (event.level === 'error') latestErrorAt = latestTimestamp(latestErrorAt, event.occurredAt);
        if (event.level === 'warn') latestWarningAt = latestTimestamp(latestWarningAt, event.occurredAt);
        if (security && (event.level === 'warn' || event.level === 'error')) {
          latestSecurityEventAt = latestTimestamp(latestSecurityEventAt, event.occurredAt);
        }
      },
    });
    if (source.readState.status === 'unavailable') return unavailableOperationalLogSummary;
    return {
      latestErrorAt, latestSecurityEventAt, latestWarningAt,
      operationalLogNewestMonth: source.newestMonth,
      operationalLogOldestMonth: source.oldestMonth,
      operationalLogTotalBytes: source.totalByteCount,
      operationalLogsAvailable: true,
      operationalLogReadState: source.readState,
    };
  }
}

function latestTimestamp(current: string | null, candidate: string): string {
  return current === null || Date.parse(candidate) > Date.parse(current) ? candidate : current;
}
