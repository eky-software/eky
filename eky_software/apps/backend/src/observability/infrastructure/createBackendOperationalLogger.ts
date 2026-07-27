import type { OperationalLogger } from '../operationalLogger.js';
import { IncidentIndexingOperationalLogger } from './incidentIndexingOperationalLogger.js';
import { maintainIncidentIndex } from './incidentIndexRetention.js';
import { JsonLineIncidentIndex } from './jsonLineIncidentIndex.js';
import { JsonLineOperationalLogger } from './jsonLineOperationalLogger.js';
import { IncidentIndexOperationalLogFailureSink } from './incidentIndexOperationalLogFailureSink.js';

export function createBackendOperationalLogger(
  logsRoot: string,
  appVersion = '0.0.0',
): OperationalLogger {
  maintainIncidentIndex({ logsRoot });
  const incidentIndex = new JsonLineIncidentIndex(logsRoot);

  return new IncidentIndexingOperationalLogger(
    new JsonLineOperationalLogger({
      failureSink: new IncidentIndexOperationalLogFailureSink({
        appVersion,
        incidentIndex,
      }),
      logsRoot,
    }),
    incidentIndex,
  );
}
