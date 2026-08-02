import type { APIRequestContext, APIResponse } from '@playwright/test';

import { readE2eSqliteRows } from '../../src/assertions/readE2eSqliteRows.js';
import {
  createSyntheticCompanySettingsInput,
  createSyntheticCustomerInput,
  createSyntheticInvoiceDraftInput,
} from '../../src/data/syntheticBusinessInputs.js';
import {
  expect,
  test,
  type IsolatedBackendHarness,
} from '../../src/fixtures/isolatedBackendTest.js';

const activationConfirmation = 'OTA UUSI LASKUNUMEROSARJA KÄYTTÖÖN';
const previewDate = '2026-08-02';

interface ApprovedInvoiceIdentity {
  id: string;
  number: string;
}

interface NumberingSeriesOverview {
  activationConfirmationText: string;
  history: unknown[];
  revision: number;
}

interface NumberingSeriesPreview {
  capacity: 'available' | 'exhausted';
  minimumFirstSequenceNumber: number | null;
}

type ActivationFaultOperation =
  | 'activateInvoiceNumberingSeriesEvent'
  | 'activateInvoiceNumberingSeriesPointer'
  | 'activateInvoiceNumberingSeriesSettings';

test('INV-NUMBERING-SERIES-001 @critical activates a new series without consuming a number or mutating history', async ({
  e2eBackend,
}) => {
  const customerId = await seedNumberingPrerequisites(e2eBackend.api);
  const oldInvoice = await createApprovedInvoice(
    e2eBackend.api,
    customerId,
    'Invoice before numbering series transition',
  );
  const baseline = readNumberingPersistence(e2eBackend);
  const overviewResponse = await e2eBackend.api.get(
    '/invoice-numbering-series',
  );
  expect(overviewResponse.status()).toBe(200);
  const overviewText = await overviewResponse.text();
  expect(overviewText).not.toContain('seriesKey');
  expect(overviewText).not.toContain('dev-company');
  const overview = readOverview(JSON.parse(overviewText));

  const unauthenticatedRead = await e2eBackend.anonymousApi.get(
    '/invoice-numbering-series',
  );
  expect(unauthenticatedRead.status()).toBe(401);
  const unauthenticatedActivation = await e2eBackend.anonymousApi.post(
    '/invoice-numbering-series/activate',
    {
      data: createActivationRequest({
        currentRevision: overview.revision,
        firstSequenceNumber: 1,
      }),
    },
  );
  expect(unauthenticatedActivation.status()).toBe(401);

  const preview = await previewNewSeries(e2eBackend.api);
  expect(preview.capacity).toBe('available');
  expect(preview.minimumFirstSequenceNumber).not.toBeNull();
  const minimumFirstSequenceNumber = requireNumber(
    preview.minimumFirstSequenceNumber,
  );

  const wrongConfirmation = await activateSeries(e2eBackend.api, {
    confirmation: 'HYVÄKSYN',
    currentRevision: overview.revision,
    firstSequenceNumber: minimumFirstSequenceNumber,
  });
  expect(wrongConfirmation.status()).toBe(400);
  expect(readNumberingPersistence(e2eBackend)).toEqual(baseline);

  const serverOwnedField = await e2eBackend.api.post(
    '/invoice-numbering-series/activate',
    {
      data: {
        ...createActivationRequest({
          currentRevision: overview.revision,
          firstSequenceNumber: minimumFirstSequenceNumber,
        }),
        companyId: 'another-company',
      },
    },
  );
  expect(serverOwnedField.status()).toBe(400);
  expect(readNumberingPersistence(e2eBackend)).toEqual(baseline);

  const activationResponse = await activateSeries(e2eBackend.api, {
    currentRevision: overview.revision,
    firstSequenceNumber: minimumFirstSequenceNumber,
  });
  expect(activationResponse.status()).toBe(201);
  const activatedResponseText = await activationResponse.text();
  expect(activatedResponseText).not.toContain('seriesKey');
  expect(activatedResponseText).not.toContain('reasonNote');
  const activatedOverview = readOverview(
    JSON.parse(activatedResponseText),
  );
  expect(activatedOverview.revision).toBe(overview.revision + 1);
  expect(activatedOverview.history).toHaveLength(1);

  const oldInvoiceAfterActivation = readInvoicePersistence(
    e2eBackend,
    oldInvoice.id,
  );
  expect(oldInvoiceAfterActivation).toEqual(baseline.invoice);

  const newInvoice = await createApprovedInvoice(
    e2eBackend.api,
    customerId,
    'Invoice after numbering series transition',
  );
  const newInvoicePersistence = readInvoicePersistence(
    e2eBackend,
    newInvoice.id,
  );
  expect(newInvoicePersistence.series_key).not.toBe(
    oldInvoiceAfterActivation.series_key,
  );
  expect(newInvoicePersistence.invoice_number).toBe(newInvoice.number);
  expect(newInvoice.number).not.toBe(oldInvoice.number);

  const activityResponse = await e2eBackend.api.get(
    '/activity?month=2026-08&category=invoicing&page=1&pageSize=20',
  );
  expect(activityResponse.status()).toBe(200);
  const activityText = await activityResponse.text();
  expect(activityText).toContain('invoiceNumberingSeries.activated');
  expect(activityText).not.toContain('reasonNote');
  expect(activityText).not.toContain('actorUserId');
  expect(activityText).not.toContain('seriesKey');

  const beforeStaleActivation = readNumberingPersistence(e2eBackend);
  const staleActivation = await activateSeries(e2eBackend.api, {
    currentRevision: overview.revision,
    firstSequenceNumber: minimumFirstSequenceNumber + 10,
  });
  expect(staleActivation.status()).toBe(409);
  expect(readNumberingPersistence(e2eBackend)).toEqual(
    beforeStaleActivation,
  );
});

