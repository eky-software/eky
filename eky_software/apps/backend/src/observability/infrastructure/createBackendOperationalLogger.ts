import type { OperationalLogger } from '../operationalLogger.js';
import type { OperationalRuntimeIdentity } from '../operationalEvent.js';
import { resolveOperationalRuntimeIdentity } from '../operationalRuntimeIdentity.js';
import { IncidentIndexingOperationalLogger } from './incidentIndexingOperationalLogger.js';
import { maintainIncidentIndex } from './incidentIndexRetention.js';
import { JsonLineIncidentIndex } from './jsonLineIncidentIndex.js';
import { JsonLineOperationalLogger } from './jsonLineOperationalLogger.js';
import { IncidentIndexOperationalLogFailureSink } from './incidentIndexOperationalLogFailureSink.js';

export function createBackendOperationalLogger(
  logsRoot: string,
  operationalIdentity: Readonly<OperationalRuntimeIdentity> =
    resolveOperationalRuntimeIdentity({}),
): OperationalLogger {
  maintainIncidentIndex({ logsRoot });
  const incidentIndex = new JsonLineIncidentIndex(logsRoot);

  return new IncidentIndexingOperationalLogger(
    new JsonLineOperationalLogger({
      failureSink: new IncidentIndexOperationalLogFailureSink({
        operationalIdentity,
        incidentIndex,
      }),
      logsRoot,
    }),
    incidentIndex,
  );
}
