import { describe, expect, it } from 'vitest';

import {
  getInvoiceDraft,
  type GetInvoiceDraftInput,
} from '../application/getInvoiceDraft.js';
import {
  listInvoiceDrafts,
  type ListInvoiceDraftsInput,
} from '../application/listInvoiceDrafts.js';
import {
  saveInvoiceDraft,
  type SaveInvoiceDraftInput,
} from '../application/saveInvoiceDraft.js';
import {
  updateInvoiceDraft,
  type UpdateInvoiceDraftInput,
} from '../application/updateInvoiceDraft.js';
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

  async updateDraft(draft: InvoiceDraft): Promise<InvoiceDraft> {
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

  async listDraftSummaries(
    companyId: string,
    customerId?: string,
  ) {
    if (
      this.savedDraft?.companyId !== companyId ||
      (customerId !== undefined &&
        this.savedDraft.customerId !== customerId)
    ) {
      return [];
    }

    const draft = this.savedDraft;

    return [
      {
        id: draft.id,
        customerId: draft.customerId,
        status: draft.status,
        invoiceDate: draft.invoiceDate,
        dueDate: draft.dueDate,
        paymentTermDays: draft.paymentTermDays,
        priceInputMode: draft.priceInputMode,
        subject: draft.subject,
        netTotalCents: draft.totals.netTotalCents,
        vatTotalCents: draft.totals.vatTotalCents,
        grossTotalCents: draft.totals.grossTotalCents,
        updatedAt: draft.updatedAt,
      },
    ];
  }
}

class FakeCustomerAccessReader implements CustomerAccessReader {
  calls: Array<{ customerId: string; companyId: string }> = [];

  constructor(private customerBelongsToCompany = true) {}

