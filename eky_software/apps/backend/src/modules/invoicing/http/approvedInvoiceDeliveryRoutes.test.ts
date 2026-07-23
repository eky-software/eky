import { createActorContext } from '@eky/auth';
import { AuthorizationError } from '@eky/permissions';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import type { BackendEnvironment } from '../../../http/runtimeTrust.js';
import type { ListInvoiceDeliveryEventsInput } from '../application/listInvoiceDeliveryEvents.js';
import type { MarkApprovedInvoiceSentInput } from '../application/markApprovedInvoiceSent.js';
import type {
  PrepareApprovedInvoiceEmailDryRunInput,
} from '../application/prepareApprovedInvoiceEmailDryRun.js';
import type {
  PrepareApprovedInvoiceEmailSmtpTestInput,
} from '../application/prepareApprovedInvoiceEmailSmtpTest.js';
import type {
  PrepareApprovedInvoiceEmailSmtpInput,
} from '../application/prepareApprovedInvoiceEmailSmtp.js';
import type {
  SendApprovedInvoiceEmailDryRunInput,
  SendApprovedInvoiceEmailDryRunResult,
} from '../application/sendApprovedInvoiceEmailDryRun.js';
import type {
  SendApprovedInvoiceEmailSmtpTestInput,
  SendApprovedInvoiceEmailSmtpTestResult,
} from '../application/sendApprovedInvoiceEmailSmtpTest.js';
import type {
  SendApprovedInvoiceEmailSmtpInput,
  SendApprovedInvoiceEmailSmtpResult,
} from '../application/sendApprovedInvoiceEmailSmtp.js';
import type { ApprovedInvoiceEmailPreview } from '../application/approvedInvoiceEmailPreview.js';
import { ApprovedInvoiceNotFoundError } from '../application/approvedInvoiceNotFoundError.js';
import { InvoiceDeliveryConflictError } from '../application/invoiceDeliveryConflictError.js';
import type { ApprovedInvoiceView } from '../domain/approvedInvoiceView.js';
import type { InvoiceDeliveryEventSummary } from '../domain/invoiceDeliveryEventSummary.js';
import { createApprovedInvoiceDeliveryRoutes } from './approvedInvoiceDeliveryRoutes.js';

