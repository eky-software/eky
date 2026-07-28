import { createBackendOperationalEvent } from '../../../../observability/createOperationalEvent.js';
import type { OperationalRuntimeIdentity } from '../../../../observability/operationalEvent.js';
import type { OperationalLogger } from '../../../../observability/operationalLogger.js';
import type {
  DnaSmtpTransportDiagnosticInput,
  DnaSmtpTransportDiagnostics,
  DnaSmtpTransportFailureDiagnosticInput,
} from './dnaSmtpTransportDiagnostics.js';
import { mapSmtpTransportFailureToOperationalEvent } from './mapSmtpTransportFailureToOperationalEvent.js';

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
    recordFailure(input: DnaSmtpTransportFailureDiagnosticInput) {
      writeFailureSafely(options, input);
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

function writeFailureSafely(
  options: {
    operationalIdentity: Readonly<OperationalRuntimeIdentity>;
    operationalLogger: OperationalLogger;
  },
  input: DnaSmtpTransportFailureDiagnosticInput,
): void {
  try {
    const failure = mapSmtpTransportFailureToOperationalEvent(input);
    const failureFields: SmtpOperationalFailureFields = {
      durationMs: input.durationMs,
      errorCode: input.errorCode,
      operationId: input.operationId,
      retryable: failure.retryable,
      sideEffectState: failure.sideEffectState,
      stage: input.phase,
      ...(input.transportSecurity === undefined
        ? {}
        : {
            cipherName: input.transportSecurity.cipherName,
            peerCertificateFingerprint256:
              input.transportSecurity.peerCertificateFingerprint256,
            remoteAddress: input.transportSecurity.remoteAddress,
            remoteFamily: input.transportSecurity.remoteFamily,
            smtpProfile: input.transportSecurity.smtpProfile,
            targetPort: input.transportSecurity.targetPort,
            tlsVersion: input.transportSecurity.tlsVersion,
          }),
    };

    switch (failure.eventName) {
      case 'smtp.authenticationFailed':
        writeFailureEvent(
          options,
          { ...failureFields, eventName: 'smtp.authenticationFailed' },
        );
        break;
      case 'smtp.connectionFailed':
        writeFailureEvent(
          options,
          { ...failureFields, eventName: 'smtp.connectionFailed' },
        );
        break;
      case 'smtp.deliveryFailed':
        writeFailureEvent(
          options,
          { ...failureFields, eventName: 'smtp.deliveryFailed' },
        );
        break;
      case 'smtp.deliveryOutcomeUnknown':
        writeFailureEvent(
          options,
          { ...failureFields, eventName: 'smtp.deliveryOutcomeUnknown' },
        );
        break;
      case 'smtp.tlsFailed':
        writeFailureEvent(
          options,
          { ...failureFields, eventName: 'smtp.tlsFailed' },
        );
        break;
    }
  } catch {
    // Diagnostics must never change SMTP delivery outcomes.
  }
}

interface SmtpOperationalFailureFields {
  cipherName?: string;
  durationMs: number;
  errorCode: string;
  operationId: string;
  peerCertificateFingerprint256?: string;
  remoteAddress?: string;
  remoteFamily?: 'IPv4' | 'IPv6';
  retryable: boolean;
  sideEffectState: 'none' | 'unknown';
  smtpProfile?: 'dnaSmtp';
  stage: string;
  targetPort?: 465;
  tlsVersion?: 'TLSv1.2' | 'TLSv1.3';
}

type SmtpFailureEventInput =
  | (SmtpOperationalFailureFields & {
      eventName: 'smtp.authenticationFailed';
    })
  | (SmtpOperationalFailureFields & {
      eventName: 'smtp.connectionFailed';
    })
  | (SmtpOperationalFailureFields & {
      eventName: 'smtp.deliveryFailed';
    })
  | (SmtpOperationalFailureFields & {
      eventName: 'smtp.deliveryOutcomeUnknown';
    })
  | (SmtpOperationalFailureFields & {
      eventName: 'smtp.tlsFailed';
    });

function writeFailureEvent(
  options: {
    operationalIdentity: Readonly<OperationalRuntimeIdentity>;
    operationalLogger: OperationalLogger;
  },
  input: SmtpFailureEventInput,
): void {
  switch (input.eventName) {
    case 'smtp.authenticationFailed':
      options.operationalLogger.write(
        createBackendOperationalEvent(input, options.operationalIdentity),
      );
      break;
    case 'smtp.connectionFailed':
      options.operationalLogger.write(
        createBackendOperationalEvent(input, options.operationalIdentity),
      );
      break;
    case 'smtp.deliveryFailed':
      options.operationalLogger.write(
        createBackendOperationalEvent(input, options.operationalIdentity),
      );
      break;
    case 'smtp.deliveryOutcomeUnknown':
      options.operationalLogger.write(
        createBackendOperationalEvent(input, options.operationalIdentity),
      );
      break;
    case 'smtp.tlsFailed':
      options.operationalLogger.write(
        createBackendOperationalEvent(input, options.operationalIdentity),
      );
      break;
  }
}
