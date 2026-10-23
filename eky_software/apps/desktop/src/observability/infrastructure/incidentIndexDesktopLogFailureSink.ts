import { resolve } from 'node:path';

import type { DesktopOperationalIdentity } from '../desktopOperationalEvent.js';
import type { DesktopLogFailureSink } from './jsonLineDesktopOperationalLogger.js';
import { writeDesktopIncidentIndexEntry } from './jsonLineDesktopIncidentIndex.js';

export class IncidentIndexDesktopLogFailureSink implements DesktopLogFailureSink {
  readonly #recordedFailures = new Set<string>();
  readonly #logsRoot: string;
  readonly #identity: Pick<DesktopOperationalIdentity, 'appVersion' | 'buildRevision'>;
  #listener: (() => void) | undefined;

  constructor(options: { logsRoot: string; operationalIdentity: DesktopOperationalIdentity }) {
    if (resolve(options.logsRoot) !== options.logsRoot) {
      throw new Error('Desktop log failure root must be absolute.');
    }
    this.#logsRoot = options.logsRoot;
    this.#identity = { appVersion: options.operationalIdentity.appVersion,
      buildRevision: options.operationalIdentity.buildRevision };
  }

  get failureObserved(): boolean {
    return this.#recordedFailures.size > 0;
  }

  subscribe(listener: () => void): () => void {
    this.#listener = listener;
    return () => { if (this.#listener === listener) this.#listener = undefined; };
  }

  recordFailure(input: Parameters<DesktopLogFailureSink['recordFailure']>[0]): void {
    if ((input.errorCode !== 'LOG_CAPACITY_REACHED' && input.errorCode !== 'LOG_WRITE_FAILED') ||
      !['desktop-info', 'desktop-warning-error', 'desktop-security'].includes(input.stream)) return;
    const key = `${input.errorCode}:${input.stream}`;
    if (this.#recordedFailures.has(key)) return;
    const firstFailure = !this.failureObserved;
    this.#recordedFailures.add(key);

    if (firstFailure) {
      try { this.#listener?.(); }
      catch { /* Feedback cannot recurse or change the business result. */ }
    }
    writeDesktopIncidentIndexEntry(this.#logsRoot, {
      schemaVersion: 1,
      ...this.#identity,
      component: 'desktop',
      errorCode: input.errorCode,
      eventName: input.errorCode === 'LOG_CAPACITY_REACHED'
        ? 'operationalLog.capacityReached' : 'operationalLog.writeFailed',
      fingerprint: key,
      outcome: 'failure',
      timestamp: new Date().toISOString(),
    });
  }
}
