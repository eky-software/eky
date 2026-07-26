import type { OperationalLogger } from '../operationalLogger.js';
import { IncidentIndexingOperationalLogger } from './incidentIndexingOperationalLogger.js';
import { maintainIncidentIndex } from './incidentIndexRetention.js';
import { JsonLineIncidentIndex } from './jsonLineIncidentIndex.js';
import { JsonLineOperationalLogger } from './jsonLineOperationalLogger.js';

export function createBackendOperationalLogger(
  logsRoot: string,
): OperationalLogger {
  maintainIncidentIndex({ logsRoot });

  return new IncidentIndexingOperationalLogger(
    new JsonLineOperationalLogger({ logsRoot }),
    new JsonLineIncidentIndex(logsRoot),
  );
}
