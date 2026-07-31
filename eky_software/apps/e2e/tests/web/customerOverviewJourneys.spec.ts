import type { APIRequestContext, Page } from '@playwright/test';

import {
  createSyntheticCustomerInput,
  createSyntheticInvoiceDraftInput,
} from '../../src/data/syntheticBusinessInputs.js';
import {
  expect,
  test,
  type IsolatedWebHarness,
} from '../../src/fixtures/isolatedWebTest.js';
import { seedInvoiceJourneyPrerequisites } from '../../src/journeys/invoicingWebJourney.js';

interface CustomerIdentity {
  id: string;
  name: string;
  number: string;
}

interface ApprovedInvoiceIdentity {
  id: string;
  number: string;
}

test('CUS-OVERVIEW-002 @critical preserves list state through overview, edit cancel and save', async ({
  e2eWeb,
}) => {
  const customer = await createCustomer(e2eWeb.api, {
    customerNumber: 'E2E-OVERVIEW-1001',
    name: 'Overview Customer Oy',
  });
  await e2eWeb.page.reload();

  await e2eWeb.page.getByLabel('Hae asiakasta').fill('OVERVIEW-1001');
  await e2eWeb.page
    .getByLabel('Asiakastyypin valinta')
    .getByRole('button', { name: /^Yritys / })
    .click();
  await e2eWeb.page.getByLabel('Lajittelu').selectOption('customerNumber');
  await openCustomerOverview(e2eWeb.page, customer, {
    updateSearch: false,
  });

  await expect(e2eWeb.page.getByLabel('Nimi *')).toHaveCount(0);
  await e2eWeb.page.getByRole('button', { name: 'Muokkaa' }).click();
  await e2eWeb.page.getByLabel('Nimi *').fill('Discarded customer name');
  await e2eWeb.page.getByRole('button', { name: 'Peruuta' }).click();
  await expect(
    e2eWeb.page.getByRole('heading', { level: 2, name: customer.name }),
  ).toBeVisible();
  await expect(
    e2eWeb.page.getByText('Discarded customer name'),
  ).toHaveCount(0);

  await e2eWeb.page.getByRole('button', { name: 'Muokkaa' }).click();
  await e2eWeb.page.getByLabel('Nimi *').fill('Saved Overview Customer Oy');
  const updateResponse = e2eWeb.page.waitForResponse(
    (response) =>
      response.request().method() === 'PUT' &&
      new URL(response.url()).pathname === `/customers/${customer.id}`,
  );
  await e2eWeb.page
    .getByRole('button', { name: 'Tallenna muutokset' })
    .click();
  expect((await updateResponse).status()).toBe(200);
  await expect(
    e2eWeb.page.getByRole('heading', {
      level: 2,
      name: 'Saved Overview Customer Oy',
    }),
  ).toBeVisible();

  await e2eWeb.page.getByRole('button', { name: 'Asiakkaat' }).click();
  await expect(
    e2eWeb.page.getByRole('heading', {
      level: 2,
      name: 'Asiakaskortisto',
    }),
  ).toBeVisible();
  await expect(e2eWeb.page.getByLabel('Hae asiakasta')).toHaveValue(
    'OVERVIEW-1001',
  );
  await expect(e2eWeb.page.getByLabel('Lajittelu')).toHaveValue(
    'customerNumber',
  );
  await expect(
    e2eWeb.page
      .getByLabel('Asiakastyypin valinta')
      .getByRole('button', { name: /^Yritys / }),
  ).toHaveAttribute('aria-pressed', 'true');
});

test('CUS-OVERVIEW-008 @critical keeps customer details usable when company pricing fails', async ({
  e2eWeb,
}) => {
  const customer = await createCustomer(e2eWeb.api, {
    customerNumber: 'E2E-PRICING-FAIL',
    hourlyRateOverrideCents: null,
    name: 'Pricing Failure Customer Oy',
  });

  await e2eWeb.page.route('**/company-settings', async (route) => {
    await route.fulfill({
      body: JSON.stringify({ message: 'Synthetic internal detail' }),
      contentType: 'application/json',
      status: 500,
    });
  });
  await e2eWeb.page.reload();
  await openCustomerOverview(e2eWeb.page, customer);

  await expect(
    e2eWeb.page.getByText(
      'Oman yrityksen oletustuntihintaa ei voitu ladata.',
    ),
  ).toBeVisible();
  await expect(
    e2eWeb.page.getByRole('heading', { level: 3, name: 'Yhteystiedot' }),
  ).toBeVisible();
  await expect(
    e2eWeb.page.getByRole('heading', {
      level: 2,
      name: 'Asiakkaan laskut',
    }),
  ).toBeVisible();
  await expect(
    e2eWeb.page.getByRole('navigation', {
      name: 'Asiakaskortin navigointi',
    }),
  ).toBeVisible();
  await expect(
    e2eWeb.page.getByText('Synthetic internal detail'),
  ).toHaveCount(0);
});

