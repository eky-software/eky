import type { SmtpTransportSecuritySummary } from '../../smtp/smtpTransportSecurity.js';

export interface DnaSmtpTransportDiagnosticInput
  extends SmtpTransportSecuritySummary {
  durationMs: number;
  operationId: string;
}

export interface DnaSmtpTransportDiagnostics {
  recordConnectionSecured(
    input: DnaSmtpTransportDiagnosticInput,
  ): void;
  recordDeliveryCompleted(
    input: DnaSmtpTransportDiagnosticInput,
  ): void;
}

export const noOpDnaSmtpTransportDiagnostics: DnaSmtpTransportDiagnostics =
  Object.freeze({
    recordConnectionSecured() {},
    recordDeliveryCompleted() {},
  });
