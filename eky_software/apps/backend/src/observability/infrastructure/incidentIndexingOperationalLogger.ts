import type { BackendOperationalEvent } from '../operationalEvent.js';
import type { LongTermIncidentIndex } from '../longTermIncidentIndex.js';
import type { OperationalLogger } from '../operationalLogger.js';

export class IncidentIndexingOperationalLogger implements OperationalLogger {
  readonly #detailedLogger: OperationalLogger;
  readonly #incidentIndex: LongTermIncidentIndex;

  constructor(
    detailedLogger: OperationalLogger,
    incidentIndex: LongTermIncidentIndex,
  ) {
    this.#detailedLogger = detailedLogger;
    this.#incidentIndex = incidentIndex;
  }

  write(event: BackendOperationalEvent): void {
    this.#detailedLogger.write(event);

    if (!shouldIndex(event)) {
      return;
    }

    const errorCode =
      'errorCode' in event ? event.errorCode : 'SECURITY_EVENT_BLOCKED';
    const fingerprint =
      'fingerprint' in event && event.fingerprint !== undefined
        ? event.fingerprint
        : `${event.eventName}:${errorCode}`;

    this.#incidentIndex.write({
      schemaVersion: 1,
      appVersion: event.appVersion,
      buildRevision: event.buildRevision,
      component: 'backend',
      errorCode,
      eventName: event.eventName,
      fingerprint,
      outcome:
        event.outcome === 'success' ? 'failure' : event.outcome,
      timestamp: event.timestamp,
    });
  }
}

function shouldIndex(event: BackendOperationalEvent): boolean {
  return (
    event.level === 'error' ||
    event.category === 'authorization' ||
    event.category === 'security'
  );
}
