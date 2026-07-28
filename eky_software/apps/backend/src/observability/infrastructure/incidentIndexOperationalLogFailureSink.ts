import type { LongTermIncidentIndex } from '../longTermIncidentIndex.js';
import type { OperationalRuntimeIdentity } from '../operationalEvent.js';
import type { OperationalLogFailureSink } from './jsonLineOperationalLogger.js';
import type { BackendOperationalLogStream } from './operationalLogFiles.js';

export class IncidentIndexOperationalLogFailureSink
  implements OperationalLogFailureSink
{
  readonly #incidentIndex: LongTermIncidentIndex;
  readonly #operationalIdentity: Readonly<OperationalRuntimeIdentity>;
  readonly #recordedFailures = new Set<string>();

  constructor(options: {
    operationalIdentity: Readonly<OperationalRuntimeIdentity>;
    incidentIndex: LongTermIncidentIndex;
  }) {
    this.#incidentIndex = options.incidentIndex;
    this.#operationalIdentity = options.operationalIdentity;
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
      schemaVersion: 1,
      appVersion: this.#operationalIdentity.appVersion,
      buildRevision: this.#operationalIdentity.buildRevision,
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
