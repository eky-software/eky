import { createActorContext } from '@eky/auth';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import type { BackendEnvironment } from '../../../http/runtimeTrust.js';
import { ApprovedInvoiceNotFoundError } from '../application/approvedInvoiceNotFoundError.js';
import type { CancelApprovedInvoiceInput } from '../application/cancelApprovedInvoice.js';
import type { CopyApprovedInvoiceToDraftInput } from '../application/copyApprovedInvoiceToDraft.js';
import { InvoiceCancellationConfirmationError } from '../application/invoiceCancellationConfirmationError.js';
import { InvoiceCancellationConflictError } from '../application/invoiceCancellationConflictError.js';
import type { ReopenApprovedInvoiceForEditingInput } from '../application/reopenApprovedInvoiceForEditing.js';
import type { InvoiceDraft } from '../domain/invoiceDraft.js';
import type { CancelledApprovedInvoiceResult } from '../ports/invoiceCorrectionRepository.js';
import { createApprovedInvoiceLifecycleRoutes } from './approvedInvoiceLifecycleRoutes.js';

describe('approved invoice lifecycle routes', () => {
  it('cancels an invoice in the trusted actor and company scope', async () => {
    const { app, getCancelInput } = createTestApp({});

    const response = await app.request('/invoices/invoice-1/cancel', {
      body: JSON.stringify({
        cancellationReason: 'Duplicate invoice',
        confirmationInvoiceNumber: '20260001',
      }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      cancellation: createCancelledInvoice(),
    });
    expect(getCancelInput()).toMatchObject({
      actorContext: {
        actorId: 'dev-user',
        companyId: 'dev-company',
      },
      cancellationReason: 'Duplicate invoice',
      confirmationInvoiceNumber: '20260001',
      invoiceId: 'invoice-1',
    });
  });

  it('rejects server-owned fields in an invoice cancellation request', async () => {
    const { app, getCancelInput } = createTestApp({});

    const response = await app.request('/invoices/invoice-1/cancel', {
      body: JSON.stringify({
        cancellationReason: 'Duplicate invoice',
        companyId: 'other-company',
        confirmationInvoiceNumber: '20260001',
      }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'Invoice cancellation request is invalid.',
    });
    expect(getCancelInput()).toBeUndefined();
  });

  it('rejects malformed invoice cancellation JSON safely', async () => {
    const { app, getCancelInput } = createTestApp({});

    const response = await app.request('/invoices/invoice-1/cancel', {
      body: '{"cancellationReason"',
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'Invoice cancellation request is invalid.',
    });
    expect(getCancelInput()).toBeUndefined();
  });

  it.each([
    {
      error: new InvoiceCancellationConfirmationError(),
      expectedStatus: 400,
    },
    {
      error: new InvoiceCancellationConflictError(),
      expectedStatus: 409,
    },
    {
      error: new ApprovedInvoiceNotFoundError(),
      expectedStatus: 404,
    },
  ])(
    'maps cancellation errors to a safe $expectedStatus response',
    async ({ error, expectedStatus }) => {
      const { app } = createTestApp({ cancelError: error });

      const response = await app.request('/invoices/invoice-1/cancel', {
        body: JSON.stringify({
          cancellationReason: 'Duplicate invoice',
          confirmationInvoiceNumber: '20260001',
        }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      });

      expect(response.status).toBe(expectedStatus);
      const responseBody = (await response.json()) as { error?: unknown };
      expect(responseBody.error).toBe(error.message);
      expect(JSON.stringify(responseBody)).not.toContain('stack');
    },
  );

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
  cancelError?: Error;
  cancelledInvoice?: CancelledApprovedInvoiceResult;
  copyError?: Error;
  invoiceDraft?: InvoiceDraft;
  reopenError?: Error;
}) {
  let cancelInput: CancelApprovedInvoiceInput | undefined;
  let copyInput: CopyApprovedInvoiceToDraftInput | undefined;
  let reopenInput: ReopenApprovedInvoiceForEditingInput | undefined;
  const routes = createApprovedInvoiceLifecycleRoutes({
    async cancelApprovedInvoice(input) {
      cancelInput = input;

      if (options.cancelError !== undefined) {
        throw options.cancelError;
      }

      return options.cancelledInvoice ?? createCancelledInvoice();
    },
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
    getCancelInput: () => cancelInput,
    getCopyInput: () => copyInput,
    getReopenInput: () => reopenInput,
  };
}

function createCancelledInvoice(): CancelledApprovedInvoiceResult {
  return {
    cancellationReason: 'Duplicate invoice',
    cancelledAt: '2026-07-23T18:00:00.000Z',
    cancelledBy: 'dev-user',
    invoiceId: 'invoice-1',
    invoiceKind: 'standard',
    invoiceNumber: '20260001',
    status: 'cancelled',
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