test('INV-NUMBERING-SERIES-002 @critical approves standard and credit invoices in the new active series', async ({
  e2eBackend,
}) => {
  const customerId = await seedNumberingPrerequisites(e2eBackend.api);
  const oldInvoice = await createApprovedInvoice(
    e2eBackend.api,
    customerId,
    'Old series source invoice',
  );
  await markInvoiceSent(e2eBackend.api, oldInvoice.id);
  const oldInvoiceBeforeActivation = readInvoicePersistence(
    e2eBackend,
    oldInvoice.id,
  );
  const sequencesBeforeActivation = readSequencePersistence(e2eBackend);

  const activeSeriesKey = await activateNextSeries(e2eBackend);
  expect(readSequencePersistence(e2eBackend)).toEqual(
    sequencesBeforeActivation,
  );

  const standardInvoice = await createApprovedInvoice(
    e2eBackend.api,
    customerId,
    'New series standard invoice',
  );
  const creditInvoice = await createFullCreditInvoice(
    e2eBackend.api,
    oldInvoice.id,
  );
  const standardPersistence = readInvoicePersistence(
    e2eBackend,
    standardInvoice.id,
  );
  const creditPersistence = readInvoicePersistence(
    e2eBackend,
    creditInvoice.id,
  );

  expect(readInvoicePersistence(e2eBackend, oldInvoice.id)).toEqual(
    oldInvoiceBeforeActivation,
  );
  expect(standardPersistence).toMatchObject({
    invoice_kind: 'standard',
    series_key: activeSeriesKey,
  });
  expect(creditPersistence).toMatchObject({
    credited_invoice_id: oldInvoice.id,
    invoice_kind: 'credit',
    series_key: activeSeriesKey,
  });
  expect(
    new Set(
      readInvoicePersistenceRows(e2eBackend).map(
        (row) => row.invoice_number,
      ),
    ).size,
  ).toBe(3);
});

