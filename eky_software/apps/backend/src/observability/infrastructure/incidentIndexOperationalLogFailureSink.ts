import type { LongTermIncidentIndex } from '../longTermIncidentIndex.js';
import type { OperationalLogFailureSink } from './jsonLineOperationalLogger.js';
import type { BackendOperationalLogStream } from './operationalLogFiles.js';

export class IncidentIndexOperationalLogFailureSink
  implements OperationalLogFailureSink
{
  readonly #appVersion: string;
  readonly #incidentIndex: LongTermIncidentIndex;
  readonly #recordedFailures = new Set<string>();

  constructor(options: {
    appVersion: string;
    incidentIndex: LongTermIncidentIndex;
  }) {
    this.#appVersion = options.appVersion;
    this.#incidentIndex = options.incidentIndex;
  }

  recordFailure(input: {
    errorCode: 'LOG_CAPACITY_REACHED' | 'LOG_WRITE_FAILED';
    stream: BackendOperationalLogStream;
  }): void {
    const failureKey = `${input.errorCode}:${input.stream}`;
    if (this.#recordedFailures.has(failureKey)) {
      return;
    }
    this.#recordedFailures.add(failureKey);

    this.#incidentIndex.write({
      appVersion: this.#appVersion,
      component: 'backend',
      errorCode: input.errorCode,
      eventName:
        input.errorCode === 'LOG_CAPACITY_REACHED'
          ? 'operationalLog.capacityReached'
          : 'operationalLog.writeFailed',
      fingerprint: failureKey,
      outcome: 'failure',
      timestamp: new Date().toISOString(),
    });
  }
}
