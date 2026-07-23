import { createActorContext } from '@eky/auth';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import type { BackendEnvironment } from '../../../http/runtimeTrust.js';
import { ApprovedInvoiceNotFoundError } from '../application/approvedInvoiceNotFoundError.js';
import type { CopyApprovedInvoiceToDraftInput } from '../application/copyApprovedInvoiceToDraft.js';
import type { ReopenApprovedInvoiceForEditingInput } from '../application/reopenApprovedInvoiceForEditing.js';
import type { InvoiceDraft } from '../domain/invoiceDraft.js';
import { createApprovedInvoiceLifecycleRoutes } from './approvedInvoiceLifecycleRoutes.js';

describe('approved invoice lifecycle routes', () => {
  it('reopens an approved invoice in the trusted company scope', async () => {
    const { app, getReopenInput } = createTestApp({});

    const response = await app.request('/invoices/invoice-1/reopen-for-edit', {
      method: 'POST',
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      invoiceDraftId: 'draft-1',
      invoiceId: 'invoice-1',
    });
    expect(getReopenInput()).toMatchObject({
      actorUserId: 'dev-user',
      companyId: 'dev-company',
      invoiceId: 'invoice-1',
    });
  });

  it('copies an approved invoice to a new draft in the trusted company scope', async () => {
    const invoiceDraft = createInvoiceDraft();
    const { app, getCopyInput } = createTestApp({ invoiceDraft });

    const response = await app.request('/invoices/invoice-1/copy-to-draft', {
      method: 'POST',
    });

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({ invoiceDraft });
    expect(getCopyInput()).toMatchObject({
      companyId: 'dev-company',
      invoiceId: 'invoice-1',
    });
  });

  it('returns a safe 404 when reopening an invoice outside the company scope', async () => {
    const { app } = createTestApp({
      reopenError: new ApprovedInvoiceNotFoundError(),
    });

    const response = await app.request('/invoices/missing/reopen-for-edit', {
      method: 'POST',
    });

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: 'Approved invoice was not found.',
    });
  });

  it('returns a safe 404 when copying an invoice outside the company scope', async () => {
    const { app } = createTestApp({
      copyError: new ApprovedInvoiceNotFoundError(),
    });

    const response = await app.request('/invoices/missing/copy-to-draft', {
      method: 'POST',
    });

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: 'Approved invoice was not found.',
    });
  });
});

function createTestApp(options: {
  copyError?: Error;
  invoiceDraft?: InvoiceDraft;
  reopenError?: Error;
}) {
  let copyInput: CopyApprovedInvoiceToDraftInput | undefined;
  let reopenInput: ReopenApprovedInvoiceForEditingInput | undefined;
  const routes = createApprovedInvoiceLifecycleRoutes({
    async copyApprovedInvoiceToDraft(input) {
      copyInput = input;

      if (options.copyError !== undefined) {
        throw options.copyError;
      }

      return options.invoiceDraft ?? createInvoiceDraft();
    },
    async reopenApprovedInvoiceForEditing(input) {
      reopenInput = input;

      if (options.reopenError !== undefined) {
        throw options.reopenError;
      }

      return { draftId: 'draft-1', invoiceId: input.invoiceId };
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
    getCopyInput: () => copyInput,
    getReopenInput: () => reopenInput,
  };
}

function createInvoiceDraft(): InvoiceDraft {
  return {
    billingRecipientCustomerId: null,
    companyId: 'dev-company',
    invoiceKind: 'standard',
    creditedInvoiceId: null,
    createdAt: '2026-07-08T10:00:00.000Z',
    customerId: 'customer-1',
    deliveryAddressText: '',
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
        sourceInvoiceLineId: null,
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
    note: '',
    orderNumber: '',
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