test('INV-NUMBERING-SERIES-003 @security rejects stale, unsafe and server-owned activation input without writes', async ({
  e2eBackend,
}) => {
  const customerId = await seedNumberingPrerequisites(e2eBackend.api);
  await createApprovedInvoice(
    e2eBackend.api,
    customerId,
    'Security boundary baseline invoice',
  );
  const overview = await getNumberingOverview(e2eBackend.api);
  const preview = await previewNewSeries(e2eBackend.api);
  const minimumFirstSequenceNumber = requireNumber(
    preview.minimumFirstSequenceNumber,
  );
  expect(minimumFirstSequenceNumber).toBeGreaterThan(1);
  const baseline = readNumberingPersistence(e2eBackend);

  await expectSafeFailure(
    await e2eBackend.anonymousApi.get('/invoice-numbering-series'),
    401,
  );
  await expectSafeFailure(
    await e2eBackend.anonymousApi.post(
      '/invoice-numbering-series/activate',
      {
        data: createActivationRequest({
          currentRevision: overview.revision,
          firstSequenceNumber: minimumFirstSequenceNumber,
        }),
      },
    ),
    401,
  );

  await expectSafeFailure(
    await activateSeries(e2eBackend.api, {
      currentRevision: overview.revision,
      firstSequenceNumber: minimumFirstSequenceNumber - 1,
    }),
    409,
  );
  expect(readNumberingPersistence(e2eBackend)).toEqual(baseline);

  await expectSafeFailure(
    await activateSeries(e2eBackend.api, {
      confirmation: 'HYVÄKSYN MUUTOKSEN',
      currentRevision: overview.revision,
      firstSequenceNumber: minimumFirstSequenceNumber,
    }),
    400,
  );
  expect(readNumberingPersistence(e2eBackend)).toEqual(baseline);

  for (const serverOwnedField of [
    { actorId: 'forged-actor' },
    { companyId: 'other-company' },
    { seriesKey: 'forged-series' },
  ]) {
    const response = await e2eBackend.api.post(
      '/invoice-numbering-series/activate',
      {
        data: {
          ...createActivationRequest({
            currentRevision: overview.revision,
            firstSequenceNumber: minimumFirstSequenceNumber,
          }),
          ...serverOwnedField,
        },
      },
    );
    await expectSafeFailure(response, 400);
    expect(readNumberingPersistence(e2eBackend)).toEqual(baseline);
  }

  const activation = await activateSeries(e2eBackend.api, {
    currentRevision: overview.revision,
    firstSequenceNumber: minimumFirstSequenceNumber,
  });
  expect(activation.status()).toBe(201);
  const afterActivation = readNumberingPersistence(e2eBackend);

  await expectSafeFailure(
    await activateSeries(e2eBackend.api, {
      currentRevision: overview.revision,
      firstSequenceNumber: minimumFirstSequenceNumber + 100,
    }),
    409,
  );
  expect(readNumberingPersistence(e2eBackend)).toEqual(afterActivation);
});

for (const fault of [
  {
    label: 'settings insert',
    operation: 'activateInvoiceNumberingSeriesSettings',
  },
  {
    label: 'active pointer update',
    operation: 'activateInvoiceNumberingSeriesPointer',
  },
  {
    label: 'transition event insert',
    operation: 'activateInvoiceNumberingSeriesEvent',
  },
] as const) {
  registerActivationRollbackScenario(fault.operation, fault.label);
}

test('INV-NUMBERING-SERIES-005 @concurrency keeps concurrent activations and approvals atomic', async ({
  e2eBackend,
}) => {
  const customerId = await seedNumberingPrerequisites(e2eBackend.api);
  const oldInvoice = await createApprovedInvoice(
    e2eBackend.api,
    customerId,
    'Concurrency baseline invoice',
  );
  const oldInvoicePersistence = readInvoicePersistence(
    e2eBackend,
    oldInvoice.id,
  );
  const overview = await getNumberingOverview(e2eBackend.api);
  const preview = await previewNewSeries(e2eBackend.api);
  const firstSequenceNumber =
    requireNumber(preview.minimumFirstSequenceNumber) + 100;
  const firstDraftId = await createInvoiceDraft(
    e2eBackend.api,
    customerId,
    'First concurrent invoice',
  );
  const secondDraftId = await createInvoiceDraft(
    e2eBackend.api,
    customerId,
    'Second concurrent invoice',
  );

  const [activationResponse, firstApproval, secondApproval] =
    await Promise.all([
      activateSeries(e2eBackend.api, {
        currentRevision: overview.revision,
        firstSequenceNumber,
      }),
      approveInvoiceDraft(e2eBackend.api, firstDraftId),
      approveInvoiceDraft(e2eBackend.api, secondDraftId),
    ]);

  expect(activationResponse.status()).toBe(201);
  expect(firstApproval.status()).toBe(200);
  expect(secondApproval.status()).toBe(200);

  const firstActiveSeriesKey = readActiveSeriesKey(e2eBackend);
  expect(firstActiveSeriesKey).not.toBe(oldInvoicePersistence.series_key);
  const invoicesAfterConcurrentApprovals =
    readInvoicePersistenceRows(e2eBackend);
  expect(invoicesAfterConcurrentApprovals).toHaveLength(3);
  expect(
    new Set(
      invoicesAfterConcurrentApprovals.map((row) => row.invoice_number),
    ).size,
  ).toBe(3);
  expect(
    invoicesAfterConcurrentApprovals.every(
      (row) =>
        row.series_key === oldInvoicePersistence.series_key ||
        row.series_key === firstActiveSeriesKey,
    ),
  ).toBe(true);

  const nextOverview = await getNumberingOverview(e2eBackend.api);
  const nextPreview = await previewNewSeries(e2eBackend.api);
  const nextFirstSequenceNumber =
    requireNumber(nextPreview.minimumFirstSequenceNumber) + 200;
  const sequencesBeforeCompetingActivations =
    readSequencePersistence(e2eBackend);
  const competingActivations = await Promise.all([
    activateSeries(e2eBackend.api, {
      currentRevision: nextOverview.revision,
      firstSequenceNumber: nextFirstSequenceNumber,
    }),
    activateSeries(e2eBackend.api, {
      currentRevision: nextOverview.revision,
      firstSequenceNumber: nextFirstSequenceNumber + 50,
    }),
  ]);

  expect(
    competingActivations.map((response) => response.status()).sort(),
  ).toEqual([201, 409]);
  expect(readSequencePersistence(e2eBackend)).toEqual(
    sequencesBeforeCompetingActivations,
  );
  expect(readNumberingSeriesEventCount(e2eBackend)).toBe(2);
  const finalActiveSeriesKey = readActiveSeriesKey(e2eBackend);
  expect(finalActiveSeriesKey).not.toBe(firstActiveSeriesKey);

  const afterTransitionInvoice = await createApprovedInvoice(
    e2eBackend.api,
    customerId,
    'Invoice definitely after competing transitions',
  );
  expect(
    readInvoicePersistence(e2eBackend, afterTransitionInvoice.id).series_key,
  ).toBe(finalActiveSeriesKey);
  const finalInvoices = readInvoicePersistenceRows(e2eBackend);
  expect(
    new Set(finalInvoices.map((row) => row.invoice_number)).size,
  ).toBe(finalInvoices.length);
});

