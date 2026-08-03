import { createActorContext } from '@eky/auth';
import { AuthorizationError } from '@eky/permissions';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import type { BackendEnvironment } from '../../../http/runtimeTrust.js';
import type { ActivateInvoiceNumberingSeriesInput } from '../application/activateInvoiceNumberingSeries.js';
import type { GetInvoiceNumberingSeriesOverviewInput } from '../application/getInvoiceNumberingSeriesOverview.js';
import type { InvoiceNumberingSeriesOverviewView } from '../application/invoiceNumberingSeriesView.js';
import { InvoiceNumberingSeriesError } from '../application/invoiceNumberingSeriesError.js';
import type {
  InvoiceNumberingSeriesActivationPreviewView,
  PreviewInvoiceNumberingSeriesActivationInput,
} from '../application/previewInvoiceNumberingSeriesActivation.js';
import { createInvoiceNumberingSeriesRoutes } from './invoiceNumberingSeriesRoutes.js';

const confirmationText = 'OTA UUSI LASKUNUMEROSARJA KÄYTTÖÖN';

interface TestDependencies {
  activateInvoiceNumberingSeries(
    input: ActivateInvoiceNumberingSeriesInput,
  ): Promise<InvoiceNumberingSeriesOverviewView>;
  getInvoiceNumberingSeriesOverview(
    input: GetInvoiceNumberingSeriesOverviewInput,
  ): Promise<InvoiceNumberingSeriesOverviewView>;
  previewInvoiceNumberingSeriesActivation(
    input: PreviewInvoiceNumberingSeriesActivationInput,
  ): Promise<InvoiceNumberingSeriesActivationPreviewView>;
}

function createTestApp(
  dependencies: TestDependencies,
  permissions = ['manageInvoiceNumberingSeries'] as const,
): Hono<BackendEnvironment> {
  const app = new Hono<BackendEnvironment>();
  app.use('*', async (context, next) => {
    context.set(
      'actorContext',
      createActorContext({
        actorId: 'local-owner',
        authenticationMode: 'local',
        companyId: 'company-1',
        permissions: [...permissions],
      }),
    );
    await next();
  });
  app.route('/', createInvoiceNumberingSeriesRoutes(dependencies));

  return app;
}

function createDependencies(
  overrides: Partial<TestDependencies> = {},
): TestDependencies & {
  activateInputs: ActivateInvoiceNumberingSeriesInput[];
  getInputs: GetInvoiceNumberingSeriesOverviewInput[];
  previewInputs: PreviewInvoiceNumberingSeriesActivationInput[];
} {
  const activateInputs: ActivateInvoiceNumberingSeriesInput[] = [];
  const getInputs: GetInvoiceNumberingSeriesOverviewInput[] = [];
  const previewInputs: PreviewInvoiceNumberingSeriesActivationInput[] = [];

  return {
    activateInputs,
    getInputs,
    previewInputs,
    async activateInvoiceNumberingSeries(input) {
      activateInputs.push(input);
      return createOverview({ revision: input.currentRevision + 1 });
    },
    async getInvoiceNumberingSeriesOverview(input) {
      getInputs.push(input);
      return createOverview();
    },
    async previewInvoiceNumberingSeriesActivation(input) {
      previewInputs.push(input);
      return {
        capacity: 'available',
        maximumSequenceNumber: 9999,
        minimumFirstSequenceNumber: 100,
        previewDate: input.previewDate,
        previewInvoiceNumber: '20260100',
      };
    },
    ...overrides,
  };
}

function createOverview(
  overrides: Partial<InvoiceNumberingSeriesOverviewView> = {},
): InvoiceNumberingSeriesOverviewView {
  return {
    activeSeries: {
      mode: 'calendarYearSequence',
      fiscalYearStartMonth: 1,
      sequencePadding: 4,
      firstSequenceNumber: 1,
      createdAt: '2026-01-01T00:00:00.000Z',
      activatedAt: '2026-01-01T00:00:00.000Z',
    },
    activationConfirmationText: confirmationText,
    history: [],
    revision: 1,
    ...overrides,
  };
}

function createValidActivationBody(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    confirmation: confirmationText,
    currentRevision: 1,
    firstSequenceNumber: 100,
    fiscalYearStartMonth: 1,
    mode: 'calendarYearSequence',
    reasonCode: 'accountingRequirement',
    reasonNote: 'Kirjanpidon vaatima muutos',
    sequencePadding: 4,
    ...overrides,
  };
}

async function postActivation(
  app: Hono<BackendEnvironment>,
  body: unknown,
  contentType = 'application/json',
): Promise<Response> {
  return app.request('/invoice-numbering-series/activate', {
    body: JSON.stringify(body),
    headers: { 'Content-Type': contentType },
    method: 'POST',
  });
}

