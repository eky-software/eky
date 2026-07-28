import { createBackendOperationalEvent } from '../../../../observability/createOperationalEvent.js';
import type { OperationalRuntimeIdentity } from '../../../../observability/operationalEvent.js';
import type { OperationalLogger } from '../../../../observability/operationalLogger.js';
import type {
  DnaSmtpTransportDiagnosticInput,
  DnaSmtpTransportDiagnostics,
} from './dnaSmtpTransportDiagnostics.js';

export function createDnaSmtpOperationalDiagnostics(options: {
  operationalIdentity: Readonly<OperationalRuntimeIdentity>;
  operationalLogger: OperationalLogger;
}): DnaSmtpTransportDiagnostics {
  return Object.freeze({
    recordConnectionSecured(input: DnaSmtpTransportDiagnosticInput) {
      writeSafely(options, 'smtp.connectionSecured', 'connect', input);
    },
    recordDeliveryCompleted(input: DnaSmtpTransportDiagnosticInput) {
      writeSafely(options, 'smtp.deliveryCompleted', 'delivery', input);
    },
  });
}

function writeSafely(
  options: {
    operationalIdentity: Readonly<OperationalRuntimeIdentity>;
    operationalLogger: OperationalLogger;
  },
  eventName: 'smtp.connectionSecured' | 'smtp.deliveryCompleted',
  stage: 'connect' | 'delivery',
  input: DnaSmtpTransportDiagnosticInput,
): void {
  try {
    options.operationalLogger.write(
      createBackendOperationalEvent(
        {
          ...input,
          eventName,
          stage,
        },
        options.operationalIdentity,
      ),
    );
  } catch {
    // Diagnostics must never change SMTP delivery outcomes.
  }
}
