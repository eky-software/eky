import { createActorContext } from '@eky/auth';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import type { BackendEnvironment } from '../../../http/runtimeTrust.js';
import type { GetApprovedInvoiceInput } from '../application/getApprovedInvoice.js';
import type { GetInvoiceCreditContextInput } from '../application/getInvoiceCreditContext.js';
import type { ListApprovedInvoicesInput } from '../application/listApprovedInvoices.js';
import type { ListSentInvoiceGroupsInput } from '../application/listSentInvoiceGroups.js';
import { ApprovedInvoiceNotFoundError } from '../application/approvedInvoiceNotFoundError.js';
import type {
  ApprovedInvoiceListPage,
  ApprovedInvoiceSummary,
} from '../domain/approvedInvoiceSummary.js';
import type { ApprovedInvoiceView } from '../domain/approvedInvoiceView.js';
import type { InvoiceCreditContext } from '../domain/invoiceCreditContext.js';
import { InvoiceDraftValidationError } from '../domain/invoiceDraftValidationError.js';
import { createApprovedInvoiceQueryRoutes } from './approvedInvoiceQueryRoutes.js';

describe('approved invoice query routes', () => {
  it('returns approved invoice summaries in the trusted company scope', async () => {
    const invoice = createApprovedInvoiceSummary();
    const invoicePage = createApprovedInvoiceListPage([invoice]);
    const { app, getListInput } = createTestApp({ invoicePage });

    const response = await app.request('/invoices');

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ invoicePage });
    expect(getListInput()).toEqual({
      companyId: 'dev-company',
      status: 'approved',
      page: 1,
      pageSize: 20,
      sort: 'invoiceDateDesc',
    });
  });

  it('validates and forwards supported list filters without trusting companyId', async () => {
    const { app, getListInput } = createTestApp({
      invoicePage: createApprovedInvoiceListPage([]),
    });

    const response = await app.request(
      '/invoices?status=sent&customerId=customer-1&dateFrom=2026-01-01&dateTo=2026-12-31&page=2&pageSize=50&sort=customerNameAsc',
    );

    expect(response.status).toBe(200);
    expect(getListInput()).toEqual({
      companyId: 'dev-company',
      customerId: 'customer-1',
      status: 'sent',
      dateFrom: '2026-01-01',
      dateTo: '2026-12-31',
      page: 2,
      pageSize: 50,
      sort: 'customerNameAsc',
    });

    const tenantOverrideResponse = await app.request(
      '/invoices?companyId=other-company',
    );

    expect(tenantOverrideResponse.status).toBe(400);
  });

  it('accepts the compact five-row invoice page size', async () => {
    const { app, getListInput } = createTestApp({
      invoicePage: createApprovedInvoiceListPage([]),
    });

    const response = await app.request('/invoices?page=2&pageSize=5');

    expect(response.status).toBe(200);
    expect(getListInput()).toMatchObject({
      companyId: 'dev-company',
      page: 2,
      pageSize: 5,
    });

    const sentResponse = await app.request(
      '/sent-invoice-groups?page=2&pageSize=5',
    );

    expect(sentResponse.status).toBe(200);
  });

  it.each([4, 6])('rejects unsupported compact page size %i', async (pageSize) => {
    const { app } = createTestApp({
      invoicePage: createApprovedInvoiceListPage([]),
    });

    const invoiceResponse = await app.request(
      `/invoices?pageSize=${pageSize}`,
    );
    const sentResponse = await app.request(
      `/sent-invoice-groups?pageSize=${pageSize}`,
    );

    expect(invoiceResponse.status).toBe(400);
    expect(sentResponse.status).toBe(400);
  });

  it('returns an approved invoice by id in the trusted company scope', async () => {
    const invoice = createApprovedInvoiceView();
    const { app, getInput } = createTestApp({ invoice });

    const response = await app.request('/invoices/invoice-1');

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ invoice });
    expect(getInput()).toEqual({
      companyId: 'dev-company',
      invoiceId: 'invoice-1',
    });
  });

  it('returns company-scoped sent invoice groups without accepting status overrides', async () => {
    const { app, getSentGroupInput } = createTestApp({});

    const response = await app.request(
      '/sent-invoice-groups?customerId=customer-1&dateFrom=2026-01-01&page=2&pageSize=50',
    );

    expect(response.status).toBe(200);
    expect(getSentGroupInput()).toEqual({
      companyId: 'dev-company',
      customerId: 'customer-1',
      creditState: 'all',
      dateFrom: '2026-01-01',
      page: 2,
      pageSize: 50,
      paymentState: 'all',
      sort: 'invoiceDateDesc',
    });

    const statusOverrideResponse = await app.request(
      '/sent-invoice-groups?status=approved',
    );
    const tenantOverrideResponse = await app.request(
      '/sent-invoice-groups?companyId=other-company',
    );

    expect(statusOverrideResponse.status).toBe(400);
    expect(tenantOverrideResponse.status).toBe(400);
  });

  it('validates the sent invoice credit-state filter', async () => {
    const { app, getSentGroupInput } = createTestApp({});

    const response = await app.request(
      '/sent-invoice-groups?creditState=credited',
    );

    expect(response.status).toBe(200);
    expect(getSentGroupInput()).toEqual({
      companyId: 'dev-company',
      creditState: 'credited',
      page: 1,
      pageSize: 20,
      paymentState: 'all',
      sort: 'invoiceDateDesc',
    });

    const invalidResponse = await app.request(
      '/sent-invoice-groups?creditState=other',
    );

    expect(invalidResponse.status).toBe(400);
  });

  it('validates the sent invoice payment-state filter', async () => {
    const { app, getSentGroupInput } = createTestApp({});

    const response = await app.request(
      '/sent-invoice-groups?paymentState=paid',
    );

    expect(response.status).toBe(200);
    expect(getSentGroupInput()).toEqual({
      companyId: 'dev-company',
      creditState: 'all',
      page: 1,
      pageSize: 20,
      paymentState: 'paid',
      sort: 'invoiceDateDesc',
    });

    const invalidResponse = await app.request(
      '/sent-invoice-groups?paymentState=other',
    );

    expect(invalidResponse.status).toBe(400);
  });

  it.each([
    '/invoices?customerId=',
    `/invoices?customerId=${'x'.repeat(201)}`,
  ])('rejects an invalid customer filter: %s', async (path) => {
    const { app } = createTestApp({});

    const response = await app.request(path);

    expect(response.status).toBe(400);
  });

  it('returns a credit context in the trusted company scope', async () => {
    const creditContext = createInvoiceCreditContext();
    const { app, getCreditContextInput } = createTestApp({ creditContext });

    const response = await app.request('/invoices/invoice-1/credit-context');

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ creditContext });
    expect(getCreditContextInput()).toEqual({
      companyId: 'dev-company',
      sourceInvoiceId: 'invoice-1',
    });
  });

  it('preserves the snapshot response shape used by invoice views', async () => {
    const { app } = createTestApp({ invoice: createApprovedInvoiceView() });

    const response = await app.request('/invoices/invoice-1');
    const body = await response.json();

    expect(body.invoice).toMatchObject({
      billingRecipientNameSnapshot: 'Billing Recipient Oy',
      companyNameSnapshot: 'Example Builder Oy',
      companyVatNumberSnapshot: 'FI76543210',
      customerNameSnapshot: 'Example Customer Oy',
      invoiceNumber: '20260001',
      referenceNumber: '202600017',
      totals: {
        grossTotalCents: 12550,
        netTotalCents: 10000,
        vatTotalCents: 2550,
      },
    });
  });

  it('returns a safe 404 without revealing another company invoice', async () => {
    const { app } = createTestApp({
      getError: new ApprovedInvoiceNotFoundError(),
    });

    const response = await app.request('/invoices/missing-invoice');

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: 'Approved invoice was not found.',
    });
  });

  it('maps query validation failures to the existing safe 400 response', async () => {
    const { app } = createTestApp({
      listError: new InvoiceDraftValidationError('Invalid company id.'),
    });

    const response = await app.request('/invoices');

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'Invalid company id.',
    });
  });
});

