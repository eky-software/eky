import type { Page, Response } from '@playwright/test';

import {
  createSyntheticCompanySettingsInput,
  createSyntheticCustomerInput,
} from '../data/syntheticBusinessInputs.js';
import type { IsolatedWebHarness } from '../fixtures/isolatedWebTest.js';

export interface SeededInvoiceCustomer {
  customerId: string;
  customerName: string;
  customerNumber: string;
}

export interface CreatedInvoiceDraft {
  id: string;
  grossTotalCents: number;
  netTotalCents: number;
  vatTotalCents: number;
}

export interface ApprovedInvoiceIdentity {
  invoiceId: string;
  invoiceNumber: string;
}

interface InvoiceLineUiInput {
  description: string;
  quantity: string;
  unitPrice: string;
}

export interface CreateInvoiceThroughUiInput {
  customerId: string;
  invoiceDate?: string;
  lines?: InvoiceLineUiInput[];
  note?: string;
  performancePeriod?:
    | { type: 'singleDate'; date: string }
    | { type: 'dateRange'; startDate: string; endDate: string };
  subject: string;
  taxTreatment?: 'normalVat' | 'reverseChargeConstruction';
}

export async function seedInvoiceJourneyPrerequisites(
  e2eWeb: IsolatedWebHarness,
  options: {
    customerInput?: Record<string, unknown>;
    settingsInput?: Record<string, unknown>;
  } = {},
): Promise<SeededInvoiceCustomer> {
  const settingsResponse = await e2eWeb.api.put('/company-settings', {
    data: createSyntheticCompanySettingsInput({
      emailDeliveryProvider: 'dnaSmtp',
      emailSenderAddress: 'billing@example.invalid',
      emailSenderName: 'Synthetic Builder Oy',
      emailTestRecipientOverride: 'delivery-test@example.invalid',
      emailUsername: 'billing@example.invalid',
      ...(options.settingsInput ?? {}),
    }),
  });
  assertHttpStatus(settingsResponse.status(), 200, 'company settings');

  const numberingResponse = await e2eWeb.api.put(
    '/invoice-numbering-settings',
    {
      data: {
        firstSequenceNumber: 1,
        fiscalYearStartMonth: 1,
        mode: 'calendarYearSequence',
        sequencePadding: 4,
      },
    },
  );
  assertHttpStatus(numberingResponse.status(), 200, 'invoice numbering settings');

  const secretResponse = await e2eWeb.api.put(
    '/company-settings/email-secret',
    {
      data: { secret: 'synthetic-e2e-secret' },
    },
  );
  assertHttpStatus(secretResponse.status(), 200, 'email secret');

  const customerInput = createSyntheticCustomerInput({
    customerNumber: 'E2E-INV-1001',
    email: 'invoice-recipient@example.invalid',
    name: 'Synthetic Invoice Customer Oy',
    ...(options.customerInput ?? {}),
  });
  const customerResponse = await e2eWeb.api.post('/customers', {
    data: customerInput,
  });
  assertHttpStatus(customerResponse.status(), 201, 'customer');
  const customerBody = (await customerResponse.json()) as {
    customer: {
      customerNumber: string;
      id: string;
      name: string;
    };
  };

  return {
    customerId: customerBody.customer.id,
    customerName: customerBody.customer.name,
    customerNumber: customerBody.customer.customerNumber,
  };
}