test('INV-NUMBERING-SERIES-006 @critical reapproval preserves the original identity after a transition', async ({
  e2eBackend,
}) => {
  const customerId = await seedNumberingPrerequisites(e2eBackend.api);
  const invoice = await createApprovedInvoice(
    e2eBackend.api,
    customerId,
    'Reapproval source before transition',
  );
  const originalIdentity = readInvoicePersistence(e2eBackend, invoice.id);
  await activateNextSeries(e2eBackend);
  const sequencesBeforeReapproval = readSequencePersistence(e2eBackend);

  const reopenResponse = await e2eBackend.api.post(
    `/invoices/${invoice.id}/reopen-for-edit`,
  );
  expect(reopenResponse.status()).toBe(200);
  const reopenBody = (await reopenResponse.json()) as {
    invoiceDraftId: string;
    invoiceId: string;
  };
  expect(reopenBody.invoiceId).toBe(invoice.id);

  const reapprovalResponse = await approveInvoiceDraft(
    e2eBackend.api,
    reopenBody.invoiceDraftId,
  );
  expect(reapprovalResponse.status()).toBe(200);
  const reapprovalBody = (await reapprovalResponse.json()) as {
    approvedInvoice: { invoiceId: string; invoiceNumber: string };
  };

  expect(reapprovalBody.approvedInvoice.invoiceId).toBe(invoice.id);
  expect(reapprovalBody.approvedInvoice.invoiceNumber).toBe(invoice.number);
  expect(readInvoicePersistence(e2eBackend, invoice.id)).toEqual(
    originalIdentity,
  );
  expect(readSequencePersistence(e2eBackend)).toEqual(
    sequencesBeforeReapproval,
  );
});

