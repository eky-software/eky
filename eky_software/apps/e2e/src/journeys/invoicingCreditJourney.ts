import type { Page, Response } from '@playwright/test';

import { assertApprovedInvoicePdfMetadataResponse } from './invoicingWebJourney.js';

export interface ApprovedCreditInvoiceIdentity {
  draftId: string;
  invoiceId: string;
  invoiceNumber: string;
}

export async function createCreditDraftFromCurrentInvoice(
  page: Page,
): Promise<string> {
  await page.getByRole('button', { name: 'Hyvitä lasku' }).click();
  const confirmation = page.getByRole('region', {
    name: /Luodaanko tästä lähetetystä laskusta hyvitysluonnos/,
  });
  await confirmation.waitFor();

  const responsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      /\/invoices\/[^/]+\/credit-draft$/.test(
        new URL(response.url()).pathname,
      ),
  );
  await confirmation
    .getByRole('button', { name: 'Hyvitä lasku' })
    .click();
  const response = await responsePromise;
  assertHttpStatus(response, 201, 'credit invoice draft creation');
  const body = (await response.json()) as {
    creditInvoiceDraft: { id: string };
  };
  await page
    .getByRole('heading', { level: 2, name: 'Muokkaa hyvitysluonnosta' })
    .waitFor();

  return body.creditInvoiceDraft.id;
}

export async function setPartialSourceCredit(
  page: Page,
  input: {
    creditedQuantity: string;
    excludedLinePositions?: number[];
  },
): Promise<void> {
  const firstLine = page.getByRole('group', { name: 'Rivi 1' });
  await firstLine
    .getByLabel('Hyvitettävä määrä')
    .fill(input.creditedQuantity);

  for (const position of input.excludedLinePositions ?? []) {
    await page
      .getByRole('group', { name: `Rivi ${position}` })
      .getByRole('checkbox', { name: 'Hyvitä rivi' })
      .uncheck();
  }
}

export async function approveCurrentCreditDraft(
  page: Page,
): Promise<ApprovedCreditInvoiceIdentity> {
  await page
    .getByRole('button', { name: 'Hyväksy hyvityslasku', exact: true })
    .click();
  const confirmation = page.getByRole('region', {
    name: 'Hyväksytäänkö hyvityslasku?',
  });
  await confirmation.waitFor();

  const saveResponsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === 'PUT' &&
      /\/invoice-drafts\/[^/]+\/credit$/.test(
        new URL(response.url()).pathname,
      ),
  );
  const approvalResponsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      /\/invoice-drafts\/[^/]+\/approve-credit$/.test(
        new URL(response.url()).pathname,
      ),
  );
  const pdfMetadataResponsePromise = page.waitForResponse(async (response) => {
    const pathname = new URL(response.url()).pathname;
    if (response.request().method() !== 'GET' ||
      !/\/invoices\/[^/]+\/pdf\/metadata$/.test(pathname)) return false;
    const approvalResponse = await approvalResponsePromise;
    if (approvalResponse.status() !== 200) return false;
    const body = (await approvalResponse.json()) as {
      approvedInvoice: ApprovedCreditInvoiceIdentity;
    };
    return pathname === `/invoices/${encodeURIComponent(body.approvedInvoice.invoiceId)}/pdf/metadata`;
  });
  // A cancelled pending observation must not mask an earlier approval failure.
  void pdfMetadataResponsePromise.catch(() => undefined);
  await confirmation
    .getByRole('button', { name: 'Hyväksy hyvityslasku' })
    .click();
  const [saveResponse, approvalResponse] = await Promise.all([
    saveResponsePromise,
    approvalResponsePromise,
  ]);
  assertHttpStatus(saveResponse, 200, 'credit invoice draft update');
  assertHttpStatus(approvalResponse, 200, 'credit invoice approval');
  const body = (await approvalResponse.json()) as {
    approvedInvoice: ApprovedCreditInvoiceIdentity;
  };
  await page
    .getByRole('heading', {
      level: 2,
      name: `Hyvityslasku ${body.approvedInvoice.invoiceNumber}`,
    })
    .waitFor();
  await assertApprovedInvoicePdfMetadataResponse(pdfMetadataResponsePromise);
  const pdfMetadataResponse = await pdfMetadataResponsePromise;
  await page.getByRole('button', {
    name: pdfMetadataResponse.status() === 200 ? 'Avaa PDF' : 'Luo PDF',
    exact: true,
  }).waitFor();

  return body.approvedInvoice;
}

function assertHttpStatus(
  response: Response,
  expected: number,
  operation: string,
): void {
  if (response.status() !== expected) {
    throw new Error(
      `Unexpected ${operation} response status: ${response.status()}; expected ${expected}.`,
    );
  }
}