describe('invoiceNumberingSeriesRoutes', () => {
  it('returns a company-scoped overview without internal series keys', async () => {
    const dependencies = createDependencies();
    const app = createTestApp(dependencies);

    const response = await app.request('/invoice-numbering-series');
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(dependencies.getInputs[0]?.actorContext).toMatchObject({
      actorId: 'local-owner',
      companyId: 'company-1',
    });
    expect(JSON.stringify(body)).not.toContain('seriesKey');
    expect(body).toEqual({
      invoiceNumberingSeriesOverview: createOverview(),
    });
  });

  it('returns a read-only backend preview from a strict query', async () => {
    const dependencies = createDependencies();
    const app = createTestApp(dependencies);

    const response = await app.request(
      '/invoice-numbering-series/activation-preview?mode=calendarYearSequence&fiscalYearStartMonth=1&sequencePadding=4&previewDate=2026-08-02',
    );

    expect(response.status).toBe(200);
    expect(dependencies.previewInputs).toEqual([
      expect.objectContaining({
        actorContext: expect.objectContaining({ companyId: 'company-1' }),
        mode: 'calendarYearSequence',
        fiscalYearStartMonth: 1,
        sequencePadding: 4,
        previewDate: '2026-08-02',
      }),
    ]);
    expect(dependencies.activateInputs).toHaveLength(0);
  });

  it.each([
    ['unknown field', { unsupported: true }],
    ['company id', { companyId: 'other-company' }],
    ['actor id', { actorUserId: 'other-user' }],
    ['timestamp', { now: '2020-01-01T00:00:00.000Z' }],
    ['series key', { seriesKey: 'browser-series' }],
    ['active series key', { currentActiveSeriesKey: 'browser-series' }],
  ])('rejects the server-owned %s before activation', async (_name, field) => {
    const dependencies = createDependencies();
    const app = createTestApp(dependencies);

    const response = await postActivation(
      app,
      createValidActivationBody(field),
    );

    expect(response.status).toBe(400);
    expect(dependencies.activateInputs).toHaveLength(0);
  });

  it('activates with trusted actor context and server time', async () => {
    const dependencies = createDependencies();
    const app = createTestApp(dependencies);
    const before = Date.now();

    const response = await postActivation(
      app,
      createValidActivationBody(),
      'application/json; charset=utf-8',
    );

    expect(response.status).toBe(201);
    expect(dependencies.activateInputs[0]).toMatchObject({
      actorContext: {
        actorId: 'local-owner',
        companyId: 'company-1',
      },
      confirmation: confirmationText,
      currentRevision: 1,
      firstSequenceNumber: 100,
      reasonCode: 'accountingRequirement',
    });
    expect(Date.parse(dependencies.activateInputs[0]?.now ?? '')).toBeGreaterThanOrEqual(
      before,
    );
  });

  it.each([
    ['text/plain', 415],
    ['', 415],
  ])('rejects %s JSON bodies before activation', async (contentType, status) => {
    const dependencies = createDependencies();
    const app = createTestApp(dependencies);
    const headers =
      contentType.length > 0 ? { 'Content-Type': contentType } : undefined;
    const requestInit: RequestInit = {
      body: JSON.stringify(createValidActivationBody()),
      method: 'POST',
    };

    if (headers !== undefined) {
      requestInit.headers = headers;
    }

    const response = await app.request(
      '/invoice-numbering-series/activate',
      requestInit,
    );

    expect(response.status).toBe(status);
    expect(dependencies.activateInputs).toHaveLength(0);
  });

  it('rejects malformed JSON and invalid bounded fields without activation', async () => {
    const dependencies = createDependencies();
    const app = createTestApp(dependencies);
    const malformedResponse = await app.request(
      '/invoice-numbering-series/activate',
      {
        body: '{',
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      },
    );
    const invalidResponse = await postActivation(
      app,
      createValidActivationBody({
        reasonNote: 'x'.repeat(501),
      }),
    );

    expect(malformedResponse.status).toBe(400);
    expect(invalidResponse.status).toBe(400);
    expect(dependencies.activateInputs).toHaveLength(0);
  });

  it('rejects unsupported and duplicate preview query values', async () => {
    const dependencies = createDependencies();
    const app = createTestApp(dependencies);
    const base =
      '/invoice-numbering-series/activation-preview?mode=calendarYearSequence&fiscalYearStartMonth=1&sequencePadding=4&previewDate=2026-08-02';

    const unsupported = await app.request(`${base}&companyId=other-company`);
    const duplicate = await app.request(`${base}&mode=plainSequence`);

    expect(unsupported.status).toBe(400);
    expect(duplicate.status).toBe(400);
    expect(dependencies.previewInputs).toHaveLength(0);
  });

  it.each([
    [new AuthorizationError(), 403],
    [
      new InvoiceNumberingSeriesError(
        'notFound',
        'Sensitive not found details.',
      ),
      404,
    ],
    [
      new InvoiceNumberingSeriesError(
        'conflict',
        'Sensitive conflict details.',
      ),
      409,
    ],
    [
      new InvoiceNumberingSeriesError(
        'unsafeFirstSequenceNumber',
        'Sensitive collision details.',
      ),
      409,
    ],
  ])('maps application errors safely', async (error, status) => {
    const dependencies = createDependencies({
      async activateInvoiceNumberingSeries() {
        throw error;
      },
    });
    const app = createTestApp(dependencies);

    const response = await postActivation(
      app,
      createValidActivationBody(),
    );
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(status);
    expect(body.error).not.toContain('Sensitive');
  });
});
