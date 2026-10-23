import { resolve } from 'node:path';

import type { DiagnosticEventItem } from '../domain/diagnosticEventItem.js';
import type { DiagnosticEventReadResult } from '../domain/diagnosticEventReadResult.js';
import {
  createDiagnosticReadState, notConfiguredDiagnosticReadState, type DiagnosticReadIssue,
} from '../domain/diagnosticReadState.js';
import type { DiagnosticEventReader } from '../ports/diagnosticEventReader.js';
import type { DiagnosticReadFailureObserver } from '../ports/diagnosticReadFailureObserver.js';
import { readDiagnosticLogSources } from './diagnosticLogSources.js';

const maximumCandidateFiles = 32;

export class FileSystemDiagnosticEventReader implements DiagnosticEventReader {
  readonly #logsRoot: string;
  readonly #failureObserver: DiagnosticReadFailureObserver | undefined;

  constructor(logsRoot: string, failureObserver?: DiagnosticReadFailureObserver) {
    if (resolve(logsRoot) !== logsRoot) throw new Error('Diagnostic logs root must be absolute.');
    this.#logsRoot = logsRoot;
    this.#failureObserver = failureObserver;
  }

  async listRecentDiagnosticEvents(limit: number): Promise<DiagnosticEventReadResult> {
    const candidates = new Map<string, DiagnosticEventItem>();
    let resultLimited = false;
    let conflictingId = false;
    const source = readDiagnosticLogSources({
      logsRoot: this.#logsRoot, maximumCandidateFiles,
      ...(this.#failureObserver === undefined ? {} : { failureObserver: this.#failureObserver }),
      visitEvent(event) {
        const existing = candidates.get(event.id);
        if (existing !== undefined) {
          if (JSON.stringify(existing) !== JSON.stringify(event)) conflictingId = true;
          if (compareNewestFirst(event, existing) >= 0) return;
        }
        candidates.set(event.id, event);
        if (candidates.size > limit * 2) {
          retainNewest(candidates, limit);
          resultLimited = true;
        }
      },
    });
    resultLimited ||= candidates.size > limit;
    const issues = new Set<DiagnosticReadIssue>(source.readState.reasons
      .filter((reason): reason is DiagnosticReadIssue => reason !== 'notConfigured'));
    if (resultLimited) issues.add('limitReached');
    if (conflictingId) issues.add('invalidEntries');
    return {
      diagnosticEvents: [...candidates.values()].sort(compareNewestFirst).slice(0, limit),
      readState: createDiagnosticReadState(issues, source.readState.status !== 'unavailable'),
    };
  }
}

export const emptyDiagnosticEventReader: DiagnosticEventReader = Object.freeze({
  async listRecentDiagnosticEvents() {
    return { diagnosticEvents: [], readState: notConfiguredDiagnosticReadState };
  },
});

function compareNewestFirst(left: DiagnosticEventItem, right: DiagnosticEventItem): number {
  return Date.parse(right.occurredAt) - Date.parse(left.occurredAt) || right.id.localeCompare(left.id);
}

function retainNewest(candidates: Map<string, DiagnosticEventItem>, limit: number): void {
  const retained = [...candidates.values()].sort(compareNewestFirst).slice(0, limit);
  candidates.clear();
  for (const event of retained) candidates.set(event.id, event);
}
