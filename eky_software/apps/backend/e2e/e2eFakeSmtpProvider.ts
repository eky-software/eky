import {
  InvoiceSmtpDeliveryError,
  type InvoiceSmtpDeliveryProvider,
  type InvoiceSmtpEmailInput,
  type InvoiceSmtpEmailResult,
} from '../src/modules/invoicing/ports/invoiceSmtpDeliveryProvider.js';
import {
  InvoiceSmtpTestDeliveryError,
  type InvoiceSmtpTestDeliveryProvider,
  type InvoiceSmtpTestEmailInput,
  type InvoiceSmtpTestEmailResult,
} from '../src/modules/invoicing/ports/invoiceSmtpTestDeliveryProvider.js';
import type {
  E2eFaultPlan,
  E2eSmtpOutcome,
} from './e2eBackendConfig.js';

export class E2eFakeSmtpProvider
  implements InvoiceSmtpDeliveryProvider, InvoiceSmtpTestDeliveryProvider
{
  readonly #outcome: E2eSmtpOutcome | null;

  constructor(faultPlan: E2eFaultPlan) {
    this.#outcome = faultPlan.kind === 'smtp' ? faultPlan.outcome : null;
  }

  async sendEmail(
    input: InvoiceSmtpEmailInput,
  ): Promise<InvoiceSmtpEmailResult> {
    this.#throwConfiguredDeliveryFault();
    return {
      deliveredCc: input.cc,
      deliveredTo: input.to,
      provider: 'smtp',
      providerMessageId: `e2e-${input.attemptId}@invalid`,
      testMode: false,
    };
  }

  async sendTestEmail(
    input: InvoiceSmtpTestEmailInput,
  ): Promise<InvoiceSmtpTestEmailResult> {
    this.#throwConfiguredTestFault();
    return {
      deliveredTo: input.emailTestRecipientOverride,
      provider: 'smtp',
      providerMessageId: `e2e-${input.attemptId}@invalid`,
      testMode: true,
    };
  }

  #throwConfiguredDeliveryFault(): void {
    const failure = mapFault(this.#outcome);
    if (failure !== null) {
      throw new InvoiceSmtpDeliveryError(
        failure.outcome,
        failure.technicalErrorCode,
      );
    }
  }

  #throwConfiguredTestFault(): void {
    const failure = mapFault(this.#outcome);
    if (failure !== null) {
      throw new InvoiceSmtpTestDeliveryError(
        failure.outcome,
        failure.technicalErrorCode,
      );
    }
  }
}

function mapFault(outcome: E2eSmtpOutcome | null): {
  outcome: 'failed' | 'outcomeUnknown';
  technicalErrorCode: string;
} | null {
  switch (outcome) {
    case null:
      return null;
    case 'connectionFailed':
      return {
        outcome: 'failed',
        technicalErrorCode: 'E2E_SMTP_CONNECTION_FAILED',
      };
    case 'tlsFailed':
      return {
        outcome: 'failed',
        technicalErrorCode: 'E2E_SMTP_TLS_FAILED',
      };
    case 'authenticationFailed':
      return {
        outcome: 'failed',
        technicalErrorCode: 'E2E_SMTP_AUTHENTICATION_FAILED',
      };
    case 'deliveryFailed':
      return {
        outcome: 'failed',
        technicalErrorCode: 'E2E_SMTP_DELIVERY_FAILED',
      };
    case 'outcomeUnknown':
      return {
        outcome: 'outcomeUnknown',
        technicalErrorCode: 'E2E_SMTP_OUTCOME_UNKNOWN',
      };
  }
}
