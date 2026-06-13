import { describe, expect, it } from 'vitest';

import {
  getInvoiceDraft,
  type GetInvoiceDraftInput,
} from '../application/getInvoiceDraft.js';
import {
  saveInvoiceDraft,
  type SaveInvoiceDraftInput,
} from '../application/saveInvoiceDraft.js';
import type { InvoiceDraft } from '../domain/invoiceDraft.js';
import type { CustomerAccessReader } from '../ports/customerAccessReader.js';
import type { InvoiceDraftRepository } from '../ports/invoiceDraftRepository.js';
import { createInvoiceDraftRoutes } from './invoiceDraftRoutes.js';

class FakeInvoiceDraftRepository implements InvoiceDraftRepository {
  savedDraft: InvoiceDraft | undefined;

  async saveDraft(draft: InvoiceDraft): Promise<InvoiceDraft> {
    this.savedDraft = draft;
    return draft;
  }

  async getDraftById(
    companyId: string,
    invoiceDraftId: string,
  ): Promise<InvoiceDraft | undefined> {
    if (
      this.savedDraft?.companyId === companyId &&
      this.savedDraft.id === invoiceDraftId
    ) {
      return this.savedDraft;
    }

    return undefined;
  }
}

class FakeCustomerAccessReader implements CustomerAccessReader {
  calls: Array<{ customerId: string; companyId: string }> = [];

  constructor(private readonly customerBelongsToCompany = true) {}

  async belongsToCompany(
    customerId: string,
    companyId: string,
  ): Promise<boolean> {
    this.calls.push({ customerId, companyId });
    return this.customerBelongsToCompany;
  }
}

function createTestApp(customerBelongsToCompany = true) {
  const invoiceDraftRepository = new FakeInvoiceDraftRepository();
  const customerAccessReader = new FakeCustomerAccessReader(
    customerBelongsToCompany,
  );
  let getInput: GetInvoiceDraftInput | undefined;
  let saveInput: SaveInvoiceDraftInput | undefined;
  const app = createInvoiceDraftRoutes({
    async getInvoiceDraft(input) {
      getInput = input;

      return getInvoiceDraft(input, invoiceDraftRepository);
    },
    async saveInvoiceDraft(input) {
      saveInput = input;

      return saveInvoiceDraft(input, {
        customerAccessReader,
        invoiceDraftRepository,
      });
    },
  });

  return {
    app,
    customerAccessReader,
    invoiceDraftRepository,
    getGetInput: () => getInput,
    getSaveInput: () => saveInput,
  };
}

function createValidRequestBody(): Record<string, unknown> {
  return {
    customerId: 'customer-1',
    invoiceDate: '2026-06-13',
    priceInputMode: 'net',
    subject: 'Test invoice',
    lines: [
      {
        code: 'WORK',
        description: 'Installation work',
        quantityHundredths: 150,
        unit: 'h',
        unitPriceCents: 10_000,
        vatRateBasisPoints: 2550,
        discount: { type: 'percentage', basisPoints: 500 },
      },
    ],
  };
}

async function postJson(
  app: ReturnType<typeof createInvoiceDraftRoutes>,
  body: unknown,
): Promise<Response> {
  return app.request('/invoice-drafts', {
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  });
}