test('CUS-OVERVIEW-003 CUS-OVERVIEW-006 CUS-OVERVIEW-007 @critical @cross-module shows mutually exclusive customer-owned invoice states and opens invoicing targets', async ({
  e2eWeb,
}) => {
  const selectedCustomer = await seedInvoiceJourneyPrerequisites(e2eWeb, {
    customerInput: {
      customerNumber: 'E2E-OVERVIEW-INV',
      name: 'Customer Invoice Overview Oy',
    },
  });
  const otherCustomer = await createCustomer(e2eWeb.api, {
    customerNumber: 'E2E-OTHER',
    name: 'Other Tenant-Scope Customer Oy',
  });

  const draft = await createDraft(e2eWeb.api, selectedCustomer.customerId, {
    subject: 'Overview draft',
  });
  const approved = await createApprovedInvoice(
    e2eWeb.api,
    selectedCustomer.customerId,
    'Overview approved',
  );
  const sent = await createApprovedInvoice(
    e2eWeb.api,
    selectedCustomer.customerId,
    'Overview sent',
  );
  await markInvoiceSent(e2eWeb.api, sent.id);
  const paid = await createApprovedInvoice(
    e2eWeb.api,
    selectedCustomer.customerId,
    'Overview paid',
  );
  await markInvoiceSent(e2eWeb.api, paid.id);
  await markInvoicePaid(e2eWeb.api, paid.id);
  const creditedSource = await createApprovedInvoice(
    e2eWeb.api,
    selectedCustomer.customerId,
    'Overview credited source',
  );
  await markInvoiceSent(e2eWeb.api, creditedSource.id);
  await markInvoicePaid(e2eWeb.api, creditedSource.id);
  const creditInvoice = await createFullCreditInvoice(
    e2eWeb.api,
    creditedSource.id,
  );
  const cancelled = await createApprovedInvoice(
    e2eWeb.api,
    selectedCustomer.customerId,
    'Overview cancelled',
  );
  await cancelInvoice(e2eWeb.api, cancelled);
  const otherInvoice = await createApprovedInvoice(
    e2eWeb.api,
    otherCustomer.id,
    'Must not appear on selected customer',
  );

  await e2eWeb.page.reload();
  await openCustomerOverview(e2eWeb.page, {
    id: selectedCustomer.customerId,
    name: selectedCustomer.customerName,
    number: selectedCustomer.customerNumber,
  });

  for (const heading of [
    'Luonnokset',
    'Hyväksytyt ja toimitusta odottavat',
    'Lähetetyt',
    'Maksetut',
    'Hyvitetyt ja osittain hyvitetyt',
    'Perutut',
  ]) {
    await expect(
      e2eWeb.page.getByRole('heading', { level: 3, name: heading }),
    ).toBeVisible();
  }
  await expect(e2eWeb.page.getByText(approved.number)).toBeVisible();
  const sentSection = e2eWeb.page.getByRole('region', {
    name: 'Lähetetyt',
  });
  const paidSection = e2eWeb.page.getByRole('region', {
    name: 'Maksetut',
  });
  const creditedSection = e2eWeb.page.getByRole('region', {
    name: 'Hyvitetyt ja osittain hyvitetyt',
  });
  await expect(sentSection.getByText(sent.number, { exact: true })).toBeVisible();
  await expect(paidSection.getByText(paid.number, { exact: true })).toBeVisible();
  await expect(
    creditedSection.getByText(creditedSource.number, { exact: true }),
  ).toBeVisible();
  await expect(
    creditedSection.getByRole('row').filter({ hasText: creditedSource.number }),
  ).toContainText('Kokonaan hyvitetty · Maksettu');
  await expect(sentSection.getByText(paid.number, { exact: true })).toHaveCount(
    0,
  );
  await expect(
    paidSection.getByText(creditedSource.number, { exact: true }),
  ).toHaveCount(0);
  await expect(e2eWeb.page.getByText(creditInvoice.number)).toBeVisible();
  await expect(e2eWeb.page.getByText(cancelled.number)).toBeVisible();
  await expect(e2eWeb.page.getByText(otherInvoice.number)).toHaveCount(0);

  const draftRow = e2eWeb.page
    .getByRole('row')
    .filter({ hasText: 'Overview draft' });
  await draftRow
    .getByRole('button', { name: 'Avaa lasku Luonnos' })
    .click();
  await expect(
    e2eWeb.page.getByRole('heading', {
      level: 2,
      name: 'Muokkaa laskuluonnosta',
    }),
  ).toBeVisible();
  const draftResponse = await e2eWeb.api.get(`/invoice-drafts/${draft.id}`);
  expect(draftResponse.status()).toBe(200);

  await e2eWeb.page.getByRole('button', { name: 'Asiakkaat' }).click();
  await openCustomerOverview(e2eWeb.page, {
    id: selectedCustomer.customerId,
    name: selectedCustomer.customerName,
    number: selectedCustomer.customerNumber,
  });
  const approvedRow = e2eWeb.page
    .getByRole('row')
    .filter({ hasText: approved.number });
  await approvedRow
    .getByRole('button', { name: `Avaa lasku ${approved.number}` })
    .click();
  await expect(
    e2eWeb.page.getByRole('heading', {
      level: 2,
      name: `Lasku ${approved.number}`,
    }),
  ).toBeVisible();
});

