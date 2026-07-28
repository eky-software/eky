import type {
  SmtpErrorCode,
  SmtpFailureOutcome,
} from '../../smtp/smtpErrors.js';
import type { SmtpTransportSecuritySummary } from '../../smtp/smtpTransportSecurity.js';

export interface DnaSmtpTransportDiagnosticInput
  extends SmtpTransportSecuritySummary {
  durationMs: number;
  operationId: string;
}

export interface DnaSmtpTransportFailureDiagnosticInput {
  durationMs: number;
  errorCode: SmtpErrorCode;
  operationId: string;
  outcome: SmtpFailureOutcome;
  phase: string;
  transportSecurity?: SmtpTransportSecuritySummary;
}

export interface DnaSmtpTransportDiagnostics {
  recordConnectionSecured(
    input: DnaSmtpTransportDiagnosticInput,
  ): void;
  recordDeliveryCompleted(
    input: DnaSmtpTransportDiagnosticInput,
  ): void;
  recordFailure(
    input: DnaSmtpTransportFailureDiagnosticInput,
  ): void;
}

export const noOpDnaSmtpTransportDiagnostics: DnaSmtpTransportDiagnostics =
  Object.freeze({
    recordConnectionSecured() {},
    recordDeliveryCompleted() {},
    recordFailure() {},
  });