describe('invoiceDraftRoutes', () => {
  it('creates and saves an invoice draft with domain-calculated totals', async () => {
    const testContext = createTestApp();

    const response = await postJson(
      testContext.app,
      createValidRequestBody(),
    );
    const body = (await response.json()) as {
      invoiceDraft: InvoiceDraft;
    };

    expect(response.status).toBe(201);
    expect(testContext.getSaveInput()).toMatchObject({
      companyId: 'dev-company',
      customerId: 'customer-1',
      invoiceDate: '2026-06-13',
      priceInputMode: 'net',
    });
    expect(testContext.customerAccessReader.calls).toEqual([
      {
        customerId: 'customer-1',
        companyId: 'dev-company',
      },
    ]);
    expect(testContext.invoiceDraftRepository.savedDraft).toEqual(
      body.invoiceDraft,
    );
    expect(body.invoiceDraft.lines[0]).toMatchObject({
      baseCents: 15_000,
      discountCents: 750,
      netCents: 14_250,
      vatCents: 3634,
      grossCents: 17_884,
    });
    expect(body.invoiceDraft.totals).toEqual({
      netTotalCents: 14_250,
      vatTotalCents: 3634,
      grossTotalCents: 17_884,
      vatBreakdown: [
        {
          vatRateBasisPoints: 2550,
          netCents: 14_250,
          vatCents: 3634,
          grossCents: 17_884,
        },
      ],
    });
  });

  it('rejects server-owned calculated totals from the request body', async () => {
    const testContext = createTestApp();

    const response = await postJson(testContext.app, {
      ...createValidRequestBody(),
      grossTotalCents: 1,
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: 'Invalid invoice draft body.',
    });
    expect(testContext.getSaveInput()).toBeUndefined();
    expect(testContext.invoiceDraftRepository.savedDraft).toBeUndefined();
  });

  it('rejects request companyId instead of trusting or overriding it', async () => {
    const testContext = createTestApp();

    const response = await postJson(testContext.app, {
      ...createValidRequestBody(),
      companyId: 'other-company',
    });

    expect(response.status).toBe(400);
    expect(testContext.getSaveInput()).toBeUndefined();
    expect(testContext.customerAccessReader.calls).toEqual([]);
    expect(testContext.invoiceDraftRepository.savedDraft).toBeUndefined();
  });

  it('rejects unsupported invoice units', async () => {
    const testContext = createTestApp();
    const requestBody = createValidRequestBody();
    requestBody.lines = [
      {
        description: 'Unsupported unit',
        quantityHundredths: 100,
        unit: 'box',
        unitPriceCents: 1000,
        vatRateBasisPoints: 2550,
        discount: { type: 'none' },
      },
    ];

    const response = await postJson(testContext.app, requestBody);

    expect(response.status).toBe(400);
    expect(testContext.invoiceDraftRepository.savedDraft).toBeUndefined();
  });

  it('rejects invoice drafts without lines', async () => {
    const testContext = createTestApp();

    const response = await postJson(testContext.app, {
      ...createValidRequestBody(),
      lines: [],
    });

    expect(response.status).toBe(400);
    expect(testContext.invoiceDraftRepository.savedDraft).toBeUndefined();
  });

  it('does not save when customer access verification fails', async () => {
    const testContext = createTestApp(false);

    const response = await postJson(
      testContext.app,
      createValidRequestBody(),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: 'Customer is not available for invoicing.',
    });
    expect(testContext.invoiceDraftRepository.savedDraft).toBeUndefined();
  });

  it('rejects invalid JSON before calling the use case', async () => {
    const testContext = createTestApp();

    const response = await testContext.app.request('/invoice-drafts', {
      body: '{',
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: 'Invalid JSON body.',
    });
    expect(testContext.getSaveInput()).toBeUndefined();
  });

  it('rejects invoice draft bodies that exceed the route size limit', async () => {
    const testContext = createTestApp();

    const response = await postJson(testContext.app, {
      ...createValidRequestBody(),
      note: 'x'.repeat(300_000),
    });

    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({
      error: 'Invoice draft body is too large.',
    });
    expect(testContext.getSaveInput()).toBeUndefined();
  });

  it('gets an existing invoice draft using the backend company context', async () => {
    const testContext = createTestApp();
    const createResponse = await postJson(
      testContext.app,
      createValidRequestBody(),
    );
    const createBody = (await createResponse.json()) as {
      invoiceDraft: InvoiceDraft;
    };

    const response = await testContext.app.request(
      `/invoice-drafts/${createBody.invoiceDraft.id}`,
    );
    const body = (await response.json()) as {
      invoiceDraft: InvoiceDraft;
    };

    expect(response.status).toBe(200);
    expect(testContext.getGetInput()).toEqual({
      companyId: 'dev-company',
      invoiceDraftId: createBody.invoiceDraft.id,
    });
    expect(body).toEqual({ invoiceDraft: createBody.invoiceDraft });
  });

  it('returns a generic not-found response for an unavailable draft', async () => {
    const testContext = createTestApp();

    const response = await testContext.app.request(
      '/invoice-drafts/missing-draft',
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: 'Invoice draft not found.',
    });
  });

  it('does not accept request companyId as the trusted company context', async () => {
    const testContext = createTestApp();

    const response = await testContext.app.request(
      '/invoice-drafts/draft-1?companyId=other-company',
    );

    expect(response.status).toBe(404);
    expect(testContext.getGetInput()).toEqual({
      companyId: 'dev-company',
      invoiceDraftId: 'draft-1',
    });
  });

  it('rejects an invoice draft id that exceeds the accepted length', async () => {
    const testContext = createTestApp();

    const response = await testContext.app.request(
      `/invoice-drafts/${'x'.repeat(201)}`,
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: 'Invoice draft id is invalid.',
    });
    expect(testContext.invoiceDraftRepository.savedDraft).toBeUndefined();
  });
});