test('INV-NUMBERING-SERIES-007 @critical approves a copied invoice in the new active series', async ({
  e2eBackend,
}) => {
  const customerId = await seedNumberingPrerequisites(e2eBackend.api);
  const sourceInvoice = await createApprovedInvoice(
    e2eBackend.api,
    customerId,
    'Copy source before transition',
  );
  await markInvoiceSent(e2eBackend.api, sourceInvoice.id);
  const sourceIdentity = readInvoicePersistence(
    e2eBackend,
    sourceInvoice.id,
  );
  const activeSeriesKey = await activateNextSeries(e2eBackend);
  const sequencesBeforeCopyApproval = readSequencePersistence(e2eBackend);

  const copyResponse = await e2eBackend.api.post(
    `/invoices/${sourceInvoice.id}/copy-to-draft`,
  );
  expect(copyResponse.status()).toBe(201);
  const copyBody = (await copyResponse.json()) as {
    invoiceDraft: { id: string };
  };
  const approvalResponse = await approveInvoiceDraft(
    e2eBackend.api,
    copyBody.invoiceDraft.id,
  );
  expect(approvalResponse.status()).toBe(200);
  const approvalBody = (await approvalResponse.json()) as {
    approvedInvoice: { invoiceId: string; invoiceNumber: string };
  };
  const copiedIdentity = readInvoicePersistence(
    e2eBackend,
    approvalBody.approvedInvoice.invoiceId,
  );

  expect(copiedIdentity).toMatchObject({
    invoice_kind: 'standard',
    series_key: activeSeriesKey,
  });
  expect(copiedIdentity.id).not.toBe(sourceInvoice.id);
  expect(copiedIdentity.invoice_number).not.toBe(sourceInvoice.number);
  expect(readInvoicePersistence(e2eBackend, sourceInvoice.id)).toEqual(
    sourceIdentity,
  );
  expect(readSequencePersistence(e2eBackend)).not.toEqual(
    sequencesBeforeCopyApproval,
  );
  expect(readNumberingSeriesEventCount(e2eBackend)).toBe(1);
});

function registerActivationRollbackScenario(
  operation: ActivationFaultOperation,
  label: string,
): void {
  test.describe(`invoice numbering series ${label} fault`, () => {
    test.use({
      e2eFaultPlan: {
        failOnCall: 1,
        kind: 'databaseWriteFailed',
        operation,
      },
    });

    test(`INV-NUMBERING-SERIES-004 @fault rolls back a failed ${label}`, async ({
      e2eBackend,
    }) => {
      const customerId = await seedNumberingPrerequisites(e2eBackend.api);
      await createApprovedInvoice(
        e2eBackend.api,
        customerId,
        'Invoice before failed numbering transition',
      );
      const baseline = readNumberingPersistence(e2eBackend);
      const overview = await getNumberingOverview(e2eBackend.api);
      const preview = await previewNewSeries(e2eBackend.api);

      const response = await activateSeries(e2eBackend.api, {
        currentRevision: overview.revision,
        firstSequenceNumber: requireNumber(
          preview.minimumFirstSequenceNumber,
        ),
      });

      await expectSafeFailure(response, 500);
      expect(readNumberingPersistence(e2eBackend)).toEqual(baseline);
      expect((await e2eBackend.api.get('/health')).status()).toBe(200);
    });
  });
}

async function seedNumberingPrerequisites(
  api: APIRequestContext,
): Promise<string> {
  expect(
    (
      await api.put('/company-settings', {
        data: createSyntheticCompanySettingsInput(),
      })
    ).status(),
  ).toBe(200);
  expect(
    (
      await api.put('/invoice-numbering-settings', {
        data: {
          firstSequenceNumber: 1,
          fiscalYearStartMonth: 1,
          mode: 'calendarYearSequence',
          sequencePadding: 4,
        },
      })
    ).status(),
  ).toBe(200);
  const customerResponse = await api.post('/customers', {
    data: createSyntheticCustomerInput({
      customerNumber: 'E2E-SERIES-1001',
      name: 'Numbering Series Customer Oy',
    }),
  });
  expect(customerResponse.status()).toBe(201);
  const customerBody = (await customerResponse.json()) as {
    customer: { id: string };
  };

  return customerBody.customer.id;
}

async function createApprovedInvoice(
  api: APIRequestContext,
  customerId: string,
  subject: string,
): Promise<ApprovedInvoiceIdentity> {
  const draftId = await createInvoiceDraft(api, customerId, subject);
  const response = await approveInvoiceDraft(api, draftId);
  expect(response.status()).toBe(200);
  const body = (await response.json()) as {
    approvedInvoice: { invoiceId: string; invoiceNumber: string };
  };

  return {
    id: body.approvedInvoice.invoiceId,
    number: body.approvedInvoice.invoiceNumber,
  };
}