function createTestApp(options: {
  getError?: Error;
  creditContext?: InvoiceCreditContext;
  invoice?: ApprovedInvoiceView;
  invoicePage?: ApprovedInvoiceListPage;
  listError?: Error;
}) {
  let getInput: GetApprovedInvoiceInput | undefined;
  let creditContextInput: GetInvoiceCreditContextInput | undefined;
  let listInput: ListApprovedInvoicesInput | undefined;
  let sentGroupInput: ListSentInvoiceGroupsInput | undefined;
  const routes = createApprovedInvoiceQueryRoutes({
    async getApprovedInvoice(input) {
      getInput = input;

      if (options.getError !== undefined) {
        throw options.getError;
      }

      if (options.invoice === undefined) {
        throw new ApprovedInvoiceNotFoundError();
      }

      return options.invoice;
    },
    async getInvoiceCreditContext(input) {
      creditContextInput = input;

      if (options.creditContext === undefined) {
        throw new ApprovedInvoiceNotFoundError();
      }

      return options.creditContext;
    },
    async listApprovedInvoices(input) {
      listInput = input;

      if (options.listError !== undefined) {
        throw options.listError;
      }

      return options.invoicePage ?? createApprovedInvoiceListPage([]);
    },
    async listSentInvoiceGroups(input) {
      sentGroupInput = input;
      return {
        groups: [],
        page: 1,
        pageSize: 20,
        totalCount: 0,
        totalPages: 0,
      };
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
        permissions: [],
      }),
    );
    await next();
  });
  app.route('/', routes);

  return {
    app,
    getInput: () => getInput,
    getCreditContextInput: () => creditContextInput,
    getListInput: () => listInput,
    getSentGroupInput: () => sentGroupInput,
  };
}

function createInvoiceCreditContext(): InvoiceCreditContext {
  return {
    sourceInvoiceId: 'invoice-1',
    creditInvoices: [],
    creditStatus: 'none',
    remainingCreditableGrossCents: 12_550,
    activeCreditDraftId: null,
  };
}

