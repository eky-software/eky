import type { APIRequestContext, Locator, Page } from '@playwright/test';

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

test('CUS-REL-001 CUS-REL-002 CUS-REL-003 @critical navigates customer relationships and preserves list state', async ({
  e2eWeb,
}) => {
  const propertyManager = await createCustomer(e2eWeb.api, {
    city: 'Turku',
    customerNumber: 'E2E-REL-1001',
    customerType: 'propertyManager',
    name: 'E2E Relationship Isännöinti Oy',
  });
  const firstHousingCompany = await createCustomer(e2eWeb.api, {
    city: 'Naantali',
    customerNumber: 'E2E-REL-2001',
    customerType: 'housingCompany',
    managedByCustomerId: propertyManager.id,
    name: 'Asunto Oy E2E Relationship A',
  });
  const secondHousingCompany = await createCustomer(e2eWeb.api, {
    city: 'Raisio',
    customerNumber: 'E2E-REL-2002',
    customerType: 'housingCompany',
    managedByCustomerId: propertyManager.id,
    name: 'Asunto Oy E2E Relationship B',
  });

  await e2eWeb.page.reload();
  await e2eWeb.page.getByLabel('Hae asiakasta').fill('E2E-REL');
  await e2eWeb.page
    .getByLabel('Asiakastyypin valinta')
    .getByRole('button', { name: /^Isännöitsijätoimisto / })
    .click();
  await e2eWeb.page.getByLabel('Lajittelu').selectOption('customerNumber');

  const disclosure = e2eWeb.page.getByRole('button', {
    name: 'Avaa taloyhtiöt: 2 hallinnoitua taloyhtiötä',
  });
  await disclosure.focus();
  await disclosure.press('Enter');
  await expect(
    e2eWeb.page.getByRole('button', {
      name: 'Sulje taloyhtiöt: 2 hallinnoitua taloyhtiötä',
    }),
  ).toHaveAttribute('aria-expanded', 'true');
  await expect(
    e2eWeb.page.getByRole('button', {
      name: new RegExp(firstHousingCompany.name),
    }),
  ).toBeVisible();
  await expect(
    e2eWeb.page.getByRole('button', {
      name: new RegExp(secondHousingCompany.name),
    }),
  ).toBeVisible();

  const expandedDisclosure = e2eWeb.page.getByRole('button', {
    name: 'Sulje taloyhtiöt: 2 hallinnoitua taloyhtiötä',
  });
  await expandedDisclosure.press('Space');
  await expect(
    e2eWeb.page.getByRole('button', {
      name: 'Avaa taloyhtiöt: 2 hallinnoitua taloyhtiötä',
    }),
  ).toHaveAttribute('aria-expanded', 'false');
  await e2eWeb.page
    .getByRole('button', {
      name: 'Avaa taloyhtiöt: 2 hallinnoitua taloyhtiötä',
    })
    .press('Enter');

  await openCustomerOverview(e2eWeb.page, propertyManager, {
    updateSearch: false,
  });
  const managedCompanies = e2eWeb.page.getByRole('region', {
    name: 'Hallinnoidut taloyhtiöt',
  });
  await expect(managedCompanies.getByText('2', { exact: true })).toBeVisible();
  await expect(
    managedCompanies.getByText(firstHousingCompany.name, { exact: true }),
  ).toBeVisible();
  await expect(
    managedCompanies.getByText(secondHousingCompany.name, { exact: true }),
  ).toBeVisible();

  await managedCompanies
    .getByRole('button', {
      name: `Avaa asiakaskortti ${firstHousingCompany.name}`,
    })
    .click();
  await expect(
    e2eWeb.page.getByRole('heading', {
      level: 2,
      name: firstHousingCompany.name,
    }),
  ).toBeVisible();

  await e2eWeb.page
    .getByRole('button', {
      name: `Avaa asiakaskortti ${propertyManager.name}`,
    })
    .click();
  await expect(
    e2eWeb.page.getByRole('heading', {
      level: 2,
      name: propertyManager.name,
    }),
  ).toBeVisible();

  await e2eWeb.page.getByRole('button', { name: '← Asiakaslistaan' }).click();
  await expect(e2eWeb.page.getByLabel('Hae asiakasta')).toHaveValue('E2E-REL');
  await expect(e2eWeb.page.getByLabel('Lajittelu')).toHaveValue(
    'customerNumber',
  );
  await expect(
    e2eWeb.page
      .getByLabel('Asiakastyypin valinta')
      .getByRole('button', { name: /^Isännöitsijätoimisto / }),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(
    e2eWeb.page.getByRole('button', {
      name: 'Sulje taloyhtiöt: 2 hallinnoitua taloyhtiötä',
    }),
  ).toHaveAttribute('aria-expanded', 'true');
});

test('CUS-RECIPIENT-001 @critical @cross-module separates owned and recipient invoices', async ({
  e2eWeb,
}) => {
  const propertyManager = await createCustomer(e2eWeb.api, {
    customerNumber: 'E2E-RECIPIENT-1001',
    customerType: 'propertyManager',
    name: 'E2E Recipient Isännöinti Oy',
  });
  const housingCompany = await seedInvoiceJourneyPrerequisites(e2eWeb, {
    customerInput: {
      customerNumber: 'E2E-RECIPIENT-2001',
      customerType: 'housingCompany',
      managedByCustomerId: propertyManager.id,
      name: 'Asunto Oy E2E Recipient',
    },
  });
  const recipientInvoice = await createApprovedInvoice(
    e2eWeb.api,
    housingCompany.customerId,
    'Taloyhtiön vastaanottajalasku',
    propertyManager.id,
  );
  const propertyManagerOwnInvoice = await createApprovedInvoice(
    e2eWeb.api,
    propertyManager.id,
    'Isännöitsijän oma lasku',
  );

  await e2eWeb.page.reload();
  await openCustomerOverview(e2eWeb.page, {
    id: housingCompany.customerId,
    name: housingCompany.customerName,
    number: housingCompany.customerNumber,
  });
  const housingCompanyInvoices = e2eWeb.page.getByRole('region', {
    name: 'Asiakkaan laskut',
  });
  await expect(
    housingCompanyInvoices.getByText(recipientInvoice.number, {
      exact: true,
    }),
  ).toBeVisible();

  await e2eWeb.page.getByRole('button', { name: '← Asiakaslistaan' }).click();
  await openCustomerOverview(e2eWeb.page, propertyManager);
  const propertyManagerInvoices = e2eWeb.page.getByRole('region', {
    name: 'Asiakkaan laskut',
  });
  const recipientInvoices = e2eWeb.page.getByRole('region', {
    name: 'Taloyhtiöiden laskut vastaanottajana',
  });

  await expect(
    propertyManagerInvoices.getByText(propertyManagerOwnInvoice.number, {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    propertyManagerInvoices.getByText(recipientInvoice.number, {
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(
    recipientInvoices.getByText(recipientInvoice.number, { exact: true }),
  ).toBeVisible();
  await expect(
    recipientInvoices.getByText(
      `${housingCompany.customerNumber} – ${housingCompany.customerName}`,
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    recipientInvoices.getByText('Taloyhtiön vastaanottajalasku', {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    recipientInvoices.getByText(propertyManagerOwnInvoice.number, {
      exact: true,
    }),
  ).toHaveCount(0);

  const recipientTable = recipientInvoices.getByRole('table', {
    name: 'Hyväksytyt ja toimitusta odottavat',
  });
  await expectInvoiceTableHeaders(recipientTable, true);
  const openInvoiceButton = recipientTable.getByRole('button', {
    name: `Avaa lasku ${recipientInvoice.number}`,
  });
  const actionBounds = await openInvoiceButton.evaluate((button) => {
    const cell = button.parentElement;
    if (cell === null) {
      throw new Error('Invoice action cell is missing.');
    }
    const buttonRect = button.getBoundingClientRect();
    const cellRect = cell.getBoundingClientRect();

    return {
      buttonLeft: buttonRect.left,
      buttonRight: buttonRect.right,
      cellLeft: cellRect.left,
      cellRight: cellRect.right,
    };
  });
  expect(actionBounds.buttonLeft).toBeGreaterThanOrEqual(
    actionBounds.cellLeft - 0.5,
  );
  expect(actionBounds.buttonRight).toBeLessThanOrEqual(
    actionBounds.cellRight + 0.5,
  );
});

test('CUS-INVOICE-001 @critical starts and saves an invoice for the active customer', async ({
  e2eWeb,
}) => {
  const customer = await seedInvoiceJourneyPrerequisites(e2eWeb, {
    customerInput: {
      customerNumber: 'E2E-CREATE-INVOICE',
      customerType: 'privatePerson',
      name: 'E2E Laskutusasiakas',
    },
  });

  await e2eWeb.page.reload();
  await openCustomerOverview(e2eWeb.page, {
    id: customer.customerId,
    name: customer.customerName,
    number: customer.customerNumber,
  });
  await e2eWeb.page.getByRole('button', { name: 'Luo lasku' }).click();

  await expect(
    e2eWeb.page.getByRole('heading', { level: 2, name: 'Uusi lasku' }),
  ).toBeVisible();
  await expect(
    e2eWeb.page.getByRole('combobox', {
      name: 'Asiakas',
      exact: true,
    }),
  ).toHaveValue(customer.customerId);

  const createResponsePromise = e2eWeb.page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname === '/invoice-drafts',
  );
  await e2eWeb.page.getByLabel('Laskun päiväys').fill('2026-07-31');
  await e2eWeb.page.getByLabel('Aihe').fill('Asiakaskortilta luotu lasku');
  const firstLine = e2eWeb.page.getByRole('group', { name: 'Rivi 1' });
  await firstLine.getByLabel('Nimike').fill('Synteettinen työ');
  await firstLine.getByLabel('Määrä').fill('1');
  await firstLine.getByLabel('Yksikköhinta').fill('80');

  const createResponse = await createResponsePromise;
  expect(createResponse.status()).toBe(201);
  expect(createResponse.request().postDataJSON()).not.toHaveProperty(
    'companyId',
  );
  const body = (await createResponse.json()) as {
    invoiceDraft: {
      customerId: string;
      id: string;
      status: string;
    };
  };
  expect(body.invoiceDraft).toMatchObject({
    customerId: customer.customerId,
    status: 'draft',
  });

  const savedDraft = await e2eWeb.api.get(
    `/invoice-drafts/${body.invoiceDraft.id}`,
  );
  expect(savedDraft.status()).toBe(200);
  expect(await savedDraft.json()).toMatchObject({
    invoiceDraft: {
      customerId: customer.customerId,
      subject: 'Asiakaskortilta luotu lasku',
    },
  });
});

test('CUS-INVOICE-002 keeps invoice creation unavailable for an inactive customer', async ({
  e2eWeb,
}) => {
  const inactiveCustomer = await createCustomer(e2eWeb.api, {
    customerNumber: 'E2E-INACTIVE-INVOICE',
    name: 'E2E Passiivinen Asiakas Oy',
    status: 'inactive',
  });

  await e2eWeb.page.reload();
  await openCustomerOverview(e2eWeb.page, inactiveCustomer);
  await expect(
    e2eWeb.page.getByRole('button', { name: 'Luo lasku' }),
  ).toHaveCount(0);
  await expect(
    e2eWeb.page.getByRole('heading', {
      level: 2,
      name: inactiveCustomer.name,
    }),
  ).toBeVisible();
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

async function createApprovedInvoice(
  api: APIRequestContext,
  customerId: string,
  subject: string,
  billingRecipientCustomerId = '',
): Promise<ApprovedInvoiceIdentity> {
  const draftResponse = await api.post('/invoice-drafts', {
    data: createSyntheticInvoiceDraftInput(customerId, {
      billingRecipientCustomerId,
      subject,
    }),
  });
  expect(draftResponse.status()).toBe(201);
  const draftBody = (await draftResponse.json()) as {
    invoiceDraft: { id: string };
  };
  const approvalResponse = await api.post(
    `/invoice-drafts/${draftBody.invoiceDraft.id}/approve`,
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

async function openCustomerOverview(
  page: Page,
  customer: CustomerIdentity,
  options: { updateSearch?: boolean } = {},
): Promise<void> {
  if (options.updateSearch !== false) {
    await page.getByLabel('Hae asiakasta').fill(customer.number);
  }
  const customerButton = page.getByRole('button', {
    name: new RegExp(
      `${escapeRegExp(customer.number)}.*${escapeRegExp(customer.name)}`,
    ),
  });
  if ((await customerButton.count()) === 0) {
    const relationshipDisclosure = page.getByRole('button', {
      name: /^Avaa taloyhtiöt:/,
    });
    if ((await relationshipDisclosure.count()) === 1) {
      await relationshipDisclosure.click();
    }
  }
  await customerButton.click();
  await expect(
    page.getByRole('heading', { level: 2, name: customer.name }),
  ).toBeVisible();
}

async function expectInvoiceTableHeaders(
  table: Locator,
  showCustomer: boolean,
): Promise<void> {
  const expectedHeaders = [
    'Lasku',
    ...(showCustomer ? ['Asiakas'] : []),
    'Päiväys',
    'Eräpäivä',
    'Yhteensä',
    'Tila',
  ];

  for (const header of expectedHeaders) {
    await expect(
      table.getByRole('columnheader', { name: header, exact: true }),
    ).toBeVisible();
  }
  await expect(
    table.getByRole('columnheader', { name: 'Hyvityssuhde', exact: true }),
  ).toHaveCount(0);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
