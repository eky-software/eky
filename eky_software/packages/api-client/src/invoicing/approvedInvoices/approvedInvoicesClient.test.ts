import { describe, expect, it } from 'vitest';

import {
  createEkyApiClient,
  EkyApiError,
  type ApprovedInvoiceEmailDryRunSendInput,
  type ApprovedInvoiceEmailDryRunSendResult,
  type ApprovedInvoiceEmailSmtpSendResult,
  type ApprovedInvoiceEmailSmtpTestSendResult,
  type ApprovedInvoiceEmailPreview,
  type ApprovedInvoiceListQuery,
  type ApprovedInvoiceSummary,
  type ApprovedInvoiceView,
  type InvoiceDraft,
  type InvoiceCreditContext,
} from '../../index.js';

describe('approved invoices api client', () => {
  it('lists approved invoices through GET /invoices', async () => {
    const requests = createRequestLog();
    const invoiceSummary = createTestApprovedInvoiceSummary();
    const invoicePage = {
      invoices: [invoiceSummary],
      page: 2,
      pageSize: 20,
      totalCount: 23,
      totalPages: 2,
    } as const;
    const client = createTestClient(requests, { invoicePage });

    const result = await client.listApprovedInvoices({
      dateFrom: '2026-06-01',
      dateTo: '2026-06-30',
      page: 2,
      pageSize: 20,
      sort: 'customerNameAsc',
      status: 'approved',
    });

    expect(result).toEqual(invoicePage);
    expect(requests).toEqual([
      {
        input:
          '/invoices?status=approved&page=2&pageSize=20&sort=customerNameAsc&dateFrom=2026-06-01&dateTo=2026-06-30',
        init: {
          headers: {
            Accept: 'application/json',
          },
        },
      },
    ]);
  });

  it('lists sent invoice groups through the dedicated root-paginated route', async () => {
    const requests = createRequestLog();
    const rootInvoice = createTestApprovedInvoiceSummary({
      status: 'sent',
    });
    const creditInvoice = createTestApprovedInvoiceSummary({
      id: 'credit-invoice-1',
      invoiceKind: 'credit',
      creditedInvoiceId: rootInvoice.id,
      invoiceNumber: '20260002',
      referenceNumber: '',
      status: 'sent',
      grossTotalCents: 2_550,
    });
    const invoiceGroupPage = {
      groups: [
        {
          rootInvoice,
          creditInvoices: [creditInvoice],
          creditStatus: 'partial',
          remainingCreditableGrossCents: 10_000,
        },
      ],
      page: 1,
      pageSize: 20,
      totalCount: 1,
      totalPages: 1,
    } as const;
    const client = createTestClient(requests, { invoiceGroupPage });

    await expect(
      client.listSentInvoiceGroups({
        dateFrom: '2026-01-01',
        page: 1,
        pageSize: 20,
        sort: 'invoiceDateDesc',
      }),
    ).resolves.toEqual(invoiceGroupPage);
    expect(requests[0]?.input).toBe(
      '/sent-invoice-groups?page=1&pageSize=20&sort=invoiceDateDesc&dateFrom=2026-01-01',
    );
    expect(requests[0]?.input).not.toContain('status=');
    expect(requests[0]?.input).not.toContain('companyId=');
  });

  it('rejects inconsistent sent invoice group relationships', async () => {
    const requests = createRequestLog();
    const rootInvoice = createTestApprovedInvoiceSummary({ status: 'sent' });
    const client = createTestClient(requests, {
      invoiceGroupPage: {
        groups: [
          {
            rootInvoice,
            creditInvoices: [
              createTestApprovedInvoiceSummary({
                id: 'credit-invoice-1',
                invoiceKind: 'credit',
                creditedInvoiceId: 'other-invoice',
                status: 'sent',
              }),
            ],
            creditStatus: 'full',
            remainingCreditableGrossCents: 0,
          },
        ],
        page: 1,
        pageSize: 20,
        totalCount: 1,
        totalPages: 1,
      },
    });

    await expect(
      client.listSentInvoiceGroups({
        page: 1,
        pageSize: 20,
        sort: 'invoiceDateDesc',
      }),
    ).rejects.toBeInstanceOf(EkyApiError);
  });

  it('gets the validated credit context through GET /invoices/:id/credit-context', async () => {
    const requests = createRequestLog();
    const creditContext: InvoiceCreditContext = {
      sourceInvoiceId: 'invoice-1',
      creditInvoices: [
        createTestApprovedInvoiceSummary({
          id: 'credit-invoice-1',
          invoiceKind: 'credit',
          creditedInvoiceId: 'invoice-1',
          invoiceNumber: '20260002',
          referenceNumber: '',
          status: 'approved',
          grossTotalCents: 2_550,
        }),
      ],
      creditStatus: 'partial',
      remainingCreditableGrossCents: 10_000,
      activeCreditDraftId: 'credit-draft-2',
    };
    const client = createTestClient(requests, { creditContext });

    await expect(
      client.getInvoiceCreditContext('invoice/1'),
    ).resolves.toEqual(creditContext);
    expect(requests[0]?.input).toBe(
      '/invoices/invoice%2F1/credit-context',
    );
    expect(requests[0]?.init?.method).toBeUndefined();
  });

  it('rejects credit context relationships that point to another invoice', async () => {
    const requests = createRequestLog();
    const client = createTestClient(requests, {
      creditContext: {
        sourceInvoiceId: 'invoice-1',
        creditInvoices: [
          createTestApprovedInvoiceSummary({
            invoiceKind: 'credit',
            creditedInvoiceId: 'invoice-2',
            status: 'approved',
          }),
        ],
        creditStatus: 'partial',
        remainingCreditableGrossCents: 1,
        activeCreditDraftId: null,
      },
    });

    await expect(
      client.getInvoiceCreditContext('invoice-1'),
    ).rejects.toBeInstanceOf(EkyApiError);
  });

  it('gets an approved invoice through GET /invoices/:id', async () => {
    const requests = createRequestLog();
    const invoice = createTestApprovedInvoiceView();
    const client = createTestClient(requests, { invoice });

    const result = await client.getApprovedInvoice('invoice/1');

    expect(result).toEqual(invoice);
    expect(requests).toEqual([
      {
        input: '/invoices/invoice%2F1',
        init: {
          headers: {
            Accept: 'application/json',
          },
        },
      },
    ]);
  });

  it('accepts package and short custom units in approved invoice responses', async () => {
    const requests = createRequestLog();
    const invoice = {
      ...createTestApprovedInvoiceView(),
      lines: [
        { ...createTestApprovedInvoiceView().lines[0], unit: 'pak' },
        {
          ...createTestApprovedInvoiceView().lines[0],
          id: 'line-2',
          unit: 'ltk',
        },
      ],
    };
    const client = createTestClient(requests, { invoice });

    const result = await client.getApprovedInvoice('invoice-1');

    expect(result.lines.map((line) => line.unit)).toEqual(['pak', 'ltk']);
  });

  it('creates approved invoice PDF metadata through POST /invoices/:id/pdf', async () => {
    const requests = createRequestLog();
    const document = createTestApprovedInvoiceDocumentMetadata();
    const client = createTestClient(requests, { document });

    const result = await client.createApprovedInvoicePdf('invoice/1');

    expect(result).toEqual(document);
    expect(requests).toEqual([
      {
        input: '/invoices/invoice%2F1/pdf',
        init: {
          headers: {
            Accept: 'application/json',
          },
          method: 'POST',
        },
      },
    ]);
  });

  it('gets approved invoice PDF metadata through GET /invoices/:id/pdf/metadata', async () => {
    const requests = createRequestLog();
    const document = createTestApprovedInvoiceDocumentMetadata();
    const client = createTestClient(requests, { document });

    const result = await client.getApprovedInvoicePdfMetadata('invoice/1');

    expect(result).toEqual(document);
    expect(requests).toEqual([
      {
        input: '/invoices/invoice%2F1/pdf/metadata',
        init: {
          headers: {
            Accept: 'application/json',
          },
        },
      },
    ]);
  });


  it('builds the approved invoice PDF URL without fetching the binary document', () => {
    const requests = createRequestLog();
    const client = createTestClient(requests, {});

    expect(client.getApprovedInvoicePdfUrl('invoice/1')).toBe(
      'http://api.test/invoices/invoice%2F1/pdf',
    );
    expect(requests).toEqual([]);
  });

  it('reopens an approved invoice for editing through POST /invoices/:id/reopen-for-edit', async () => {
    const requests = createRequestLog();
    const reopenedInvoice = {
      invoiceDraftId: 'draft-1',
      invoiceId: 'invoice-1',
    };
    const client = createTestClient(requests, reopenedInvoice);

    const result = await client.reopenApprovedInvoiceForEditing('invoice/1');

    expect(result).toEqual(reopenedInvoice);
    expect(requests).toEqual([
      {
        input: '/invoices/invoice%2F1/reopen-for-edit',
        init: {
          headers: {
            Accept: 'application/json',
          },
          method: 'POST',
        },
      },
    ]);
  });

  it('cancels an approved invoice through POST /invoices/:id/cancel', async () => {
    const requests = createRequestLog();
    const cancellation = {
      cancellationReason: 'Duplicate invoice',
      cancelledAt: '2026-07-23T18:00:00.000Z',
      cancelledBy: 'local-owner',
      invoiceId: 'invoice-1',
      invoiceKind: 'standard',
      invoiceNumber: '20260001',
      status: 'cancelled',
    } as const;
    const client = createTestClient(requests, { cancellation });

    const result = await client.cancelApprovedInvoice('invoice/1', {
      cancellationReason: 'Duplicate invoice',
      confirmationInvoiceNumber: '20260001',
    });

    expect(result).toEqual(cancellation);
    expect(requests).toEqual([
      {
        input: '/invoices/invoice%2F1/cancel',
        init: {
          body: JSON.stringify({
            cancellationReason: 'Duplicate invoice',
            confirmationInvoiceNumber: '20260001',
          }),
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
          },
          method: 'POST',
        },
      },
    ]);
  });

  it('does not send server-owned fields in invoice cancellation requests', async () => {
    const requests = createRequestLog();
    const client = createTestClient(requests, {
      cancellation: {
        cancellationReason: 'Duplicate invoice',
        cancelledAt: '2026-07-23T18:00:00.000Z',
        cancelledBy: 'local-owner',
        invoiceId: 'invoice-1',
        invoiceKind: 'standard',
        invoiceNumber: '20260001',
        status: 'cancelled',
      },
    });

    await client.cancelApprovedInvoice('invoice-1', {
      cancellationReason: 'Duplicate invoice',
      cancelledAt: 'client-time',
      cancelledBy: 'other-user',
      companyId: 'other-company',
      confirmationInvoiceNumber: '20260001',
      status: 'cancelled',
    } as never);

    expect(JSON.parse(String(requests[0]?.init?.body))).toEqual({
      cancellationReason: 'Duplicate invoice',
      confirmationInvoiceNumber: '20260001',
    });
  });

  it('marks an approved invoice sent through POST /invoices/:id/mark-sent', async () => {
    const requests = createRequestLog();
    const invoice = createTestApprovedInvoiceView({ status: 'sent' });
    const client = createTestClient(requests, { invoice });

    const result = await client.markApprovedInvoiceSent('invoice/1', 'print');

    expect(result).toEqual(invoice);
    expect(requests).toEqual([
      {
        input: '/invoices/invoice%2F1/mark-sent',
        init: {
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ deliveryMethod: 'print' }),
          method: 'POST',
        },
      },
    ]);
  });

  it('lists safe delivery history through GET /invoices/:id/delivery-events', async () => {
    const requests = createRequestLog();
    const events = [
      {
        ccEmail: '',
        createdAt: '2026-07-20T20:00:00.000Z',
        deliveryMethod: 'print',
        id: 'event-1',
        provider: 'manual',
        providerMessageId: '<must-not-be-forwarded@example.fi>',
        recipientEmail: '',
        safeErrorMessage: null,
        technicalErrorCode: 'must-not-be-forwarded',
        status: 'succeeded',
      },
    ];
    const client = createTestClient(requests, { events });

    await expect(
      client.listInvoiceDeliveryEvents('invoice/1'),
    ).resolves.toEqual([
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
    ]);
    expect(requests).toEqual([
      {
        input: '/invoices/invoice%2F1/delivery-events',
        init: {
          headers: { Accept: 'application/json' },
        },
      },
    ]);
  });

  it('prepares a dry-run invoice email through POST /invoices/:id/email/dry-run', async () => {
    const requests = createRequestLog();
    const email = createTestApprovedInvoiceEmailPreview();
    const client = createTestClient(requests, { email });

    const result = await client.prepareApprovedInvoiceEmailDryRun('invoice/1');

    expect(result).toEqual(email);
    expect(requests).toEqual([
      {
        input: '/invoices/invoice%2F1/email/dry-run',
        init: {
          headers: {
            Accept: 'application/json',
          },
          method: 'POST',
        },
      },
    ]);
  });

  it('sends a dry-run invoice email through POST /invoices/:id/email/dry-run/send', async () => {
    const requests = createRequestLog();
    const delivery = createTestApprovedInvoiceEmailDryRunSendResult();
    const input: ApprovedInvoiceEmailDryRunSendInput = {
      body: 'Hei,\n\nMuokattu viesti.',
      cc: 'copy@example.fi',
      subject: 'Lasku 20260001 - muokattu',
      to: 'recipient@example.fi',
    };
    const client = createTestClient(requests, { delivery });

    const result = await client.sendApprovedInvoiceEmailDryRun(
      'invoice/1',
      input,
    );

    expect(result).toEqual(delivery);
    expect(requests[0]).toEqual(
      {
        input: '/invoices/invoice%2F1/email/dry-run/send',
        init: {
          body: expect.any(String) as string,
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
          },
          method: 'POST',
        },
      },
    );
    expect(JSON.parse(String(requests[0]?.init?.body))).toEqual(input);
  });

  it('does not send server-owned fields in dry-run invoice email requests', async () => {
    const requests = createRequestLog();
    const delivery = createTestApprovedInvoiceEmailDryRunSendResult();
    const client = createTestClient(requests, { delivery });
    const unsafeInput = {
      body: 'Hei',
      companyId: 'other-company',
      deliveryEventId: 'event-from-client',
      providerResult: { provider: 'smtp' },
      status: 'succeeded',
      subject: 'Lasku',
      to: 'recipient@example.fi',
    } as unknown as ApprovedInvoiceEmailDryRunSendInput;

    await client.sendApprovedInvoiceEmailDryRun('invoice-1', unsafeInput);

    expect(JSON.parse(String(requests[0]?.init?.body))).toEqual({
      body: 'Hei',
      subject: 'Lasku',
      to: 'recipient@example.fi',
    });
  });

  it('sends a controlled SMTP test request without server-owned fields', async () => {
    const requests = createRequestLog();
    const delivery = createTestApprovedInvoiceEmailSmtpTestSendResult();
    const client = createTestClient(requests, { delivery });

    const result = await client.sendApprovedInvoiceEmailSmtpTest(
      'invoice/1',
      {
        attemptId: 'attempt-1',
        authorizationToken: 'one-time-authorization',
        body: 'Hei, liitteenä lasku.',
        cc: 'copy@example.fi',
        subject: 'Lasku 20260001',
        to: 'customer@example.fi',
      },
    );

    expect(result).toEqual(delivery);
    expect(requests[0]).toEqual({
      input: '/invoices/invoice%2F1/email/smtp-test/send',
      init: {
        body: expect.any(String) as string,
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        method: 'POST',
      },
    });
    expect(JSON.parse(String(requests[0]?.init?.body))).toEqual({
      attemptId: 'attempt-1',
      authorizationToken: 'one-time-authorization',
      body: 'Hei, liitteenä lasku.',
      cc: 'copy@example.fi',
      subject: 'Lasku 20260001',
      to: 'customer@example.fi',
    });
  });

  it('prepares a controlled SMTP test without sending server-owned fields', async () => {
    const requests = createRequestLog();
    const preparation = {
      attachment: { fileName: 'invoice.pdf', sizeBytes: 2048 },
      attemptId: 'attempt-1',
      authorizationToken: 'one-time-authorization',
      expiresAt: '2026-07-16T10:01:00.000Z',
      invoiceId: 'invoice-1',
      subject: 'Lasku 20260001',
      testRecipient: 'safe-test@example.fi',
    };
    const client = createTestClient(requests, { preparation });

    const result = await client.prepareApprovedInvoiceEmailSmtpTest(
      'invoice/1',
      {
        body: 'Hei, liitteenä lasku.',
        cc: 'copy@example.fi',
        subject: 'Lasku 20260001',
        to: 'customer@example.fi',
      },
    );

    expect(result).toEqual(preparation);
    expect(requests[0]).toEqual({
      input: '/invoices/invoice%2F1/email/smtp-test/prepare',
      init: {
        body: expect.any(String) as string,
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        method: 'POST',
      },
    });
    expect(JSON.parse(String(requests[0]?.init?.body))).toEqual({
      body: 'Hei, liitteenä lasku.',
      cc: 'copy@example.fi',
      subject: 'Lasku 20260001',
      to: 'customer@example.fi',
    });
  });

  it('prepares and sends a customer SMTP delivery through exact endpoints', async () => {
    const preparation = {
      attachment: { fileName: 'invoice.pdf', sizeBytes: 2048 },
      attemptId: 'attempt-1',
      authorizationToken: 'one-time-authorization',
      body: 'Hei, liitteenä lasku.',
      cc: 'copy@example.fi',
      expiresAt: '2026-07-17T22:01:00.000Z',
      invoiceId: 'invoice-1',
      invoiceNumber: '20260001',
      recipient: 'customer@example.fi',
      resend: false,
      sender: 'Example Oy <billing@example.fi>',
      subject: 'Lasku 20260001',
    };
    const prepareRequests = createRequestLog();
    const prepareClient = createTestClient(prepareRequests, { preparation });
    const emailFields = {
      body: 'Hei, liitteenä lasku.',
      cc: 'copy@example.fi',
      subject: 'Lasku 20260001',
      to: 'customer@example.fi',
    };

    await expect(
      prepareClient.prepareApprovedInvoiceEmailSmtp('invoice/1', emailFields),
    ).resolves.toEqual(preparation);
    expect(prepareRequests[0]?.input).toBe(
      '/invoices/invoice%2F1/email/smtp/prepare',
    );
    expect(JSON.parse(String(prepareRequests[0]?.init?.body))).toEqual(
      emailFields,
    );

    const delivery = createTestApprovedInvoiceEmailSmtpSendResult();
    const sendRequests = createRequestLog();
    const sendClient = createTestClient(sendRequests, { delivery });

    await expect(
      sendClient.sendApprovedInvoiceEmailSmtp('invoice/1', {
        ...emailFields,
        attemptId: preparation.attemptId,
        authorizationToken: preparation.authorizationToken,
      }),
    ).resolves.toEqual(delivery);
    expect(sendRequests[0]?.input).toBe(
      '/invoices/invoice%2F1/email/smtp/send',
    );
    expect(JSON.parse(String(sendRequests[0]?.init?.body))).toEqual({
      ...emailFields,
      attemptId: 'attempt-1',
      authorizationToken: 'one-time-authorization',
    });
  });

  it('strips server-owned fields from customer SMTP requests', async () => {
    const requests = createRequestLog();
    const client = createTestClient(requests, {
      preparation: {
        attachment: { fileName: 'invoice.pdf', sizeBytes: 2048 },
        attemptId: 'attempt-1',
        authorizationToken: 'one-time-authorization',
        body: 'Hei',
        cc: '',
        expiresAt: '2026-07-17T22:01:00.000Z',
        invoiceId: 'invoice-1',
        invoiceNumber: '20260001',
        recipient: 'customer@example.fi',
        resend: false,
        sender: 'Example Oy <billing@example.fi>',
        subject: 'Lasku 20260001',
      },
    });

    await client.prepareApprovedInvoiceEmailSmtp('invoice-1', {
      body: 'Hei',
      companyId: 'other-company',
      invoiceId: 'other-invoice',
      status: 'sent',
      subject: 'Lasku',
      to: 'customer@example.fi',
    } as never);

    expect(JSON.parse(String(requests[0]?.init?.body))).toEqual({
      body: 'Hei',
      subject: 'Lasku',
      to: 'customer@example.fi',
    });
  });

  it('copies an approved invoice to a draft through POST /invoices/:id/copy-to-draft', async () => {
    const requests = createRequestLog();
    const invoiceDraft = createTestInvoiceDraft();
    const client = createTestClient(requests, { invoiceDraft });

    const result = await client.copyApprovedInvoiceToDraft('invoice/1');

    expect(result).toEqual(invoiceDraft);
    expect(requests).toEqual([
      {
        input: '/invoices/invoice%2F1/copy-to-draft',
        init: {
          headers: {
            Accept: 'application/json',
          },
          method: 'POST',
        },
      },
    ]);
  });

  it('rejects a missing invoice response object', async () => {
    const requests = createRequestLog();
    const client = createTestClient(requests, {});

    await expect(
      client.getApprovedInvoice('invoice-1'),
    ).rejects.toBeInstanceOf(EkyApiError);
  });

  it('rejects a missing approved invoice list response array', async () => {
    const requests = createRequestLog();
    const client = createTestClient(requests, {});

    await expect(
      client.listApprovedInvoices(createApprovedInvoiceListQuery()),
    ).rejects.toBeInstanceOf(EkyApiError);
  });

  it('rejects malformed approved invoice pagination metadata', async () => {
    const requests = createRequestLog();
    const client = createTestClient(requests, {
      invoicePage: {
        invoices: [],
        page: 1,
        pageSize: 25,
        totalCount: 0,
        totalPages: 0,
      },
    });

    await expect(
      client.listApprovedInvoices(createApprovedInvoiceListQuery()),
    ).rejects.toBeInstanceOf(EkyApiError);
  });

  it('rejects a malformed reopen response', async () => {
    const requests = createRequestLog();
    const client = createTestClient(requests, { invoiceId: 'invoice-1' });

    await expect(
      client.reopenApprovedInvoiceForEditing('invoice-1'),
    ).rejects.toBeInstanceOf(EkyApiError);
  });

  it('rejects a malformed cancellation response', async () => {
    const requests = createRequestLog();
    const client = createTestClient(requests, {
      cancellation: {
        cancellationReason: 'Duplicate invoice',
        cancelledAt: '2026-07-23T18:00:00.000Z',
        cancelledBy: 'local-owner',
        invoiceId: 'invoice-1',
        invoiceKind: 'standard',
        invoiceNumber: '20260001',
        status: 'approved',
      },
    });

    await expect(
      client.cancelApprovedInvoice('invoice-1', {
        cancellationReason: 'Duplicate invoice',
        confirmationInvoiceNumber: '20260001',
      }),
    ).rejects.toBeInstanceOf(EkyApiError);
  });

  it('rejects a malformed approved invoice PDF metadata response', async () => {
    const requests = createRequestLog();
    const client = createTestClient(requests, {
      document: {
        ...createTestApprovedInvoiceDocumentMetadata(),
        mimeType: 'application/json',
      },
    });

    await expect(
      client.createApprovedInvoicePdf('invoice-1'),
    ).rejects.toBeInstanceOf(EkyApiError);
  });

  it('rejects a malformed dry-run email response', async () => {
    const requests = createRequestLog();
    const client = createTestClient(requests, {
      email: {
        ...createTestApprovedInvoiceEmailPreview(),
        provider: 'smtp',
      },
    });

    await expect(
      client.prepareApprovedInvoiceEmailDryRun('invoice-1'),
    ).rejects.toBeInstanceOf(EkyApiError);
  });

  it('rejects a malformed dry-run email send response', async () => {
    const requests = createRequestLog();
    const client = createTestClient(requests, {
      delivery: {
        ...createTestApprovedInvoiceEmailDryRunSendResult(),
        providerResult: { provider: 'smtp', providerMessageId: null },
      },
    });

    await expect(
      client.sendApprovedInvoiceEmailDryRun('invoice-1', {
        body: 'Hei',
        subject: 'Lasku',
        to: 'recipient@example.fi',
      }),
    ).rejects.toBeInstanceOf(EkyApiError);
  });

  it('rejects invalid enum values in the response', async () => {
    await expectInvalidInvoiceResponse({ status: 'draft' });
    await expectInvalidInvoiceResponse({ priceInputMode: 'withVatMaybe' });
    await expectInvalidInvoiceResponse({ referenceNumberType: 'international' });
    await expectInvalidInvoiceResponse({
      lines: [
        {
          ...createTestApprovedInvoiceView().lines[0],
          unit: 'bad unit',
        },
      ],
    });
    await expectInvalidInvoiceResponse({
      lines: [
        {
          ...createTestApprovedInvoiceView().lines[0],
          discount: { type: 'mystery' },
        },
      ],
    });
  });

  it('rejects non-integer money and total values', async () => {
    await expectInvalidInvoiceResponse({
      totals: {
        ...createTestApprovedInvoiceView().totals,
        grossTotalCents: 12550.5,
      },
    });
    await expectInvalidInvoiceResponse({
      lines: [
        {
          ...createTestApprovedInvoiceView().lines[0],
          netCents: '10000',
        },
      ],
    });
  });

  it('allows a nullable billing recipient customer id', async () => {
    const requests = createRequestLog();
    const invoice = {
      ...createTestApprovedInvoiceView(),
      billingRecipientCustomerId: null,
    };
    const client = createTestClient(requests, { invoice });

    await expect(
      client.getApprovedInvoice('invoice-1'),
    ).resolves.toMatchObject({
      billingRecipientCustomerId: null,
    });
  });

  it('preserves a controlled API error from the backend', async () => {
    const requests = createRequestLog();
    const responseBody = { error: 'Approved invoice was not found.' };
    const client = createTestClient(requests, responseBody, 404);

    await expect(client.getApprovedInvoice('missing')).rejects.toMatchObject({
      message: 'Approved invoice was not found.',
      name: 'EkyApiError',
      responseBody,
      status: 404,
    });
  });
});

