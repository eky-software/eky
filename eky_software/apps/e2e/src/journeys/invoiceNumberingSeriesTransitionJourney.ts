import type { APIRequestContext, Page } from '@playwright/test';
import { expect } from '@playwright/test';

import { readE2eSqliteRows } from '../assertions/readE2eSqliteRows.js';
import {
  createSyntheticCompanySettingsInput,
  createSyntheticCustomerInput,
  createSyntheticInvoiceDraftInput,
} from '../data/syntheticBusinessInputs.js';

const activationConfirmation =
  'OTA UUSI LASKUNUMEROSARJA KÄYTTÖÖN';

export interface InvoiceNumberingSeriesTransitionJourneyHarness {
  api: APIRequestContext;
  databaseFilePath: string;
  page: Page;
}

interface SeededNumberingSeriesTransition {
  invoiceId: string;
  invoiceNumber: string;
}

export async function seedNumberingSeriesTransitionJourney(
  harness: InvoiceNumberingSeriesTransitionJourneyHarness,
): Promise<SeededNumberingSeriesTransition> {
  await requireStatus(
    harness.api.put('/company-settings', {
      data: createSyntheticCompanySettingsInput(),
    }),
    200,
    'company settings',
  );
  await requireStatus(
    harness.api.put('/invoice-numbering-settings', {
      data: {
        firstSequenceNumber: 1,
        fiscalYearStartMonth: 1,
        mode: 'calendarYearSequence',
        sequencePadding: 4,
      },
    }),
    200,
    'invoice numbering settings',
  );

  const customerResponse = await requireStatus(
    harness.api.post('/customers', {
      data: createSyntheticCustomerInput({
        customerNumber: 'E2E-SERIES-UI-1',
        name: 'Numbering Transition UI Customer Oy',
      }),
    }),
    201,
    'customer',
  );
  const customerId = readNestedString(
    await customerResponse.json(),
    'customer',
    'id',
  );
  const draftResponse = await requireStatus(
    harness.api.post('/invoice-drafts', {
      data: createSyntheticInvoiceDraftInput(customerId, {
        subject: 'Invoice before UI numbering transition',
      }),
    }),
    201,
    'invoice draft',
  );
  const draftId = readNestedString(
    await draftResponse.json(),
    'invoiceDraft',
    'id',
  );
  const approvalResponse = await requireStatus(
    harness.api.post(`/invoice-drafts/${draftId}/approve`),
    200,
    'invoice approval',
  );
  const approvalBody = await approvalResponse.json();

  return {
    invoiceId: readNestedString(
      approvalBody,
      'approvedInvoice',
      'invoiceId',
    ),
    invoiceNumber: readNestedString(
      approvalBody,
      'approvedInvoice',
      'invoiceNumber',
    ),
  };
}