  setCustomerBelongsToCompany(value: boolean): void {
    this.customerBelongsToCompany = value;
  }

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
  let listInput: ListInvoiceDraftsInput | undefined;
  let saveInput: SaveInvoiceDraftInput | undefined;
  let updateInput: UpdateInvoiceDraftInput | undefined;
  const app = createInvoiceDraftRoutes({
    async getInvoiceDraft(input) {
      getInput = input;

      return getInvoiceDraft(input, invoiceDraftRepository);
    },
    async listInvoiceDrafts(input) {
      listInput = input;

      return listInvoiceDrafts(input, invoiceDraftRepository);
    },
    async saveInvoiceDraft(input) {
      saveInput = input;

      return saveInvoiceDraft(input, {
        customerAccessReader,
        invoiceDraftRepository,
      });
    },
    async updateInvoiceDraft(input) {
      updateInput = input;

      return updateInvoiceDraft(input, {
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
    getListInput: () => listInput,
    getSaveInput: () => saveInput,
    getUpdateInput: () => updateInput,
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

async function putJson(
  app: ReturnType<typeof createInvoiceDraftRoutes>,
  invoiceDraftId: string,
  body: unknown,
  query = '',
): Promise<Response> {
  return app.request(`/invoice-drafts/${invoiceDraftId}${query}`, {
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
    method: 'PUT',
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

  it('lists company draft summaries without returning draft details', async () => {
    const testContext = createTestApp();
    await postJson(testContext.app, createValidRequestBody());

    const response = await testContext.app.request('/invoice-drafts');
    const body = (await response.json()) as {
      invoiceDrafts: Array<Record<string, unknown>>;
    };

    expect(response.status).toBe(200);
    expect(testContext.getListInput()).toEqual({
      companyId: 'dev-company',
    });
    expect(body.invoiceDrafts).toHaveLength(1);
    expect(body.invoiceDrafts[0]).toMatchObject({
      customerId: 'customer-1',
      status: 'draft',
      subject: 'Test invoice',
      netTotalCents: 14_250,
      vatTotalCents: 3634,
      grossTotalCents: 17_884,
    });
    expect(body.invoiceDrafts[0]).not.toHaveProperty('lines');
    expect(body.invoiceDrafts[0]).not.toHaveProperty('vatBreakdown');
    expect(body.invoiceDrafts[0]).not.toHaveProperty('note');
    expect(body.invoiceDrafts[0]).not.toHaveProperty('orderNumber');
    expect(body.invoiceDrafts[0]).not.toHaveProperty('customerName');
  });

  it('passes the optional customerId filter to the use case', async () => {
    const testContext = createTestApp();
    await postJson(testContext.app, createValidRequestBody());

    const matchingResponse = await testContext.app.request(
      '/invoice-drafts?customerId=customer-1',
    );
    const missingResponse = await testContext.app.request(
      '/invoice-drafts?customerId=unknown-customer',
    );
    const matchingBody = (await matchingResponse.json()) as {
      invoiceDrafts: unknown[];
    };
    const missingBody = (await missingResponse.json()) as {
      invoiceDrafts: unknown[];
    };

    expect(matchingResponse.status).toBe(200);
    expect(matchingBody.invoiceDrafts).toHaveLength(1);
    expect(missingResponse.status).toBe(200);
    expect(missingBody.invoiceDrafts).toEqual([]);
  });

  it('ignores request companyId and uses the backend company context', async () => {
    const testContext = createTestApp();
    await postJson(testContext.app, createValidRequestBody());

    const response = await testContext.app.request(
      '/invoice-drafts?companyId=other-company',
    );
    const body = (await response.json()) as {
      invoiceDrafts: unknown[];
    };

    expect(response.status).toBe(200);
    expect(testContext.getListInput()).toEqual({
      companyId: 'dev-company',
    });
    expect(body.invoiceDrafts).toHaveLength(1);
  });

  it('rejects an invalid customerId query filter', async () => {
    const testContext = createTestApp();

    const response = await testContext.app.request(
      `/invoice-drafts?customerId=${'x'.repeat(201)}`,
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: 'Customer id is invalid.',
    });
  });

  it('rejects an empty customerId query filter', async () => {
    const testContext = createTestApp();

    const response = await testContext.app.request(
      '/invoice-drafts?customerId=',
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: 'Customer id is required.',
    });
  });

  it('updates an existing draft through the backend company context', async () => {
    const testContext = createTestApp();
    const createResponse = await postJson(
      testContext.app,
      createValidRequestBody(),
    );
    const createBody = (await createResponse.json()) as {
      invoiceDraft: InvoiceDraft;
    };
    const updateBody = {
      ...createValidRequestBody(),
      customerId: 'customer-2',
      invoiceDate: '2026-06-14',
      dueDate: '2026-07-14',
      paymentTermDays: 30,
      subject: 'Updated invoice',
      lines: [
        {
          description: 'Updated work',
          quantityHundredths: 200,
          unit: 'h',
          unitPriceCents: 5000,
          vatRateBasisPoints: 2550,
          discount: { type: 'none' },
        },
      ],
    };

    const response = await putJson(
      testContext.app,
      createBody.invoiceDraft.id,
      updateBody,
    );
    const body = (await response.json()) as {
      invoiceDraft: InvoiceDraft;
    };

    expect(response.status).toBe(200);
    expect(testContext.getUpdateInput()).toMatchObject({
      companyId: 'dev-company',
      invoiceDraftId: createBody.invoiceDraft.id,
      customerId: 'customer-2',
      invoiceDate: '2026-06-14',
    });
    expect(body.invoiceDraft).toMatchObject({
      id: createBody.invoiceDraft.id,
      companyId: 'dev-company',
      customerId: 'customer-2',
      subject: 'Updated invoice',
      createdAt: createBody.invoiceDraft.createdAt,
      totals: {
        netTotalCents: 10_000,
        vatTotalCents: 2550,
        grossTotalCents: 12_550,
      },
    });
    expect(body.invoiceDraft.updatedAt).not.toBe(
      createBody.invoiceDraft.updatedAt,
    );
    expect(body.invoiceDraft.lines).toHaveLength(1);
    expect(body.invoiceDraft.lines[0]).toMatchObject({
      position: 1,
      description: 'Updated work',
      netCents: 10_000,
      vatCents: 2550,
      grossCents: 12_550,
    });
  });

  it('rejects server-owned fields from an update body', async () => {
    const testContext = createTestApp();
    const createResponse = await postJson(
      testContext.app,
      createValidRequestBody(),
    );
    const createBody = (await createResponse.json()) as {
      invoiceDraft: InvoiceDraft;
    };
    const serverOwnedFields = [
      ['id', 'other-draft'],
      ['companyId', 'other-company'],
      ['status', 'approved'],
      ['grossTotalCents', 1],
      ['createdAt', '2020-01-01T00:00:00.000Z'],
      ['updatedAt', '2020-01-01T00:00:00.000Z'],
    ] as const;

    for (const [fieldName, fieldValue] of serverOwnedFields) {
      const response = await putJson(
        testContext.app,
        createBody.invoiceDraft.id,
        {
          ...createValidRequestBody(),
          [fieldName]: fieldValue,
        },
      );

      expect(response.status, fieldName).toBe(400);
      expect(await response.json(), fieldName).toEqual({
        error: 'Invalid invoice draft body.',
      });
    }

    expect(testContext.getUpdateInput()).toBeUndefined();
  });

  it('returns a generic not-found response for an unavailable update', async () => {
    const testContext = createTestApp();

    const response = await putJson(
      testContext.app,
      'missing-draft',
      createValidRequestBody(),
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: 'Invoice draft not found.',
    });
  });

  it('rejects invalid JSON and oversized update bodies', async () => {
    const testContext = createTestApp();
    const invalidJsonResponse = await testContext.app.request(
      '/invoice-drafts/draft-1',
      {
        body: '{',
        headers: { 'Content-Type': 'application/json' },
        method: 'PUT',
      },
    );
    const oversizedResponse = await putJson(
      testContext.app,
      'draft-1',
      {
        ...createValidRequestBody(),
        note: 'x'.repeat(300_000),
      },
    );

    expect(invalidJsonResponse.status).toBe(400);
    expect(await invalidJsonResponse.json()).toEqual({
      error: 'Invalid JSON body.',
    });
    expect(oversizedResponse.status).toBe(413);
    expect(await oversizedResponse.json()).toEqual({
      error: 'Invoice draft body is too large.',
    });
    expect(testContext.getUpdateInput()).toBeUndefined();
  });

  it('rejects an update id that exceeds the accepted length', async () => {
    const testContext = createTestApp();

    const response = await putJson(
      testContext.app,
      'x'.repeat(201),
      createValidRequestBody(),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: 'Invoice draft id is invalid.',
    });
  });

  it('does not update when customer access verification fails', async () => {
    const testContext = createTestApp();
    const createResponse = await postJson(
      testContext.app,
      createValidRequestBody(),
    );
    const createBody = (await createResponse.json()) as {
      invoiceDraft: InvoiceDraft;
    };
    testContext.customerAccessReader.setCustomerBelongsToCompany(false);

    const response = await putJson(
      testContext.app,
      createBody.invoiceDraft.id,
      {
        ...createValidRequestBody(),
        customerId: 'unavailable-customer',
      },
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: 'Customer is not available for invoicing.',
    });
    expect(testContext.invoiceDraftRepository.savedDraft).toEqual(
      createBody.invoiceDraft,
    );
  });

  it('ignores request companyId query and keeps the trusted company context', async () => {
    const testContext = createTestApp();
    const createResponse = await postJson(
      testContext.app,
      createValidRequestBody(),
    );
    const createBody = (await createResponse.json()) as {
      invoiceDraft: InvoiceDraft;
    };

    const response = await putJson(
      testContext.app,
      createBody.invoiceDraft.id,
      createValidRequestBody(),
      '?companyId=other-company',
    );

    expect(response.status).toBe(200);
    expect(testContext.getUpdateInput()).toMatchObject({
      companyId: 'dev-company',
      invoiceDraftId: createBody.invoiceDraft.id,
    });
  });
});
