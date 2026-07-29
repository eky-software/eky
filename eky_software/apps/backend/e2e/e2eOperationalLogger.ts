import { createBackendOperationalLogger } from '../src/observability/infrastructure/createBackendOperationalLogger.js';
import type { OperationalLogger } from '../src/observability/operationalLogger.js';
import type { OperationalRuntimeIdentity } from '../src/observability/operationalEvent.js';
import type { E2eFaultPlan } from './e2eBackendConfig.js';

export function createE2eOperationalLogger(input: {
  faultPlan: E2eFaultPlan;
  logsRoot: string;
  operationalIdentity: Readonly<OperationalRuntimeIdentity>;
}): OperationalLogger {
  if (input.faultPlan.kind === 'operationalLogWriteFailed') {
    return Object.freeze({
      write() {
        // Production logging already treats a failed write as non-fatal.
      },
    });
  }

  return createBackendOperationalLogger(
    input.logsRoot,
    input.operationalIdentity,
  );
}