test('CUS-OVERVIEW-005 @security keeps customer activity allowlisted and value-free', async ({
  e2eWeb,
}) => {
  const privateValues = {
    businessId: '2468135-7',
    comment: 'Private synthetic customer note',
    email: 'private-overview@example.invalid',
    phone: '040 987 6543',
    streetAddress: 'Private Test Street 99',
  };
  const customerInput = createSyntheticCustomerInput({
    ...privateValues,
    customerNumber: 'E2E-ACTIVITY',
    name: 'Activity Customer Oy',
  });
  const customer = await createCustomer(e2eWeb.api, customerInput);
  const updateResponse = await e2eWeb.api.put(`/customers/${customer.id}`, {
    data: {
      ...customerInput,
      city: 'Updated Test City',
      hourlyRateOverrideCents: 7_250,
    },
  });
  expect(updateResponse.status()).toBe(200);

  await e2eWeb.page.reload();
  await openCustomerOverview(e2eWeb.page, customer);
  const activitySection = e2eWeb.page.getByRole('region', {
    name: 'Asiakkaan tapahtumat',
  });
  await expect(activitySection.getByText('Asiakas luotiin')).toBeVisible();
  await expect(
    activitySection.getByText(/Päivitettiin .*yhteystietoja/),
  ).toBeVisible();

  const activityText = await activitySection.textContent();
  for (const privateValue of Object.values(privateValues)) {
    expect(activityText).not.toContain(privateValue);
  }

  const unknownCustomerResponse = await e2eWeb.api.get(
    '/customers/customer-from-another-company',
  );
  expect(unknownCustomerResponse.status()).toBe(404);
  const unknownInvoiceResponse = await e2eWeb.api.get(
    '/invoices/invoice-from-another-company',
  );
  expect(unknownInvoiceResponse.status()).toBe(404);
});

test('CUS-OVERVIEW-009 @critical @cross-module pages and sorts paid customer invoices with payment dates', async ({
  e2eWeb,
}) => {
  const selectedCustomer = await seedInvoiceJourneyPrerequisites(e2eWeb, {
    customerInput: {
      customerNumber: 'E2E-OVERVIEW-PAID',
      name: 'Paid Invoice Overview Oy',
    },
  });
  const paidInvoices: ApprovedInvoiceIdentity[] = [];

  for (let index = 1; index <= 6; index += 1) {
    const day = String(index).padStart(2, '0');
    const dueDay = String(index + 14).padStart(2, '0');
    const paidDay = String(index + 20).padStart(2, '0');
    const invoice = await createApprovedInvoice(
      e2eWeb.api,
      selectedCustomer.customerId,
      `Paid overview ${day}`,
      {
        dueDate: `2026-07-${dueDay}`,
        invoiceDate: `2026-07-${day}`,
      },
    );

    await markInvoiceSent(e2eWeb.api, invoice.id);
    await markInvoicePaid(e2eWeb.api, invoice.id, `2026-07-${paidDay}`);
    paidInvoices.push(invoice);
  }

  await e2eWeb.page.reload();
  await openCustomerOverview(e2eWeb.page, {
    id: selectedCustomer.customerId,
    name: selectedCustomer.customerName,
    number: selectedCustomer.customerNumber,
  });

  await expect(e2eWeb.page.getByLabel('Rivejä osiossa')).toHaveValue('5');
  await expect(e2eWeb.page.getByLabel('Järjestys')).toHaveValue(
    'invoiceDateDesc',
  );

  const paidSection = e2eWeb.page.getByRole('region', {
    name: 'Maksetut',
  });
  await expect(
    paidSection.getByRole('button', { name: /^Avaa lasku / }),
  ).toHaveCount(5);
  await expect(
    paidSection.getByText(paidInvoices[5]!.number, { exact: true }),
  ).toBeVisible();
  await expect(
    paidSection.getByText(paidInvoices[0]!.number, { exact: true }),
  ).toHaveCount(0);
  await expect(
    paidSection.getByRole('columnheader', { name: 'Maksupäivä' }),
  ).toHaveCount(0);
  await expect(
    paidSection.getByText('Maksupäivä 26.07.2026'),
  ).toBeVisible();

  await paidSection.getByRole('button', { name: 'Seuraava' }).click();
  await expect(
    paidSection.getByText(paidInvoices[0]!.number, { exact: true }),
  ).toBeVisible();

  await e2eWeb.page.getByLabel('Rivejä osiossa').selectOption('20');
  await expect(
    paidSection.getByRole('button', { name: /^Avaa lasku / }),
  ).toHaveCount(6);

  await e2eWeb.page
    .getByLabel('Järjestys')
    .selectOption('invoiceDateAsc');
  await expect(paidSection.getByRole('row').nth(1)).toContainText(
    paidInvoices[0]!.number,
  );

  await e2eWeb.page.getByRole('button', { name: 'Laskutus' }).click();
  const paidTable = e2eWeb.page.getByRole('table', {
    name: 'Maksetut laskut',
  });
  await expect(
    paidTable.getByRole('columnheader', { name: 'Maksupäivä' }),
  ).toHaveCount(0);
  await expect(paidTable.getByText('Maksupäivä 26.07.2026')).toBeVisible();
});