describe('approved invoice delivery routes', () => {

  it('marks an approved invoice as sent in the company scope', async () => {
    const sentInvoice = createApprovedInvoiceView({ status: 'sent' });
    const { app, getMarkSentInput } = createTestApp({
      sentInvoice,
    });

    const response = await app.request('/invoices/invoice-1/mark-sent', {
      body: JSON.stringify({ deliveryMethod: 'print' }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    });

    await expect(response.json()).resolves.toEqual({ invoice: sentInvoice });
    expect(response.status).toBe(200);
    expect(getMarkSentInput()).toMatchObject({
      actorContext: {
        actorId: 'dev-user',
        companyId: 'dev-company',
      },
      deliveryMethod: 'print',
      invoiceId: 'invoice-1',
    });
  });

  it('rejects an unbounded manual delivery method', async () => {
    const { app, getMarkSentInput } = createTestApp({});

    const response = await app.request('/invoices/invoice-1/mark-sent', {
      body: JSON.stringify({ deliveryMethod: 'email' }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    });

    expect(response.status).toBe(400);
    expect(getMarkSentInput()).toBeUndefined();
  });

  it('rejects server-owned fields in manual delivery input', async () => {
    const { app, getMarkSentInput } = createTestApp({});

    const response = await app.request('/invoices/invoice-1/mark-sent', {
      body: JSON.stringify({
        companyId: 'other-company',
        deliveryMethod: 'print',
      }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    });

    expect(response.status).toBe(400);
    expect(getMarkSentInput()).toBeUndefined();
  });

  it('returns company-scoped delivery event summaries without technical metadata', async () => {
    const deliveryEvents: InvoiceDeliveryEventSummary[] = [
      {
        ccEmail: '',
        createdAt: '2026-07-20T20:00:00.000Z',
        deliveryMethod: 'print',
        id: 'event-1',
        provider: 'manual',
        recipientEmail: '',
        safeErrorMessage: null,
        status: 'succeeded',
      },
    ];
    const { app, getDeliveryEventsInput } = createTestApp({ deliveryEvents });

    const response = await app.request('/invoices/invoice-1/delivery-events');

    await expect(response.json()).resolves.toEqual({ events: deliveryEvents });
    expect(response.status).toBe(200);
    expect(getDeliveryEventsInput()).toMatchObject({
      actorContext: {
        actorId: 'dev-user',
        companyId: 'dev-company',
      },
      invoiceId: 'invoice-1',
    });
  });

  it('prepares a dry-run invoice email in the company scope', async () => {
    const email = createApprovedInvoiceEmailPreview();
    const { app, getEmailInput } = createTestApp({ email });

    const response = await app.request('/invoices/invoice-1/email/dry-run', {
      method: 'POST',
    });

    await expect(response.json()).resolves.toEqual({ email });
    expect(response.status).toBe(200);
    expect(getEmailInput()).toMatchObject({
      actorContext: {
        actorId: 'dev-user',
        companyId: 'dev-company',
      },
      invoiceId: 'invoice-1',
    });
  });

  it('sends a dry-run invoice email with user-edited fields in the company scope', async () => {
    const delivery = createApprovedInvoiceEmailDryRunSendResult();
    const { app, getEmailSendInput } = createTestApp({ emailDelivery: delivery });

    const response = await app.request('/invoices/invoice-1/email/dry-run/send', {
      body: JSON.stringify({
        body: 'Hei,\n\nTässä muokattu viesti.',
        cc: 'copy@example.fi',
        subject: 'Muokattu laskuotsikko',
        to: 'recipient@example.fi',
      }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    });

    await expect(response.json()).resolves.toEqual({ delivery });
    expect(response.status).toBe(200);
    expect(getEmailSendInput()).toMatchObject({
      actorContext: {
        actorId: 'dev-user',
        companyId: 'dev-company',
      },
      body: 'Hei,\n\nTässä muokattu viesti.',
      cc: 'copy@example.fi',
      invoiceId: 'invoice-1',
      subject: 'Muokattu laskuotsikko',
      to: 'recipient@example.fi',
    });
  });

  it('rejects server-owned fields in dry-run email send body', async () => {
    const { app, getEmailSendInput } = createTestApp({});

    const response = await app.request('/invoices/invoice-1/email/dry-run/send', {
      body: JSON.stringify({
        body: 'Hei',
        companyId: 'other-company',
        subject: 'Lasku',
        to: 'recipient@example.fi',
      }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    });

    await expect(response.json()).resolves.toEqual({
      error: 'Invalid invoice email body.',
    });
    expect(response.status).toBe(400);
    expect(getEmailSendInput()).toBeUndefined();
  });

  it('sends a controlled SMTP test through the trusted actor context', async () => {
    const delivery = createApprovedInvoiceEmailSmtpTestSendResult();
    const { app, getEmailSmtpTestInput } = createTestApp({
      emailSmtpTestDelivery: delivery,
    });

    const response = await app.request(
      '/invoices/invoice-1/email/smtp-test/send',
      {
        body: JSON.stringify({
          attemptId: 'attempt-1',
          authorizationToken: 'one-time-authorization',
          body: 'Hei, liitteenä lasku.',
          cc: 'copy@example.fi',
          subject: 'Lasku 20260001',
          to: 'customer@example.fi',
        }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      },
    );

    await expect(response.json()).resolves.toEqual({ delivery });
    expect(response.status).toBe(200);
    expect(getEmailSmtpTestInput()).toMatchObject({
      actorContext: {
        actorId: 'dev-user',
        companyId: 'dev-company',
      },
      invoiceId: 'invoice-1',
      attemptId: 'attempt-1',
      to: 'customer@example.fi',
    });
  });

  it('prepares a one-time controlled SMTP test authorization', async () => {
    const { app, getEmailSmtpTestPreparationInput } = createTestApp({});

    const response = await app.request(
      '/invoices/invoice-1/email/smtp-test/prepare',
      {
        body: JSON.stringify({
          body: 'Hei, liitteenä lasku.',
          cc: 'copy@example.fi',
          subject: 'Lasku 20260001',
          to: 'customer@example.fi',
        }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      preparation: expect.objectContaining({
        attemptId: 'attempt-1',
        testRecipient: 'owner-test@example.fi',
      }),
    });
    expect(getEmailSmtpTestPreparationInput()).toMatchObject({
      actorContext: {
        actorId: 'dev-user',
        companyId: 'dev-company',
      },
      invoiceId: 'invoice-1',
      to: 'customer@example.fi',
    });
  });

  it('prepares and sends a customer SMTP delivery through trusted context', async () => {
    const delivery = createApprovedInvoiceEmailSmtpSendResult();
    const { app, getEmailSmtpInput, getEmailSmtpPreparationInput } =
      createTestApp({ emailSmtpDelivery: delivery });
    const emailBody = {
      body: 'Hei, liitteenä lasku.',
      cc: 'copy@example.fi',
      subject: 'Lasku 20260001',
      to: 'customer@example.fi',
    };
    const preparationResponse = await app.request(
      '/invoices/invoice-1/email/smtp/prepare',
      {
        body: JSON.stringify(emailBody),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      },
    );

    expect(preparationResponse.status).toBe(200);
    expect(getEmailSmtpPreparationInput()).toMatchObject({
      actorContext: { actorId: 'dev-user', companyId: 'dev-company' },
      invoiceId: 'invoice-1',
      to: 'customer@example.fi',
    });

    const sendResponse = await app.request(
      '/invoices/invoice-1/email/smtp/send',
      {
        body: JSON.stringify({
          ...emailBody,
          attemptId: 'attempt-1',
          authorizationToken: 'one-time-authorization',
        }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      },
    );

    expect(sendResponse.status).toBe(200);
    await expect(sendResponse.json()).resolves.toEqual({ delivery });
    expect(getEmailSmtpInput()).toMatchObject({
      actorContext: { actorId: 'dev-user', companyId: 'dev-company' },
      invoiceId: 'invoice-1',
      attemptId: 'attempt-1',
      to: 'customer@example.fi',
    });
  });

  it('rejects server-owned fields in a customer SMTP preparation', async () => {
    const { app, getEmailSmtpPreparationInput } = createTestApp({});

    const response = await app.request(
      '/invoices/invoice-1/email/smtp/prepare',
      {
        body: JSON.stringify({
          body: 'Hei',
          companyId: 'other-company',
          subject: 'Lasku',
          to: 'customer@example.fi',
        }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      },
    );

    expect(response.status).toBe(400);
    expect(getEmailSmtpPreparationInput()).toBeUndefined();
  });

  it('returns a distinguishable safe conflict for an unresolved delivery', async () => {
    const { app, getEmailSmtpPreparationInput } = createTestApp({
      emailSmtpPreparationError: new InvoiceDeliveryConflictError(),
    });

    const response = await app.request(
      '/invoices/invoice-1/email/smtp/prepare',
      {
        body: JSON.stringify({
          body: 'Hei',
          subject: 'Lasku',
          to: 'customer@example.fi',
        }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      },
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: 'Invoice has an unresolved delivery attempt.',
    });
    expect(getEmailSmtpPreparationInput()).toBeDefined();
  });

  it('rejects server-owned fields in a customer SMTP send body', async () => {
    const { app, getEmailSmtpInput } = createTestApp({});

    const response = await app.request(
      '/invoices/invoice-1/email/smtp/send',
      {
        body: JSON.stringify({
          attemptId: 'attempt-1',
          authorizationToken: 'one-time-authorization',
          body: 'Hei',
          companyId: 'other-company',
          status: 'sent',
          subject: 'Lasku',
          to: 'customer@example.fi',
        }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      },
    );

    expect(response.status).toBe(400);
    expect(getEmailSmtpInput()).toBeUndefined();
  });

  it('returns a safe 404 when dry-run sending email for an invoice outside the company scope', async () => {
    const { app } = createTestApp({
      emailSendError: new ApprovedInvoiceNotFoundError(),
    });

    const response = await app.request('/invoices/missing/email/dry-run/send', {
      body: JSON.stringify({
        body: 'Hei',
        subject: 'Lasku',
        to: 'recipient@example.fi',
      }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    });

    await expect(response.json()).resolves.toEqual({
      error: 'Approved invoice was not found.',
    });
    expect(response.status).toBe(404);
  });

  it('returns a safe 404 when marking an invoice sent outside the company scope', async () => {
    const { app } = createTestApp({
      markSentError: new ApprovedInvoiceNotFoundError(),
    });

    const response = await app.request('/invoices/missing/mark-sent', {
      body: JSON.stringify({ deliveryMethod: 'manual' }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    });

    await expect(response.json()).resolves.toEqual({
      error: 'Approved invoice was not found.',
    });
    expect(response.status).toBe(404);
  });

  it('returns a safe conflict when manual delivery has an unresolved attempt', async () => {
    const { app } = createTestApp({
      markSentError: new InvoiceDeliveryConflictError(),
    });

    const response = await app.request('/invoices/invoice-1/mark-sent', {
      body: JSON.stringify({ deliveryMethod: 'manual' }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    });

    await expect(response.json()).resolves.toEqual({
      error: 'Invoice has an unresolved delivery attempt.',
    });
    expect(response.status).toBe(409);
  });

  it('returns a safe 404 when preparing email for an invoice outside the company scope', async () => {
    const { app } = createTestApp({
      emailError: new ApprovedInvoiceNotFoundError(),
    });

    const response = await app.request('/invoices/missing/email/dry-run', {
      method: 'POST',
    });

    await expect(response.json()).resolves.toEqual({
      error: 'Approved invoice was not found.',
    });
    expect(response.status).toBe(404);
  });

  it('returns a safe 403 when preparing email without permission', async () => {
    const { app } = createTestApp({
      emailError: new AuthorizationError(),
    });

    const response = await app.request('/invoices/invoice-1/email/dry-run', {
      method: 'POST',
    });

    await expect(response.json()).resolves.toEqual({
      error: 'Access denied.',
    });
    expect(response.status).toBe(403);
  });

});

function createTestApp(options: {
  deliveryEvents?: InvoiceDeliveryEventSummary[];
  emailDelivery?: SendApprovedInvoiceEmailDryRunResult;
  emailSmtpDelivery?: SendApprovedInvoiceEmailSmtpResult;
  emailSmtpTestDelivery?: SendApprovedInvoiceEmailSmtpTestResult;
  emailSendError?: Error;
  emailSmtpPreparationError?: Error;
  email?: ApprovedInvoiceEmailPreview;
  emailError?: Error;
  error?: Error;
  markSentError?: Error;
  sentInvoice?: ApprovedInvoiceView;
}) {
  let deliveryEventsInput: ListInvoiceDeliveryEventsInput | undefined;
  let markSentInput: MarkApprovedInvoiceSentInput | undefined;
  let emailInput: PrepareApprovedInvoiceEmailDryRunInput | undefined;
  let emailSendInput: SendApprovedInvoiceEmailDryRunInput | undefined;
  let emailSmtpTestPreparationInput:
    | PrepareApprovedInvoiceEmailSmtpTestInput
    | undefined;
  let emailSmtpTestInput: SendApprovedInvoiceEmailSmtpTestInput | undefined;
  let emailSmtpPreparationInput:
    | PrepareApprovedInvoiceEmailSmtpInput
    | undefined;
  let emailSmtpInput: SendApprovedInvoiceEmailSmtpInput | undefined;
  const routes = createApprovedInvoiceDeliveryRoutes({
    async listInvoiceDeliveryEvents(nextInput) {
      deliveryEventsInput = nextInput;

      if (options.error !== undefined) {
        throw options.error;
      }

      return options.deliveryEvents ?? [];
    },
    async markApprovedInvoiceSent(nextInput) {
      markSentInput = nextInput;

      if (options.markSentError !== undefined) {
        throw options.markSentError;
      }

      if (options.error !== undefined) {
        throw options.error;
      }

      return options.sentInvoice ?? createApprovedInvoiceView({ status: 'sent' });
    },
    async prepareApprovedInvoiceEmailDryRun(nextInput) {
      emailInput = nextInput;

      if (options.emailError !== undefined) {
        throw options.emailError;
      }

      if (options.error !== undefined) {
        throw options.error;
      }

      return options.email ?? createApprovedInvoiceEmailPreview();
    },
    async sendApprovedInvoiceEmailDryRun(nextInput) {
      emailSendInput = nextInput;

      if (options.emailSendError !== undefined) {
        throw options.emailSendError;
      }

      if (options.error !== undefined) {
        throw options.error;
      }

      return options.emailDelivery ?? createApprovedInvoiceEmailDryRunSendResult();
    },
    async prepareApprovedInvoiceEmailSmtpTest(nextInput) {
      emailSmtpTestPreparationInput = nextInput;

      return {
        attachment: { fileName: 'invoice.pdf', sizeBytes: 2048 },
        attemptId: 'attempt-1',
        authorizationToken: 'one-time-authorization',
        expiresAt: '2026-07-16T10:01:00.000Z',
        invoiceId: nextInput.invoiceId,
        subject: nextInput.subject,
        testRecipient: 'owner-test@example.fi',
      };
    },
    async prepareApprovedInvoiceEmailSmtp(nextInput) {
      emailSmtpPreparationInput = nextInput;

      if (options.emailSmtpPreparationError !== undefined) {
        throw options.emailSmtpPreparationError;
      }

      return {
        attachment: { fileName: 'invoice.pdf', sizeBytes: 2048 },
        attemptId: 'attempt-1',
        authorizationToken: 'one-time-authorization',
        body: nextInput.body,
        cc: nextInput.cc ?? '',
        expiresAt: '2026-07-17T22:01:00.000Z',
        invoiceId: nextInput.invoiceId,
        invoiceNumber: '20260001',
        recipient: nextInput.to,
        resend: false,
        sender: 'Example Oy <billing@example.fi>',
        subject: nextInput.subject,
      };
    },
    async sendApprovedInvoiceEmailSmtp(nextInput) {
      emailSmtpInput = nextInput;

      if (options.emailSendError !== undefined) {
        throw options.emailSendError;
      }

      return options.emailSmtpDelivery ?? createApprovedInvoiceEmailSmtpSendResult();
    },
    async sendApprovedInvoiceEmailSmtpTest(nextInput) {
      emailSmtpTestInput = nextInput;

      if (options.emailSendError !== undefined) {
        throw options.emailSendError;
      }

      return (
        options.emailSmtpTestDelivery ??
        createApprovedInvoiceEmailSmtpTestSendResult()
      );
    },
  });

  const app = new Hono<BackendEnvironment>();
  app.use('*', async (context, next) => {
    context.set(
      'actorContext',
      createActorContext({
        actorId: 'dev-user',
        authenticationMode: 'local',
        companyId: 'dev-company',
        permissions: [
          'manageCompanyEmailSettings',
          'manageCompanyEmailSecret',
          'sendInvoices',
        ],
      }),
    );
    await next();
  });
  app.route('/', routes);

  return {
    app,
    getEmailInput: () => emailInput,
    getEmailSendInput: () => emailSendInput,
    getEmailSmtpTestPreparationInput: () => emailSmtpTestPreparationInput,
    getEmailSmtpTestInput: () => emailSmtpTestInput,
    getEmailSmtpPreparationInput: () => emailSmtpPreparationInput,
    getEmailSmtpInput: () => emailSmtpInput,
    getDeliveryEventsInput: () => deliveryEventsInput,
    getMarkSentInput: () => markSentInput,
  };
}

function createApprovedInvoiceEmailDryRunSendResult(): SendApprovedInvoiceEmailDryRunResult {
  return {
    deliveryEventId: 'delivery-event-1',
    email: {
      attachment: {
        documentId: 'document-1',
        fileName: 'lasku-20260001.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 8,
      },
      body: 'Hei,\n\nTässä muokattu viesti.',
      cc: 'copy@example.fi',
      invoiceId: 'invoice-1',
      invoiceNumber: '20260001',
      provider: 'dryRun',
      subject: 'Muokattu laskuotsikko',
      to: 'recipient@example.fi',
    },
    providerResult: {
      provider: 'dryRun',
      providerMessageId: null,
    },
  };
}

function createApprovedInvoiceEmailSmtpTestSendResult(): SendApprovedInvoiceEmailSmtpTestResult {
  return {
    deliveredTo: 'owner-test@example.fi',
    deliveryEventId: 'delivery-event-2',
    provider: 'smtp',
    providerMessageId: '<synthetic@example.test>',
    testMode: true,
  };
}

function createApprovedInvoiceEmailSmtpSendResult(): SendApprovedInvoiceEmailSmtpResult {
  return {
    deliveredCc: 'copy@example.fi',
    deliveredTo: 'customer@example.fi',
    deliveryEventId: 'delivery-event-1',
    invoice: createApprovedInvoiceView({ status: 'sent' }),
    provider: 'smtp',
    providerMessageId: '<message@example.fi>',
    resend: false,
    testMode: false,
  };
}

function createApprovedInvoiceEmailPreview(): ApprovedInvoiceEmailPreview {
  return {
    attachment: {
      documentId: 'document-1',
      fileName: 'lasku-20260001.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 8,
    },
    body: 'Hei,\n\nLiitteenä lasku 20260001.',
    invoiceId: 'invoice-1',
    invoiceNumber: '20260001',
    provider: 'dryRun',
    subject: 'Lasku 20260001',
    to: 'recipient@example.fi',
  };
}

function createApprovedInvoiceView(
  overrides: Partial<ApprovedInvoiceView> = {},
): ApprovedInvoiceView {
  return {
    id: 'invoice-1',
    companyId: 'dev-company',
    sourceDraftId: 'draft-1',
    invoiceKind: 'standard',
    creditedInvoiceId: null,
    creditedInvoiceNumber: null,
    creditedInvoiceDate: null,
    invoiceNumber: '20260001',
    referenceNumber: '202600017',
    referenceNumberType: 'finnishDomestic',
    seriesKey: 'default',
    sequenceScope: 'calendar-year:2026',
    sequenceNumber: 1,
    numberingMode: 'calendarYearSequence',
    status: 'approved',
    customerId: 'customer-1',
    customerNumberSnapshot: '1001',
    customerNameSnapshot: 'Example Customer Oy',
    customerBusinessIdSnapshot: '1234567-8',
    customerTypeSnapshot: 'company',
    customerEmailSnapshot: 'customer@example.fi',
    customerPhoneSnapshot: '040 111 2222',
    customerStreetAddressSnapshot: 'Customer Street 1',
    customerPostalCodeSnapshot: '00100',
    customerCitySnapshot: 'Helsinki',
    companyNameSnapshot: 'Example Builder Oy',
    companyBusinessIdSnapshot: '7654321-0',
    companyVatNumberSnapshot: 'FI76543210',
    companyStreetAddressSnapshot: 'Builder Street 2',
    companyPostalCodeSnapshot: '33100',
    companyCitySnapshot: 'Tampere',
    companyEmailSnapshot: 'billing@example.fi',
    companyPhoneSnapshot: '03 123 4567',
    companyWebsiteSnapshot: 'www.example-builder.fi',
    companyIbanSnapshot: 'FI2112345600000785',
    companyBicSnapshot: 'NDEAFIHH',
    companyBankNameSnapshot: 'Example Bank',
    billingRecipientCustomerId: 'billing-1',
    billingRecipientCustomerNumberSnapshot: '2001',
    billingRecipientNameSnapshot: 'Billing Recipient Oy',
    billingRecipientBusinessIdSnapshot: '8765432-1',
    billingRecipientCustomerTypeSnapshot: 'propertyManager',
    billingRecipientEmailSnapshot: 'recipient@example.fi',
    billingRecipientPhoneSnapshot: '040 333 4444',
    billingRecipientStreetAddressSnapshot: 'Recipient Street 3',
    billingRecipientPostalCodeSnapshot: '02100',
    billingRecipientCitySnapshot: 'Espoo',
    invoiceDate: '2026-06-13',
    dueDate: '2026-06-27',
    paymentTermDays: 14,
    reminderPeriodDays: 8,
    latePaymentInterestBasisPoints: 950,
    priceInputMode: 'net',
    refundIbanSnapshot: '',
    subject: 'Test invoice',
    orderNumber: 'ORDER-1',
    note: 'Invoice note',
    deliveryAddressText: 'Worksite Street 4',
    lines: [
      {
        id: 'line-1',
        sourceInvoiceLineId: null,
        lineOrder: 1,
        code: 'WORK',
        description: 'Work',
        quantityHundredths: 100,
        unit: 'h',
        unitPriceCents: 10000,
        vatRateBasisPoints: 2550,
        discount: { type: 'none' },
        baseCents: 10000,
        discountCents: 0,
        netCents: 10000,
        vatCents: 2550,
        grossCents: 12550,
      },
    ],
    totals: {
      netTotalCents: 10000,
      vatTotalCents: 2550,
      grossTotalCents: 12550,
      vatBreakdown: [
        {
          vatRateBasisPoints: 2550,
          netCents: 10000,
          vatCents: 2550,
          grossCents: 12550,
        },
      ],
    },
    vatBreakdown: [
      {
        vatRateBasisPoints: 2550,
        netCents: 10000,
        vatCents: 2550,
        grossCents: 12550,
      },
    ],
    createdAt: '2026-06-13T10:00:00.000Z',
    approvedAt: '2026-06-13T10:00:00.000Z',
    updatedAt: '2026-06-13T10:00:00.000Z',
    cancelledAt: null,
    cancelledBy: null,
    cancellationReason: null,
    ...overrides,
  };
}
