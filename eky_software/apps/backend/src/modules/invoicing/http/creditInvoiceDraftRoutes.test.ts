import { createActorContext } from '@eky/auth';
import { AuthorizationError } from '@eky/permissions';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import type { BackendEnvironment } from '../../../http/runtimeTrust.js';
import { ApprovedInvoiceNotFoundError } from '../application/approvedInvoiceNotFoundError.js';
import type { ApproveCreditInvoiceDraftInput } from '../application/approveCreditInvoiceDraft.js';
import type { CreateCreditInvoiceDraftInput } from '../application/createCreditInvoiceDraft.js';
import type { CreditInvoiceDraftView } from '../application/creditInvoiceDraftView.js';
import type { GetCreditInvoiceDraftInput } from '../application/getCreditInvoiceDraft.js';
import { InvoiceCreditConflictError } from '../application/invoiceCreditConflictError.js';
import type { UpdateCreditInvoiceDraftInput } from '../application/updateCreditInvoiceDraft.js';
import { InvoiceCreditError } from '../domain/invoiceCreditError.js';
import { createCreditInvoiceDraftRoutes as createRouteHandlers } from './creditInvoiceDraftRoutes.js';

describe('credit invoice draft routes', () => {
  it('creates a credit draft with the trusted actor context and no request data', async () => {
    const { app, getCreateInput } = createTestApp();

    const response = await app.request('/invoices/invoice-1/credit-draft', {
      method: 'POST',
    });

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({
      creditInvoiceDraft: createCreditDraftView(),
    });
    expect(getCreateInput()).toMatchObject({
      actorContext: {
        actorId: 'dev-user',
        companyId: 'dev-company',
      },
      invoiceId: 'invoice-1',
    });
    expect(getCreateInput()?.createdAt).toEqual(expect.any(String));
  });

  it.each([
    { companyId: 'other-company' },
    { netTotalCents: 1 },
    { invoiceKind: 'credit' },
  ])('rejects server-owned create data %#', async (body) => {
    const { app, getCreateInput } = createTestApp();

    const response = await app.request('/invoices/invoice-1/credit-draft', {
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    });

    expect(response.status).toBe(400);
    expect(getCreateInput()).toBeUndefined();
  });

  it('gets a credit draft in the trusted company scope', async () => {
    const { app, getGetInput } = createTestApp();

    const response = await app.request('/invoice-drafts/draft-1/credit');

    expect(response.status).toBe(200);
    expect(getGetInput()).toMatchObject({
      actorContext: { companyId: 'dev-company' },
      invoiceDraftId: 'draft-1',
    });
  });

  it('updates only the editable credit draft fields', async () => {
    const { app, getUpdateInput } = createTestApp();

    const response = await app.request('/invoice-drafts/draft-1/credit', {
      body: JSON.stringify({
        lines: [
          {
            lineType: 'source',
            description: 'Korjattu hyvitysrivi',
            quantityHundredths: 50,
            sourceInvoiceLineId: 'source-line-1',
          },
          {
            lineType: 'manual',
            description: 'Erillinen hyvitys',
            quantityHundredths: 100,
            unit: 'kpl',
            unitPriceCents: 2_500,
            vatRateBasisPoints: 2_550,
          },
        ],
        note: 'Hyvityksen lisätieto',
        refundIban: 'FI2112345600000785',
        subject: 'Osahyvitys',
      }),
      headers: { 'Content-Type': 'application/json' },
      method: 'PUT',
    });

    expect(response.status).toBe(200);
    expect(getUpdateInput()).toEqual({
      actorContext: expect.objectContaining({
        actorId: 'dev-user',
        companyId: 'dev-company',
      }),
      invoiceDraftId: 'draft-1',
      lines: [
        {
          lineType: 'source',
          description: 'Korjattu hyvitysrivi',
          quantityHundredths: 50,
          sourceInvoiceLineId: 'source-line-1',
        },
        {
          lineType: 'manual',
          description: 'Erillinen hyvitys',
          quantityHundredths: 100,
          unit: 'kpl',
          unitPriceCents: 2_500,
          vatRateBasisPoints: 2_550,
        },
      ],
      note: 'Hyvityksen lisätieto',
      refundIban: 'FI2112345600000785',
      subject: 'Osahyvitys',
    });
  });

  it('approves a credit draft with trusted actor data and no request body', async () => {
    const { app, getApproveInput } = createTestApp();

    const response = await app.request(
      '/invoice-drafts/draft-1/approve-credit',
      { method: 'POST' },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      approvedInvoice: {
        draftId: 'draft-1',
        invoiceId: 'credit-invoice-1',
        invoiceNumber: '20260002',
        numberingMode: 'calendarYearSequence',
        sequenceNumber: 2,
        sequenceScope: 'calendar-year:2026',
        status: 'approved',
      },
    });
    expect(getApproveInput()).toMatchObject({
      actorContext: {
        actorId: 'dev-user',
        companyId: 'dev-company',
      },
      draftId: 'draft-1',
      seriesKey: 'default',
    });
    expect(getApproveInput()?.approvedAt).toEqual(expect.any(String));
  });

  it('rejects server-owned credit approval data', async () => {
    const { app, getApproveInput } = createTestApp();

    const response = await app.request(
      '/invoice-drafts/draft-1/approve-credit',
      {
        body: JSON.stringify({
          companyId: 'other-company',
          invoiceNumber: 'attacker-value',
        }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      },
    );

    expect(response.status).toBe(400);
    expect(getApproveInput()).toBeUndefined();
  });

  it.each([
    {
      body: {
        companyId: 'other-company',
        lines: [],
        note: '',
        refundIban: '',
        subject: '',
      },
    },
    {
      body: {
        lines: [
          {
            lineType: 'source',
            description: 'Rivi',
            quantityHundredths: 100,
            sourceInvoiceLineId: 'source-line-1',
            unitPriceCents: 1,
          },
        ],
        note: '',
        refundIban: '',
        subject: '',
      },
    },
    {
      body: '{"lines"',
      raw: true,
    },
  ])('rejects an invalid update request %#', async ({ body, raw }) => {
    const { app, getUpdateInput } = createTestApp();

    const response = await app.request('/invoice-drafts/draft-1/credit', {
      body: raw === true ? String(body) : JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
      method: 'PUT',
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'Invalid credit invoice draft request.',
    });
    expect(getUpdateInput()).toBeUndefined();
  });

  it.each([
    {
      error: new AuthorizationError(),
      expectedMessage: 'Access denied.',
      expectedStatus: 403,
    },
    {
      error: new ApprovedInvoiceNotFoundError(),
      expectedMessage: new ApprovedInvoiceNotFoundError().message,
      expectedStatus: 404,
    },
    {
      error: new InvoiceCreditConflictError(),
      expectedMessage: new InvoiceCreditConflictError().message,
      expectedStatus: 409,
    },
    {
      error: new InvoiceCreditError('Credit quantity exceeds the source line.'),
      expectedMessage: 'Credit quantity exceeds the source line.',
      expectedStatus: 400,
    },
  ])(
    'maps known errors to a safe $expectedStatus response',
    async ({ error, expectedMessage, expectedStatus }) => {
      const { app } = createTestApp({ createError: error });

      const response = await app.request('/invoices/invoice-1/credit-draft', {
        method: 'POST',
      });

      expect(response.status).toBe(expectedStatus);
      const body = (await response.json()) as { error?: unknown };
      expect(body.error).toBe(expectedMessage);
      expect(JSON.stringify(body)).not.toContain('stack');
    },
  );
});

