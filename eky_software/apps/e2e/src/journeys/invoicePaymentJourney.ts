import type { Page, Response } from '@playwright/test';

export interface InvoicePaymentMutationResponse {
  invoiceId: string;
  invoiceNumber: string;
  paidAmountCents: number | null;
  paidOn: string | null;
  paymentSource: 'manual' | null;
  paymentState: 'paid' | 'unpaid';
}

export async function markCurrentInvoicePaidThroughUi(
  page: Page,
  paidOn: string,
  options: { clickCount?: number } = {},
): Promise<InvoicePaymentMutationResponse> {
  await page.getByRole('button', { name: 'Merkitse maksetuksi' }).click();
  const paymentPanel = page.getByRole('region', { name: 'Maksutila' });
  await paymentPanel.getByLabel('Maksupäivä').fill(paidOn);

  const responsePromise = waitForPaymentMutation(page, 'PUT');
  await paymentPanel
    .locator('form')
    .getByRole('button', { name: 'Merkitse maksetuksi' })
    .click({ clickCount: options.clickCount ?? 1 });
  const response = await responsePromise;
  assertHttpStatus(response, 200, 'invoice payment mark');

  return readPaymentResponse(response);
}

export async function revertCurrentInvoicePaidMarkThroughUi(
  page: Page,
): Promise<InvoicePaymentMutationResponse> {
  const paymentPanel = page.getByRole('region', { name: 'Maksutila' });
  await paymentPanel
    .getByRole('button', { name: 'Poista maksumerkintä' })
    .click();

  const responsePromise = waitForPaymentMutation(page, 'DELETE');
  await paymentPanel
    .locator('form')
    .getByRole('button', { name: 'Poista maksumerkintä' })
    .click();
  const response = await responsePromise;
  assertHttpStatus(response, 200, 'invoice payment mark revert');

  return readPaymentResponse(response);
}

function waitForPaymentMutation(
  page: Page,
  method: 'DELETE' | 'PUT',
): Promise<Response> {
  return page.waitForResponse(
    (response) =>
      response.request().method() === method &&
      /\/invoices\/[^/]+\/payment$/.test(new URL(response.url()).pathname),
  );
}

async function readPaymentResponse(
  response: Response,
): Promise<InvoicePaymentMutationResponse> {
  const body = (await response.json()) as {
    payment: InvoicePaymentMutationResponse;
  };

  return body.payment;
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