export async function activateInvoiceNumberingSeriesThroughUi(
  harness: InvoiceNumberingSeriesTransitionJourneyHarness,
  seeded: SeededNumberingSeriesTransition,
): Promise<void> {
  const originalInvoice = readInvoiceIdentity(
    harness.databaseFilePath,
    seeded.invoiceId,
  );
  const sequencesBefore = readSequences(harness.databaseFilePath);

  await harness.page
    .getByRole('button', { name: 'Oma yritys', exact: true })
    .click();
  await expect(
    harness.page.getByRole('heading', {
      level: 2,
      name: 'Laskunumerointi',
    }),
  ).toBeVisible();
  await expect(
    harness.page.getByText(
      'Numerointia on jo käytetty. Asetuksia ei voi muuttaa normaalisti, jotta laskunumerohistoria ei rikkoudu.',
    ),
  ).toHaveCount(0);

  const previewResponse = harness.page.waitForResponse(
    (response) =>
      response.request().method() === 'GET' &&
      new URL(response.url()).pathname ===
        '/invoice-numbering-series/activation-preview',
  );
  await harness.page
    .getByRole('button', { name: 'Laske turvallinen aloitusnumero' })
    .click();
  expect((await previewResponse).status()).toBe(200);

  const firstSequenceNumber = harness.page.getByLabel(
    'Uuden sarjan ensimmäinen numero',
  );
  await expect(firstSequenceNumber).not.toHaveValue('');
  await harness.page
    .getByLabel('Muutoksen syy')
    .selectOption('accountingRequirement');
  await harness.page
    .getByLabel('Syyn tarkennus (valinnainen)')
    .fill('Synteettinen E2E numerointisarjan vaihto');
  await harness.page
    .getByRole('button', { name: 'Jatka vahvistukseen' })
    .click();

  const activateButton = harness.page.getByRole('button', {
    name: 'Ota uusi sarja käyttöön',
  });
  await expect(activateButton).toBeDisabled();
  await harness.page
    .getByLabel(/Kirjoita vahvistusteksti täsmälleen tässä muodossa:/)
    .fill(activationConfirmation);
  await expect(activateButton).toBeEnabled();

  const activateResponse = harness.page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname ===
        '/invoice-numbering-series/activate',
  );
  await activateButton.click();
  expect((await activateResponse).status()).toBe(201);
  await expect(
    harness.page.getByText('Uusi laskunumerosarja otettiin käyttöön.'),
  ).toBeVisible();

  expect(
    readInvoiceIdentity(harness.databaseFilePath, seeded.invoiceId),
  ).toEqual(originalInvoice);
  expect(readSequences(harness.databaseFilePath)).toEqual(sequencesBefore);
  expect(
    readE2eSqliteRows(
      harness.databaseFilePath,
      'SELECT COUNT(*) AS count FROM invoice_numbering_series_events',
    ),
  ).toEqual([{ count: 1 }]);
  expect(
    readE2eSqliteRows(
      harness.databaseFilePath,
      `
        SELECT revision
        FROM invoice_numbering_active_series
      `,
    ),
  ).toEqual([{ revision: 2 }]);
  expect(await harness.page.locator('body').innerText()).not.toContain(
    readActiveSeriesKey(harness.databaseFilePath),
  );
}

function readInvoiceIdentity(
  databaseFilePath: string,
  invoiceId: string,
): Record<string, unknown> {
  const rows = readE2eSqliteRows(
    databaseFilePath,
    `
      SELECT
        id,
        invoice_number,
        reference_number,
        sequence_number,
        sequence_scope,
        series_key
      FROM invoices
      WHERE id = ?
    `,
    invoiceId,
  );
  if (rows.length !== 1 || rows[0] === undefined) {
    throw new Error('E2E invoice identity is missing.');
  }
  return rows[0];
}

function readSequences(
  databaseFilePath: string,
): Array<Record<string, unknown>> {
  return readE2eSqliteRows(
    databaseFilePath,
    `
      SELECT series_key, sequence_scope, last_sequence_number
      FROM invoice_number_sequences
      ORDER BY series_key, sequence_scope
    `,
  );
}

function readActiveSeriesKey(databaseFilePath: string): string {
  const rows = readE2eSqliteRows(
    databaseFilePath,
    'SELECT active_series_key FROM invoice_numbering_active_series',
  );
  const key = rows[0]?.active_series_key;
  if (rows.length !== 1 || typeof key !== 'string' || key.length === 0) {
    throw new Error('E2E active numbering series is invalid.');
  }
  return key;
}

async function requireStatus(
  responsePromise: ReturnType<APIRequestContext['get']>,
  expectedStatus: number,
  operation: string,
) {
  const response = await responsePromise;
  if (response.status() !== expectedStatus) {
    throw new Error(`E2E ${operation} failed safely.`);
  }
  return response;
}

function readNestedString(
  value: unknown,
  parentField: string,
  valueField: string,
): string {
  if (
    typeof value !== 'object' ||
    value === null ||
    !(parentField in value)
  ) {
    throw new Error('E2E response shape is invalid.');
  }
  const parent = (value as Record<string, unknown>)[parentField];
  if (
    typeof parent !== 'object' ||
    parent === null ||
    !(valueField in parent)
  ) {
    throw new Error('E2E response shape is invalid.');
  }
  const nestedValue = (parent as Record<string, unknown>)[valueField];
  if (typeof nestedValue !== 'string' || nestedValue.length === 0) {
    throw new Error('E2E response value is invalid.');
  }
  return nestedValue;
}