async function expectInvalidInvoiceResponse(
  invoiceOverrides: Record<string, unknown>,
): Promise<void> {
  const requests = createRequestLog();
  const invoice = {
    ...createTestApprovedInvoiceView(),
    ...invoiceOverrides,
  } as Record<string, unknown>;
  const client = createTestClient(requests, { invoice });

  await expect(
    client.getApprovedInvoice('invoice-1'),
  ).rejects.toBeInstanceOf(EkyApiError);
}

interface RecordedRequest {
  input: string;
  init: RequestInit | undefined;
}

function createRequestLog(): RecordedRequest[] {
  return [];
}

function createTestClient(
  requests: RecordedRequest[],
  responseBody: unknown,
  status = 200,
) {
  return createEkyApiClient({
    baseUrl: 'http://api.test',
    fetch: async (input, init) => {
      const path =
        typeof input === 'string'
          ? input.replace('http://api.test', '')
          : input instanceof URL
            ? input.href.replace('http://api.test', '')
            : input.url.replace('http://api.test', '');

      requests.push({ input: path, init });

      return new Response(JSON.stringify(responseBody), {
        headers: { 'Content-Type': 'application/json' },
        status,
      });
    },
  });
}

function createTestApprovedInvoiceView(
  overrides: Partial<ApprovedInvoiceView> = {},
): ApprovedInvoiceView {
  return {
    id: 'invoice-1',
    invoiceKind: 'standard',
    creditedInvoiceId: null,
    creditedInvoiceNumber: null,
    creditedInvoiceDate: null,
    companyId: 'dev-company',
    sourceDraftId: 'draft-1',
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
    companyWebsiteSnapshot: 'www.example.fi',
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
    subject: 'Test invoice',
    orderNumber: 'ORDER-1',
    note: 'Invoice note',
    deliveryAddressText: 'Worksite Street 4',
    refundIbanSnapshot: '',
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

function createTestApprovedInvoiceDocumentMetadata() {
  return {
    id: 'document-1',
    companyId: 'dev-company',
    invoiceId: 'invoice-1',
    documentType: 'approved_invoice_pdf',
    fileName: 'lasku-20260001.pdf',
    storagePath: 'dev-company/invoice-1/approved-invoice.pdf',
    mimeType: 'application/pdf',
    sha256:
      '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    sizeBytes: 1234,
    createdAt: '2026-07-05T10:00:00.000Z',
  };
}

function createTestApprovedInvoiceEmailPreview(): ApprovedInvoiceEmailPreview {
  return {
    attachment: {
      documentId: 'document-1',
      fileName: 'lasku-20260001.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1234,
    },
    body: 'Hei,\n\nLiitteenä lasku 20260001.',
    invoiceId: 'invoice-1',
    invoiceNumber: '20260001',
    provider: 'dryRun',
    subject: 'Lasku 20260001',
    to: 'recipient@example.fi',
  };
}

function createTestApprovedInvoiceEmailDryRunSendResult(): ApprovedInvoiceEmailDryRunSendResult {
  return {
    deliveryEventId: 'delivery-event-1',
    email: {
      ...createTestApprovedInvoiceEmailPreview(),
      body: 'Hei,\n\nMuokattu viesti.',
      cc: 'copy@example.fi',
      subject: 'Lasku 20260001 - muokattu',
    },
    providerResult: {
      provider: 'dryRun',
      providerMessageId: null,
    },
  };
}

function createTestApprovedInvoiceEmailSmtpTestSendResult(): ApprovedInvoiceEmailSmtpTestSendResult {
  return {
    deliveredTo: 'owner-test@example.fi',
    deliveryEventId: 'delivery-event-2',
    provider: 'smtp',
    providerMessageId: '<synthetic@example.test>',
    testMode: true,
  };
}

function createTestApprovedInvoiceEmailSmtpSendResult(): ApprovedInvoiceEmailSmtpSendResult {
  return {
    deliveredCc: 'copy@example.fi',
    deliveredTo: 'customer@example.fi',
    deliveryEventId: 'delivery-event-1',
    invoice: createTestApprovedInvoiceView({ status: 'sent' }),
    provider: 'smtp',
    providerMessageId: '<message@example.fi>',
    resend: false,
    testMode: false,
  };
}

function createTestInvoiceDraft(): InvoiceDraft {
  return {
    billingRecipientCustomerId: 'billing-1',
    companyId: 'dev-company',
    createdAt: '2026-07-08T10:00:00.000Z',
    customerId: 'customer-1',
    deliveryAddressText: 'Worksite Street 4',
    dueDate: '2026-07-22',
    id: 'draft-copy-1',
    invoiceDate: '2026-07-08',
    latePaymentInterestBasisPoints: 950,
    lines: [
      {
        baseCents: 10000,
        code: 'WORK',
        description: 'Work',
        discount: { type: 'none' },
        discountCents: 0,
        grossCents: 12550,
        id: 'line-1',
        netCents: 10000,
        position: 1,
        priceInputMode: 'net',
        quantityHundredths: 100,
        unit: 'h',
        unitPriceCents: 10000,
        vatCents: 2550,
        vatRateBasisPoints: 2550,
      },
    ],
    note: 'Invoice note',
    orderNumber: 'ORDER-1',
    paymentTermDays: 14,
    priceInputMode: 'net',
    reminderPeriodDays: 8,
    status: 'draft',
    subject: 'Copied invoice',
    totals: {
      grossTotalCents: 12550,
      netTotalCents: 10000,
      vatBreakdown: [
        {
          grossCents: 12550,
          netCents: 10000,
          vatCents: 2550,
          vatRateBasisPoints: 2550,
        },
      ],
      vatTotalCents: 2550,
    },
    updatedAt: '2026-07-08T10:00:00.000Z',
  };
}

function createTestApprovedInvoiceSummary(
  overrides: Partial<ApprovedInvoiceSummary> = {},
): ApprovedInvoiceSummary {
  return {
    id: 'invoice-1',
    invoiceKind: 'standard',
    creditedInvoiceId: null,
    invoiceNumber: '20260001',
    referenceNumber: '202600017',
    status: 'approved',
    customerId: 'customer-1',
    customerNumberSnapshot: '1001',
    customerNameSnapshot: 'Example Customer Oy',
    billingRecipientNameSnapshot: 'Billing Recipient Oy',
    invoiceDate: '2026-06-13',
    dueDate: '2026-06-27',
    grossTotalCents: 12550,
    approvedAt: '2026-06-13T10:00:00.000Z',
    cancelledAt: null,
    updatedAt: '2026-06-13T10:00:00.000Z',
    ...overrides,
  };
}

function createApprovedInvoiceListQuery(): ApprovedInvoiceListQuery {
  return {
    page: 1,
    pageSize: 20,
    sort: 'invoiceDateDesc',
    status: 'approved',
  };
}
