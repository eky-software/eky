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
import { createBackendOperationalEvent } from '../src/observability/createOperationalEvent.js';
import type { OperationalRuntimeIdentity } from '../src/observability/operationalEvent.js';
import type { OperationalLogger } from '../src/observability/operationalLogger.js';

export class E2eFakeSmtpProvider
  implements InvoiceSmtpDeliveryProvider, InvoiceSmtpTestDeliveryProvider
{
  readonly #operationalIdentity: Readonly<OperationalRuntimeIdentity>;
  readonly #operationalLogger: OperationalLogger;
  readonly #outcome: E2eSmtpOutcome | null;

  constructor(
    faultPlan: E2eFaultPlan,
    options: {
      operationalIdentity: Readonly<OperationalRuntimeIdentity>;
      operationalLogger: OperationalLogger;
    },
  ) {
    this.#operationalIdentity = options.operationalIdentity;
    this.#operationalLogger = options.operationalLogger;
    this.#outcome = faultPlan.kind === 'smtp' ? faultPlan.outcome : null;
  }

  async sendEmail(
    input: InvoiceSmtpEmailInput,
  ): Promise<InvoiceSmtpEmailResult> {
    this.#throwConfiguredDeliveryFault(input.attemptId);
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
    this.#throwConfiguredTestFault(input.attemptId);
    return {
      deliveredTo: input.emailTestRecipientOverride,
      provider: 'smtp',
      providerMessageId: `e2e-${input.attemptId}@invalid`,
      testMode: true,
    };
  }

  #throwConfiguredDeliveryFault(operationId: string): void {
    const failure = mapFault(this.#outcome);
    if (failure !== null) {
      this.#recordFault(failure, operationId, 'delivery');
      throw new InvoiceSmtpDeliveryError(
        failure.outcome,
        failure.technicalErrorCode,
      );
    }
  }

  #throwConfiguredTestFault(operationId: string): void {
    const failure = mapFault(this.#outcome);
    if (failure !== null) {
      this.#recordFault(failure, operationId, 'testDelivery');
      throw new InvoiceSmtpTestDeliveryError(
        failure.outcome,
        failure.technicalErrorCode,
      );
    }
  }

  #recordFault(
    failure: NonNullable<ReturnType<typeof mapFault>>,
    operationId: string,
    stage: string,
  ): void {
    this.#operationalLogger.write(
      createBackendOperationalEvent(
        {
          durationMs: 0,
          errorCode: failure.technicalErrorCode,
          eventName: failure.eventName,
          operationId,
          retryable: failure.retryable,
          sideEffectState:
            failure.outcome === 'outcomeUnknown' ? 'unknown' : 'none',
          stage,
        },
        this.#operationalIdentity,
      ),
    );
  }
}

function mapFault(outcome: E2eSmtpOutcome | null): {
  eventName:
    | 'smtp.authenticationFailed'
    | 'smtp.connectionFailed'
    | 'smtp.deliveryFailed'
    | 'smtp.deliveryOutcomeUnknown'
    | 'smtp.tlsFailed';
  outcome: 'failed' | 'outcomeUnknown';
  retryable: boolean;
  technicalErrorCode: string;
} | null {
  switch (outcome) {
    case null:
      return null;
    case 'connectionFailed':
      return {
        eventName: 'smtp.connectionFailed',
        outcome: 'failed',
        retryable: true,
        technicalErrorCode: 'E2E_SMTP_CONNECTION_FAILED',
      };
    case 'tlsFailed':
      return {
        eventName: 'smtp.tlsFailed',
        outcome: 'failed',
        retryable: false,
        technicalErrorCode: 'E2E_SMTP_TLS_FAILED',
      };
    case 'authenticationFailed':
      return {
        eventName: 'smtp.authenticationFailed',
        outcome: 'failed',
        retryable: false,
        technicalErrorCode: 'E2E_SMTP_AUTHENTICATION_FAILED',
      };
    case 'deliveryFailed':
      return {
        eventName: 'smtp.deliveryFailed',
        outcome: 'failed',
        retryable: false,
        technicalErrorCode: 'E2E_SMTP_DELIVERY_FAILED',
      };
    case 'outcomeUnknown':
      return {
        eventName: 'smtp.deliveryOutcomeUnknown',
        outcome: 'outcomeUnknown',
        retryable: false,
        technicalErrorCode: 'E2E_SMTP_OUTCOME_UNKNOWN',
      };
  }
}