function createApprovedInvoiceListPage(
  invoices: ApprovedInvoiceSummary[],
): ApprovedInvoiceListPage {
  return {
    invoices,
    page: 1,
    pageSize: 20,
    totalCount: invoices.length,
    totalPages: invoices.length === 0 ? 0 : 1,
  };
}

function createApprovedInvoiceSummary(): ApprovedInvoiceSummary {
  return {
    approvedAt: '2026-06-13T10:00:00.000Z',
    billingRecipientNameSnapshot: 'Billing Recipient Oy',
    customerId: 'customer-1',
    customerNameSnapshot: 'Example Customer Oy',
    customerNumberSnapshot: '1001',
    dueDate: '2026-06-27',
    grossTotalCents: 12550,
    id: 'invoice-1',
    invoiceKind: 'standard',
    creditedInvoiceId: null,
    invoiceDate: '2026-06-13',
    invoiceNumber: '20260001',
    referenceNumber: '202600017',
    status: 'approved',
    updatedAt: '2026-06-13T10:00:00.000Z',
    paymentState: 'unpaid',
    paidOn: null,
    paidAmountCents: null,
    paymentSource: null,
    cancelledAt: null,
  };
}

function createApprovedInvoiceView(): ApprovedInvoiceView {
  return {
    approvedAt: '2026-06-13T10:00:00.000Z',
    billingRecipientBusinessIdSnapshot: '8765432-1',
    billingRecipientCitySnapshot: 'Espoo',
    billingRecipientCustomerId: 'billing-1',
    billingRecipientCustomerNumberSnapshot: '2001',
    billingRecipientCustomerTypeSnapshot: 'propertyManager',
    billingRecipientEmailSnapshot: 'recipient@example.fi',
    billingRecipientNameSnapshot: 'Billing Recipient Oy',
    billingRecipientPhoneSnapshot: '040 333 4444',
    billingRecipientPostalCodeSnapshot: '02100',
    billingRecipientStreetAddressSnapshot: 'Recipient Street 3',
    companyBankNameSnapshot: 'Example Bank',
    companyBicSnapshot: 'NDEAFIHH',
    companyBusinessIdSnapshot: '7654321-0',
    companyCitySnapshot: 'Tampere',
    companyEmailSnapshot: 'billing@example.fi',
    companyIbanSnapshot: 'FI2112345600000785',
    companyNameSnapshot: 'Example Builder Oy',
    companyPhoneSnapshot: '03 123 4567',
    companyPostalCodeSnapshot: '33100',
    companyStreetAddressSnapshot: 'Builder Street 2',
    companyVatNumberSnapshot: 'FI76543210',
    companyWebsiteSnapshot: 'www.example-builder.fi',
    companyId: 'dev-company',
    invoiceKind: 'standard',
    creditedInvoiceId: null,
    creditedInvoiceNumber: null,
    creditedInvoiceDate: null,
    createdAt: '2026-06-13T10:00:00.000Z',
    customerBusinessIdSnapshot: '1234567-8',
    customerCitySnapshot: 'Helsinki',
    customerEmailSnapshot: 'customer@example.fi',
    customerId: 'customer-1',
    customerNameSnapshot: 'Example Customer Oy',
    customerNumberSnapshot: '1001',
    customerPhoneSnapshot: '040 111 2222',
    customerPostalCodeSnapshot: '00100',
    customerStreetAddressSnapshot: 'Customer Street 1',
    customerTypeSnapshot: 'company',
    deliveryAddressText: 'Worksite Street 4',
    dueDate: '2026-06-27',
    id: 'invoice-1',
    invoiceDate: '2026-06-13',
    invoiceNumber: '20260001',
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
        sourceInvoiceLineId: null,
        lineOrder: 1,
        netCents: 10000,
        quantityHundredths: 100,
        unit: 'h',
        unitPriceCents: 10000,
        vatCents: 2550,
        vatRateBasisPoints: 2550,
      },
    ],
    note: 'Invoice note',
    numberingMode: 'calendarYearSequence',
    orderNumber: 'ORDER-1',
    paymentTermDays: 14,
    priceInputMode: 'net',
    taxTreatment: 'normalVat',
    taxTreatmentLabelSnapshot: '',
    taxLegalBasisSnapshot: '',
    performancePeriod: { type: 'invoiceDate' },
    refundIbanSnapshot: '',
    referenceNumber: '202600017',
    referenceNumberType: 'finnishDomestic',
    reminderPeriodDays: 8,
    sequenceNumber: 1,
    sequenceScope: 'calendar-year:2026',
    seriesKey: 'default',
    sourceDraftId: 'draft-1',
    status: 'approved',
    subject: 'Test invoice',
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
    updatedAt: '2026-06-13T10:00:00.000Z',
    vatBreakdown: [
      {
        grossCents: 12550,
        netCents: 10000,
        vatCents: 2550,
        vatRateBasisPoints: 2550,
      },
    ],
    paymentState: 'unpaid',
    paidOn: null,
    paidAmountCents: null,
    paymentSource: null,
    cancelledAt: null,
    cancelledBy: null,
    cancellationReason: null,
  };
}