async function createFullCreditInvoice(
  api: APIRequestContext,
  invoiceId: string,
): Promise<ApprovedInvoiceIdentity> {
  const draftResponse = await api.post(
    `/invoices/${invoiceId}/credit-draft`,
  );
  expect(draftResponse.status()).toBe(201);
  const draftBody = (await draftResponse.json()) as {
    creditInvoiceDraft: { id: string };
  };
  const approvalResponse = await api.post(
    `/invoice-drafts/${draftBody.creditInvoiceDraft.id}/approve-credit`,
  );
  expect(approvalResponse.status()).toBe(200);
  const approvalBody = (await approvalResponse.json()) as {
    approvedInvoice: { invoiceId: string; invoiceNumber: string };
  };

  return {
    id: approvalBody.approvedInvoice.invoiceId,
    number: approvalBody.approvedInvoice.invoiceNumber,
  };
}

async function markInvoiceSent(
  api: APIRequestContext,
  invoiceId: string,
): Promise<void> {
  const pdfResponse = await api.post(`/invoices/${invoiceId}/pdf`);
  expect([200, 201]).toContain(pdfResponse.status());
  const deliveryResponse = await api.post(
    `/invoices/${invoiceId}/mark-sent`,
    { data: { deliveryMethod: 'manual' } },
  );
  expect(deliveryResponse.status()).toBe(200);
}

async function createInvoiceDraft(
  api: APIRequestContext,
  customerId: string,
  subject: string,
): Promise<string> {
  const response = await api.post('/invoice-drafts', {
    data: createSyntheticInvoiceDraftInput(customerId, { subject }),
  });
  expect(response.status()).toBe(201);
  const body = (await response.json()) as {
    invoiceDraft: { id: string };
  };

  return body.invoiceDraft.id;
}

function approveInvoiceDraft(
  api: APIRequestContext,
  draftId: string,
): Promise<APIResponse> {
  return api.post(`/invoice-drafts/${draftId}/approve`);
}

async function getNumberingOverview(
  api: APIRequestContext,
): Promise<NumberingSeriesOverview> {
  const response = await api.get('/invoice-numbering-series');
  expect(response.status()).toBe(200);
  return readOverview(await response.json());
}

async function previewNewSeries(
  api: APIRequestContext,
): Promise<NumberingSeriesPreview> {
  const query = new URLSearchParams({
    fiscalYearStartMonth: '1',
    mode: 'calendarYearSequence',
    previewDate,
    sequencePadding: '4',
  });
  const response = await api.get(
    `/invoice-numbering-series/activation-preview?${query.toString()}`,
  );
  expect(response.status()).toBe(200);
  const body = (await response.json()) as {
    invoiceNumberingSeriesActivationPreview: NumberingSeriesPreview;
  };

  return body.invoiceNumberingSeriesActivationPreview;
}

function activateSeries(
  api: APIRequestContext,
  input: {
    confirmation?: string;
    currentRevision: number;
    firstSequenceNumber: number;
  },
): Promise<APIResponse> {
  return api.post('/invoice-numbering-series/activate', {
    data: createActivationRequest(input),
  });
}

function createActivationRequest(input: {
  confirmation?: string;
  currentRevision: number;
  firstSequenceNumber: number;
}): Record<string, unknown> {
  return {
    confirmation: input.confirmation ?? activationConfirmation,
    currentRevision: input.currentRevision,
    firstSequenceNumber: input.firstSequenceNumber,
    fiscalYearStartMonth: 1,
    mode: 'calendarYearSequence',
    reasonCode: 'accountingRequirement',
    reasonNote: 'Synthetic E2E numbering transition',
    sequencePadding: 4,
  };
}

function readOverview(value: unknown): NumberingSeriesOverview {
  const body = value as {
    invoiceNumberingSeriesOverview?: NumberingSeriesOverview;
  };
  if (body.invoiceNumberingSeriesOverview === undefined) {
    throw new Error('E2E numbering series overview is invalid.');
  }
  expect(body.invoiceNumberingSeriesOverview.activationConfirmationText).toBe(
    activationConfirmation,
  );
  return body.invoiceNumberingSeriesOverview;
}