async function createCustomer(
  api: APIRequestContext,
  overrides: Record<string, unknown>,
): Promise<CustomerIdentity> {
  const response = await api.post('/customers', {
    data: createSyntheticCustomerInput(overrides),
  });
  expect(response.status()).toBe(201);
  const body = (await response.json()) as {
    customer: { customerNumber: string; id: string; name: string };
  };

  return {
    id: body.customer.id,
    name: body.customer.name,
    number: body.customer.customerNumber,
  };
}

async function openCustomerOverview(
  page: Page,
  customer: CustomerIdentity,
  options: { updateSearch?: boolean } = {},
): Promise<void> {
  if (options.updateSearch !== false) {
    await page.getByLabel('Hae asiakasta').fill(customer.number);
  }
  await page
    .getByRole('button', {
      name: new RegExp(`${escapeRegExp(customer.number)}.*${escapeRegExp(customer.name)}`),
    })
    .click();
  await expect(
    page.getByRole('heading', { level: 2, name: customer.name }),
  ).toBeVisible();
}

async function createDraft(
  api: APIRequestContext,
  customerId: string,
  overrides: Record<string, unknown>,
): Promise<{ id: string }> {
  const response = await api.post('/invoice-drafts', {
    data: createSyntheticInvoiceDraftInput(customerId, overrides),
  });
  expect(response.status()).toBe(201);
  const body = (await response.json()) as {
    invoiceDraft: { id: string };
  };

  return { id: body.invoiceDraft.id };
}

async function createApprovedInvoice(
  api: APIRequestContext,
  customerId: string,
  subject: string,
  overrides: Record<string, unknown> = {},
): Promise<ApprovedInvoiceIdentity> {
  const draft = await createDraft(api, customerId, {
    ...overrides,
    subject,
  });
  const response = await api.post(`/invoice-drafts/${draft.id}/approve`);
  expect(response.status()).toBe(200);
  const body = (await response.json()) as {
    approvedInvoice: { invoiceId: string; invoiceNumber: string };
  };

  return {
    id: body.approvedInvoice.invoiceId,
    number: body.approvedInvoice.invoiceNumber,
  };
}

async function markInvoiceSent(
  api: APIRequestContext,
  invoiceId: string,
): Promise<void> {
  const pdfResponse = await api.post(`/invoices/${invoiceId}/pdf`);
  expect([200, 201]).toContain(pdfResponse.status());
  const sentResponse = await api.post(`/invoices/${invoiceId}/mark-sent`, {
    data: { deliveryMethod: 'manual' },
  });
  expect(sentResponse.status()).toBe(200);
}

async function markInvoicePaid(
  api: APIRequestContext,
  invoiceId: string,
  paidOn = '2026-07-30',
): Promise<void> {
  const response = await api.put(`/invoices/${invoiceId}/payment`, {
    data: { paidOn },
  });
  expect(response.status()).toBe(200);
}

async function createFullCreditInvoice(
  api: APIRequestContext,
  sourceInvoiceId: string,
): Promise<ApprovedInvoiceIdentity> {
  const draftResponse = await api.post(
    `/invoices/${sourceInvoiceId}/credit-draft`,
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

async function cancelInvoice(
  api: APIRequestContext,
  invoice: ApprovedInvoiceIdentity,
): Promise<void> {
  const response = await api.post(`/invoices/${invoice.id}/cancel`, {
    data: {
      cancellationReason: 'Synthetic customer overview cancellation',
      confirmationInvoiceNumber: invoice.number,
    },
  });
  expect(response.status()).toBe(200);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