export async function createInvoiceDraftThroughUi(
  page: Page,
  input: CreateInvoiceThroughUiInput,
): Promise<CreatedInvoiceDraft> {
  const lines = input.lines ?? [
    {
      description: 'Synthetic installation work',
      quantity: '2',
      unitPrice: '100',
    },
    {
      description: 'Synthetic materials',
      quantity: '1,5',
      unitPrice: '20',
    },
  ];

  await openNewInvoiceForm(page);
  await page
    .getByRole('combobox', { name: 'Asiakas', exact: true })
    .selectOption(input.customerId);
  await page.getByLabel('Laskun päiväys').fill(input.invoiceDate ?? '2026-07-29');
  await page.getByLabel('Aihe').fill(input.subject);
  if (input.note !== undefined) {
    await page.getByLabel('Lisätieto').fill(input.note);
  }
  if (input.performancePeriod?.type === 'singleDate') {
    await page
      .getByLabel('Suoritusajankohta')
      .selectOption('singleDate');
    await page.getByLabel('Suorituspäivä').fill(input.performancePeriod.date);
  }
  if (input.performancePeriod?.type === 'dateRange') {
    await page
      .getByLabel('Suoritusajankohta')
      .selectOption('dateRange');
    await page
      .getByLabel('Jakson alkupäivä')
      .fill(input.performancePeriod.startDate);
    await page
      .getByLabel('Jakson loppupäivä')
      .fill(input.performancePeriod.endDate);
  }
  if (input.taxTreatment === 'reverseChargeConstruction') {
    await page.getByText('Laskun lisäasetukset', { exact: true }).click();
    await page
      .getByLabel('Verokäsittely')
      .selectOption('reverseChargeConstruction');
  }

  const firstLine = lines[0];
  if (firstLine === undefined) {
    throw new Error('Invoice journey requires at least one line.');
  }

  const createResponsePromise = waitForInvoiceMutation(page, 'POST');
  await fillInvoiceLine(page, 1, firstLine);
  const createResponse = await createResponsePromise;
  assertHttpStatus(createResponse.status(), 201, 'invoice draft autosave');
  let draft = await readDraftResponse(createResponse);

  for (const [index, line] of lines.slice(1).entries()) {
    await page.getByRole('button', { name: 'Lisää rivi' }).click();
    const updateResponsePromise = waitForInvoiceMutation(page, 'PUT');
    await fillInvoiceLine(page, index + 2, line);
    const updateResponse = await updateResponsePromise;
    assertHttpStatus(updateResponse.status(), 200, 'invoice draft update');
    draft = await readDraftResponse(updateResponse);
  }

  return draft;
}

export async function openInvoicingWorkspace(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Laskutus' }).click();
  await page
    .getByRole('heading', { level: 2, name: 'Laskuluonnoslista' })
    .waitFor();
}

export async function openInvoiceDraftFromList(
  page: Page,
  subject: string,
): Promise<void> {
  await page.getByRole('button', { name: subject, exact: true }).click();
  await page
    .getByRole('heading', { level: 2, name: 'Muokkaa laskuluonnosta' })
    .waitFor();
}

export async function openApprovedInvoiceFromList(
  page: Page,
  invoiceNumber: string,
): Promise<void> {
  await page
    .getByRole('button', {
      name: `Laskunumero ${invoiceNumber}`,
      exact: true,
    })
    .click();
  await page
    .getByRole('heading', {
      level: 2,
      name: `Lasku ${invoiceNumber}`,
    })
    .waitFor();
}

export async function approveCurrentInvoiceDraft(
  page: Page,
  options: { clickCount?: number; reverseCharge?: boolean } = {},
): Promise<ApprovedInvoiceIdentity> {
  await page.getByRole('button', { name: 'Hyväksy laskuksi' }).click();
  const confirmation = page.getByRole('region', {
    name: 'Hyväksynnän vahvistus',
  });
  await confirmation.waitFor();

  if (options.reverseCharge) {
    const reverseChargeConfirmation =
      confirmation.getByRole('checkbox');
    await reverseChargeConfirmation.check();
    if (!(await reverseChargeConfirmation.isChecked())) {
      throw new Error('Reverse charge approval confirmation was not checked.');
    }
  }

  const approvalResponsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      /\/invoice-drafts\/[^/]+\/approve$/.test(
        new URL(response.url()).pathname,
      ),
  );
  await confirmation
    .getByRole('button', { name: 'Hyväksy laskuksi' })
    .click({ clickCount: options.clickCount ?? 1 });
  const approvalResponse = await approvalResponsePromise;
  assertHttpStatus(approvalResponse.status(), 200, 'invoice approval');
  const responseBody = (await approvalResponse.json()) as {
    approvedInvoice: {
      invoiceId: string;
      invoiceNumber: string;
    };
  };

  await page
    .getByRole('button', { name: 'Avaa hyväksytty lasku' })
    .click();
  await page
    .getByRole('heading', {
      name: `Lasku ${responseBody.approvedInvoice.invoiceNumber}`,
    })
    .waitFor();

  return responseBody.approvedInvoice;
}