function readNumberingPersistence(e2eBackend: IsolatedBackendHarness) {
  return {
    activeSeries: readE2eSqliteRows(
      e2eBackend.paths.databaseFilePath,
      `
        SELECT active_series_key, revision, updated_at, updated_by
        FROM invoice_numbering_active_series
      `,
    ),
    events: readE2eSqliteRows(
      e2eBackend.paths.databaseFilePath,
      'SELECT * FROM invoice_numbering_series_events ORDER BY id',
    ),
    invoice: readE2eSqliteRows(
      e2eBackend.paths.databaseFilePath,
      `
        SELECT
          id,
          invoice_number,
          reference_number,
          sequence_number,
          sequence_scope,
          series_key,
          invoice_kind,
          credited_invoice_id
        FROM invoices
        ORDER BY id
      `,
    )[0],
    sequences: readE2eSqliteRows(
      e2eBackend.paths.databaseFilePath,
      `
        SELECT series_key, sequence_scope, last_sequence_number
        FROM invoice_number_sequences
        ORDER BY series_key, sequence_scope
      `,
    ),
    settings: readE2eSqliteRows(
      e2eBackend.paths.databaseFilePath,
      `
        SELECT
          series_key,
          mode,
          fiscal_year_start_month,
          sequence_padding,
          first_sequence_number,
          created_at,
          updated_at
        FROM invoice_numbering_settings
        ORDER BY series_key
      `,
    ),
  };
}

function readInvoicePersistence(
  e2eBackend: IsolatedBackendHarness,
  invoiceId: string,
): Record<string, unknown> {
  const rows = readE2eSqliteRows(
    e2eBackend.paths.databaseFilePath,
    `
      SELECT
        id,
        invoice_number,
        reference_number,
        sequence_number,
        sequence_scope,
        series_key,
        invoice_kind,
        credited_invoice_id
      FROM invoices
      WHERE id = ?
    `,
    invoiceId,
  );
  expect(rows).toHaveLength(1);
  return rows[0] ?? {};
}

function readInvoicePersistenceRows(
  e2eBackend: IsolatedBackendHarness,
): Record<string, unknown>[] {
  return readE2eSqliteRows(
    e2eBackend.paths.databaseFilePath,
    `
      SELECT
        id,
        invoice_number,
        reference_number,
        sequence_number,
        sequence_scope,
        series_key,
        invoice_kind,
        credited_invoice_id
      FROM invoices
      ORDER BY id
    `,
  );
}

function readSequencePersistence(
  e2eBackend: IsolatedBackendHarness,
): Record<string, unknown>[] {
  return readE2eSqliteRows(
    e2eBackend.paths.databaseFilePath,
    `
      SELECT series_key, sequence_scope, last_sequence_number
      FROM invoice_number_sequences
      ORDER BY series_key, sequence_scope
    `,
  );
}

function readActiveSeriesKey(e2eBackend: IsolatedBackendHarness): string {
  const rows = readE2eSqliteRows(
    e2eBackend.paths.databaseFilePath,
    `
      SELECT active_series_key
      FROM invoice_numbering_active_series
    `,
  );
  expect(rows).toHaveLength(1);
  return requireString(rows[0]?.active_series_key);
}

function readNumberingSeriesEventCount(
  e2eBackend: IsolatedBackendHarness,
): number {
  const rows = readE2eSqliteRows(
    e2eBackend.paths.databaseFilePath,
    `
      SELECT COUNT(*) AS count
      FROM invoice_numbering_series_events
    `,
  );
  return requireNumberValue(rows[0]?.count);
}

async function activateNextSeries(
  e2eBackend: IsolatedBackendHarness,
): Promise<string> {
  const overview = await getNumberingOverview(e2eBackend.api);
  const preview = await previewNewSeries(e2eBackend.api);
  const response = await activateSeries(e2eBackend.api, {
    currentRevision: overview.revision,
    firstSequenceNumber: requireNumber(preview.minimumFirstSequenceNumber),
  });
  expect(response.status()).toBe(201);
  return readActiveSeriesKey(e2eBackend);
}

async function expectSafeFailure(
  response: APIResponse,
  expectedStatus: number,
): Promise<void> {
  expect(response.status()).toBe(expectedStatus);
  const text = await response.text();
  expect(text).not.toContain('seriesKey');
  expect(text).not.toContain('dev-company');
  expect(text).not.toContain('local-owner');
  expect(text).not.toContain('reasonNote');
  expect(text).not.toContain('SQL');
  expect(text).not.toContain('stack');
}

function requireNumber(value: number | null): number {
  if (value === null) {
    throw new Error('E2E numbering series has no safe sequence number.');
  }
  return value;
}

function requireNumberValue(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new Error('E2E numeric persistence value is invalid.');
  }
  return value;
}

function requireString(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error('E2E numbering series key is invalid.');
  }
  return value;
}