function createTestApp(options: { createError?: Error } = {}) {
  let approveInput: ApproveCreditInvoiceDraftInput | undefined;
  let createInput: CreateCreditInvoiceDraftInput | undefined;
  let getInput: GetCreditInvoiceDraftInput | undefined;
  let updateInput: UpdateCreditInvoiceDraftInput | undefined;
  const draft = createCreditDraftView();
  const app = new Hono<BackendEnvironment>();

  app.use('*', async (context, next) => {
    context.set(
      'actorContext',
      createActorContext({
        actorId: 'dev-user',
        authenticationMode: 'local',
        companyId: 'dev-company',
        permissions: ['manageInvoiceCorrections'],
      }),
    );
    await next();
  });
  app.route(
    '/',
    createRouteHandlers({
      async approveCreditInvoiceDraft(input) {
        approveInput = input;

        return {
          draftId: 'draft-1',
          invoiceId: 'credit-invoice-1',
          invoiceNumber: '20260002',
          numberingMode: 'calendarYearSequence',
          sequenceNumber: 2,
          sequenceScope: 'calendar-year:2026',
          status: 'approved',
        };
      },
      async createCreditInvoiceDraft(input) {
        createInput = input;

        if (options.createError !== undefined) {
          throw options.createError;
        }

        return draft;
      },
      async getCreditInvoiceDraft(input) {
        getInput = input;
        return draft;
      },
      async updateCreditInvoiceDraft(input) {
        updateInput = input;
        return draft;
      },
    }),
  );

  return {
    app,
    getApproveInput: () => approveInput,
    getCreateInput: () => createInput,
    getGetInput: () => getInput,
    getUpdateInput: () => updateInput,
  };
}

function createCreditDraftView(): CreditInvoiceDraftView {
  return {
    id: 'draft-1',
    invoiceKind: 'credit',
    creditedInvoiceId: 'invoice-1',
    creditedInvoiceNumber: '20260001',
    creditedInvoiceDate: '2026-07-01',
    customer: createParty('customer-1'),
    billingRecipient: createParty('billing-customer-1'),
    invoiceDate: '2026-07-23',
    dueDate: '2026-07-23',
    paymentTermDays: 0,
    reminderPeriodDays: 0,
    latePaymentInterestBasisPoints: 0,
    priceInputMode: 'net',
    subject: 'Hyvitys laskulle 20260001',
    orderNumber: '',
    note: '',
    deliveryAddressText: '',
    refundIban: '',
    lines: [
      {
        id: 'draft-line-1',
        lineType: 'source',
        sourceInvoiceLineId: 'source-line-1',
        isIncluded: true,
        position: 1,
        code: '',
        description: 'Työ',
        quantityHundredths: 100,
        maximumQuantityHundredths: 100,
        unit: 'h',
        unitPriceCents: 10_000,
        vatRateBasisPoints: 2_550,
        discount: { type: 'none' },
        baseCents: 10_000,
        discountCents: 0,
        netCents: 10_000,
        vatCents: 2_550,
        grossCents: 12_550,
      },
    ],
    totals: {
      netTotalCents: 10_000,
      vatTotalCents: 2_550,
      grossTotalCents: 12_550,
      vatBreakdown: [
        {
          vatRateBasisPoints: 2_550,
          netCents: 10_000,
          vatCents: 2_550,
          grossCents: 12_550,
        },
      ],
    },
    createdAt: '2026-07-23T10:00:00.000Z',
    updatedAt: '2026-07-23T10:00:00.000Z',
  };
}

function createParty(customerId: string) {
  return {
    customerId,
    customerNumber: '1001',
    name: 'Asiakas Oy',
    businessId: '1234567-8',
    email: 'asiakas@example.test',
    phone: '040 123 4567',
    streetAddress: 'Testikatu 1',
    postalCode: '00100',
    city: 'Helsinki',
  };
}