export async function cancelCurrentApprovedInvoice(
  page: Page,
  invoiceNumber: string,
): Promise<Response> {
  await page.getByRole('button', { name: 'Peru lasku' }).click();
  await page.getByLabel('Vahvista laskunumero').fill(invoiceNumber);
  await page
    .getByLabel('Peruutuksen syy')
    .fill('Synthetic E2E cancellation reason');
  const responsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      /\/invoices\/[^/]+\/cancel$/.test(new URL(response.url()).pathname),
  );
  await page.getByRole('button', { name: 'Vahvista peruutus' }).click();
  const response = await responsePromise;
  assertHttpStatus(response.status(), 200, 'invoice cancellation');
  await page
    .getByRole('table', { name: 'Perutut laskut' })
    .getByText('Peruutettu', { exact: true })
    .waitFor();

  return response;
}

export async function createCurrentInvoicePdf(
  page: Page,
): Promise<Response | null> {
  const openPdfButton = page.getByRole('button', { name: 'Avaa PDF' });
  if (await openPdfButton.isVisible()) {
    return null;
  }

  const responsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      /\/invoices\/[^/]+\/pdf$/.test(new URL(response.url()).pathname),
  );
  await page.getByRole('button', { name: 'Luo PDF' }).click();
  const response = await responsePromise;
  assertHttpStatus(response.status(), 201, 'approved invoice PDF');
  await openPdfButton.waitFor();

  return response;
}

export async function sendCurrentInvoiceThroughFakeSmtp(
  page: Page,
  options: { clickCount?: number } = {},
): Promise<Response> {
  await page.getByRole('button', { name: 'Valmistele sähköposti' }).click();
  await page.getByRole('heading', { name: 'Sähköpostin esikatselu' }).waitFor();

  const responsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      /\/invoices\/[^/]+\/email\/smtp\/send$/.test(
        new URL(response.url()).pathname,
      ),
  );
  await page
    .getByRole('button', { name: 'Lähetä lasku' })
    .click({ clickCount: options.clickCount ?? 1 });
  const response = await responsePromise;
  assertHttpStatus(response.status(), 200, 'invoice email delivery');
  await page
    .getByText('Lasku lähetettiin ja merkittiin lähetetyksi.')
    .waitFor();

  return response;
}

async function openNewInvoiceForm(page: Page): Promise<void> {
  await openInvoicingWorkspace(page);
  await page.getByRole('button', { name: 'Uusi lasku' }).click();
  await page
    .getByRole('heading', { level: 2, name: 'Uusi lasku' })
    .waitFor();
}

async function fillInvoiceLine(
  page: Page,
  position: number,
  input: InvoiceLineUiInput,
): Promise<void> {
  const row = page.getByRole('group', { name: `Rivi ${position}` });
  await row.getByLabel('Nimike').fill(input.description);
  await row.getByLabel('Määrä').fill(input.quantity);
  await row.getByLabel('Yksikköhinta').fill(input.unitPrice);
}

function waitForInvoiceMutation(
  page: Page,
  method: 'POST' | 'PUT',
): Promise<Response> {
  return page.waitForResponse(
    (response) =>
      response.request().method() === method &&
      (method === 'POST'
        ? new URL(response.url()).pathname === '/invoice-drafts'
        : /\/invoice-drafts\/[^/]+$/.test(
            new URL(response.url()).pathname,
          )),
  );
}

async function readDraftResponse(
  response: Response,
): Promise<CreatedInvoiceDraft> {
  const responseBody = (await response.json()) as {
    invoiceDraft: {
      id: string;
      totals: {
        grossTotalCents: number;
        netTotalCents: number;
        vatTotalCents: number;
      };
    };
  };

  return {
    id: responseBody.invoiceDraft.id,
    grossTotalCents: responseBody.invoiceDraft.totals.grossTotalCents,
    netTotalCents: responseBody.invoiceDraft.totals.netTotalCents,
    vatTotalCents: responseBody.invoiceDraft.totals.vatTotalCents,
  };
}

function assertHttpStatus(
  actual: number,
  expected: number,
  operation: string,
): void {
  if (actual !== expected) {
    throw new Error(
      `Unexpected ${operation} response status: ${actual}; expected ${expected}.`,
    );
  }
}
