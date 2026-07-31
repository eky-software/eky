import type { Page } from '@playwright/test';

import { readE2eOperationalLogs } from '../../src/assertions/readE2eOperationalLogs.js';
import { readE2eSqliteRows } from '../../src/assertions/readE2eSqliteRows.js';
import { securityPayloadCorpus } from '../../src/data/securityPayloadCorpus.js';
import {
  expect,
  test,
  type IsolatedWebHarness,
} from '../../src/fixtures/isolatedWebTest.js';

test('CUS-UI-001 CUS-OVERVIEW-001 @critical creates, edits, searches and reloads a customer', async ({
  e2eWeb,
}) => {
  await createCustomerThroughUi(e2eWeb.page, {
    address: 'Hakukatu 17 B',
    comment: 'Synthetic customer journey',
    customerNumber: 'E2E-2101',
    name: 'Synteettinen Asiakas Oy',
  });

  await expect(
    e2eWeb.page.getByRole('heading', {
      level: 2,
      name: 'Synteettinen Asiakas Oy',
    }),
  ).toBeVisible();
  await expect(e2eWeb.page.getByLabel('Nimi *')).toHaveCount(0);
  await e2eWeb.page.getByRole('button', { name: 'Muokkaa' }).click();
  await e2eWeb.page.getByLabel('Nimi *').fill('Muokattu Asiakas Oy');
  await e2eWeb.page
    .getByLabel('Katuosoite')
    .fill('Pysyväntiedonkuja 42');
  const updateResponse = e2eWeb.page.waitForResponse(
    (response) =>
      response.request().method() === 'PUT' &&
      /\/customers\/[^/]+$/.test(new URL(response.url()).pathname),
  );
  await e2eWeb.page.getByRole('button', { name: 'Tallenna muutokset' }).click();
  expect((await updateResponse).status()).toBe(200);
  await expect(
    e2eWeb.page.getByRole('heading', {
      level: 2,
      name: 'Muokattu Asiakas Oy',
    }),
  ).toBeVisible();

  await e2eWeb.page
    .getByRole('button', { name: '← Asiakaslistaan' })
    .click();
  const search = e2eWeb.page.getByLabel('Hae asiakasta');
  await search.fill('E2E-2101');
  await expect(
    e2eWeb.page.getByRole('button', { name: /Muokattu Asiakas Oy/ }),
  ).toBeVisible();
  await search.fill('Pysyväntiedonkuja 42');
  await expect(
    e2eWeb.page.getByRole('button', { name: /Muokattu Asiakas Oy/ }),
  ).toBeVisible();

  await e2eWeb.page.reload();
  await expect(
    e2eWeb.page.getByRole('heading', { name: 'Asiakkaat' }),
  ).toBeVisible();
  await e2eWeb.page.getByLabel('Hae asiakasta').fill('Pysyväntiedonkuja 42');
  await expect(
    e2eWeb.page.getByRole('button', { name: /Muokattu Asiakas Oy/ }),
  ).toBeVisible();

  const listResponse = await e2eWeb.api.get('/customers');
  expect(listResponse.status()).toBe(200);
  const listBody = (await listResponse.json()) as {
    customers: Array<Record<string, unknown>>;
  };
  expect(listBody.customers).toEqual([
    expect.objectContaining({
      customerNumber: 'E2E-2101',
      name: 'Muokattu Asiakas Oy',
      streetAddress: 'Pysyväntiedonkuja 42',
    }),
  ]);

  expect(
    readE2eSqliteRows(
      e2eWeb.paths.databaseFilePath,
      `
        SELECT customer_number, name, street_address
        FROM customers
        WHERE customer_number = ?
      `,
      'E2E-2101',
    ),
  ).toEqual([
    {
      customer_number: 'E2E-2101',
      name: 'Muokattu Asiakas Oy',
      street_address: 'Pysyväntiedonkuja 42',
    },
  ]);
  expect(
    readE2eSqliteRows(
      e2eWeb.paths.databaseFilePath,
      `
        SELECT action, changed_field_categories
        FROM customer_audit_events
        ORDER BY occurred_at ASC
      `,
    ),
  ).toEqual([
    {
      action: 'customer.created',
      changed_field_categories:
        '["identity","contact","billing","pricing","status"]',
    },
    {
      action: 'customer.updated',
      changed_field_categories: '["identity","contact"]',
    },
  ]);
});

test('CUS-INPUT-001 @security enforces bounded text and renders hostile text literally', async ({
  e2eWeb,
}) => {
  const maximumName = 'N'.repeat(200);
  const maximumAddress = 'A'.repeat(200);
  const maximumComment = 'C'.repeat(1_000);

  await createCustomerThroughUi(e2eWeb.page, {
    address: maximumAddress,
    comment: maximumComment,
    customerNumber: 'E2E-MAX',
    name: maximumName,
  });
  await e2eWeb.page
    .getByRole('button', { name: '← Asiakaslistaan' })
    .click();

  await openNewCustomerForm(e2eWeb.page, 'E2E-OVERFLOW');
  await fillCustomerFields(e2eWeb.page, {
    address: 'Rajakatu 1',
    comment: 'Valid comment',
    name: 'N'.repeat(201),
  });
  await expectRejectedCustomerCreate(e2eWeb.page);

  await e2eWeb.page.getByLabel('Nimi *').fill('Valid name');
  await e2eWeb.page.getByLabel('Katuosoite').fill('A'.repeat(201));
  await expectRejectedCustomerCreate(e2eWeb.page);

  await e2eWeb.page.getByLabel('Katuosoite').fill('Valid address');
  await e2eWeb.page.getByLabel('Kommentti').fill('C'.repeat(1_001));
  await expectRejectedCustomerCreate(e2eWeb.page);
  await e2eWeb.page.getByRole('button', { name: 'Peruuta' }).click();

  const hostileName = `${securityPayloadCorpus.htmlText} Å🙂`;
  const hostileComment = `${securityPayloadCorpus.svgText}\nYhdistelmä A\u0308`;
  await e2eWeb.page.evaluate(() => {
    (
      globalThis as typeof globalThis & { __ekyInjected?: boolean }
    ).__ekyInjected = false;
  });
  let popupCount = 0;
  e2eWeb.page.on('popup', () => {
    popupCount += 1;
  });

  await createCustomerThroughUi(e2eWeb.page, {
    address: 'Unicodekuja Ääkkönen 1 🙂',
    comment: hostileComment,
    customerNumber: 'E2E-XSS',
    name: hostileName,
  });

  await expect(
    e2eWeb.page.getByRole('heading', {
      level: 2,
      name: hostileName,
    }),
  ).toBeVisible();
  expect(
    await e2eWeb.page.evaluate(
      () =>
        (
          globalThis as typeof globalThis & { __ekyInjected?: boolean }
        ).__ekyInjected,
    ),
  ).toBe(false);
  expect(popupCount).toBe(0);
  await e2eWeb.page
    .getByRole('button', { name: '← Asiakaslistaan' })
    .click();

  const listResponse = await e2eWeb.api.get('/customers');
  expect(listResponse.status()).toBe(200);
  const customers = ((await listResponse.json()) as {
    customers: Array<Record<string, unknown>>;
  }).customers;
  expect(customers).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        comment: maximumComment,
        name: maximumName,
        streetAddress: maximumAddress,
      }),
      expect.objectContaining({
        comment: hostileComment,
        name: hostileName,
        streetAddress: 'Unicodekuja Ääkkönen 1 🙂',
      }),
    ]),
  );
  expect(customers).toHaveLength(2);

  const activityResponse = await e2eWeb.api.get(
    '/activity?category=customers&pageSize=100',
  );
  expect(activityResponse.status()).toBe(200);
  const activityText = JSON.stringify(await activityResponse.json());
  for (const privateValue of [
    maximumName,
    maximumAddress,
    maximumComment,
    hostileName,
    hostileComment,
    'Unicodekuja Ääkkönen 1 🙂',
  ]) {
    expect(activityText).not.toContain(privateValue);
  }

  const logs = readE2eOperationalLogs(e2eWeb.paths.logsRoot);
  for (const privateValue of [
    maximumName,
    maximumAddress,
    maximumComment,
    hostileName,
    hostileComment,
    'Unicodekuja Ääkkönen 1 🙂',
  ]) {
    expect(logs).not.toContain(privateValue);
  }
});

test('COMPANY-UI-001 COMPANY-AUDIT-001 @critical updates settings without exposing master data', async ({
  e2eWeb,
}) => {
  const sensitiveValues = {
    email: 'company-e2e@example.invalid',
    iban: 'FI2112345600000785',
    sender: 'billing-e2e@example.invalid',
  };

  await e2eWeb.page.getByRole('button', { name: 'Oma yritys' }).click();
  await expect(
    e2eWeb.page.getByRole('heading', { level: 1, name: 'Oma yritys' }),
  ).toBeVisible();
  await e2eWeb.page.getByLabel('Yrityksen nimi').fill('E2E Rakentaja Oy');
  await e2eWeb.page.getByLabel('Y-tunnus').fill('7654321-0');
  await e2eWeb.page.getByLabel('ALV-tunnus').fill('FI76543210');
  await e2eWeb.page
    .getByLabel('Sähköposti', { exact: true })
    .fill(sensitiveValues.email);
  await e2eWeb.page.getByLabel('Puhelin').fill('040 555 0101');
  await e2eWeb.page.getByLabel('Kotisivut').fill('https://example.invalid');
  await e2eWeb.page.getByLabel('Katuosoite').fill('Yritystie 88');
  await e2eWeb.page.getByLabel('Postinumero').fill('21290');
  await e2eWeb.page.getByLabel('Kaupunki').fill('Rusko');
  await e2eWeb.page.getByLabel('IBAN').fill(sensitiveValues.iban);
  await e2eWeb.page.getByLabel('BIC').fill('NDEAFIHH');
  await e2eWeb.page.getByLabel('Pankin nimi').fill('Synteettinen Pankki');
  await e2eWeb.page
    .getByLabel('Sähköpostin lähetystapa')
    .selectOption('dryRun');
  await e2eWeb.page.getByLabel('Lähettäjän nimi').fill('E2E Laskutus');
  await e2eWeb.page
    .getByLabel('Lähettäjän sähköpostiosoite')
    .fill(sensitiveValues.sender);
  await e2eWeb.page
    .getByLabel('SMTP-käyttäjätunnus')
    .fill(sensitiveValues.sender);
  await e2eWeb.page
    .getByLabel('SMTP-testin vastaanottaja')
    .fill('test-recipient@example.invalid');

  const updateResponse = e2eWeb.page.waitForResponse(
    (response) =>
      response.request().method() === 'PUT' &&
      new URL(response.url()).pathname === '/company-settings',
  );
  await e2eWeb.page
    .getByRole('button', { name: 'Tallenna', exact: true })
    .click();
  expect((await updateResponse).status()).toBe(200);
  await expect(
    e2eWeb.page.getByText('Oman yrityksen tiedot tallennettu.'),
  ).toBeVisible();

  await e2eWeb.page.reload();
  await e2eWeb.page.getByRole('button', { name: 'Oma yritys' }).click();
  await expect(e2eWeb.page.getByLabel('Yrityksen nimi')).toHaveValue(
    'E2E Rakentaja Oy',
  );
  await expect(
    e2eWeb.page.getByLabel('Sähköposti', { exact: true }),
  ).toHaveValue(sensitiveValues.email);
  await expect(e2eWeb.page.getByLabel('IBAN')).toHaveValue(
    'FI21 1234 5600 0007 85',
  );
  await expect(
    e2eWeb.page.getByLabel('Lähettäjän sähköpostiosoite'),
  ).toHaveValue(sensitiveValues.sender);

  const settingsResponse = await e2eWeb.api.get('/company-settings');
  expect(settingsResponse.status()).toBe(200);
  await expect(settingsResponse.json()).resolves.toEqual({
    companySettings: expect.objectContaining({
      companyName: 'E2E Rakentaja Oy',
      email: sensitiveValues.email,
      emailDeliveryProvider: 'dryRun',
      emailSenderAddress: sensitiveValues.sender,
      iban: sensitiveValues.iban,
    }),
  });

  expect(
    readE2eSqliteRows(
      e2eWeb.paths.databaseFilePath,
      `
        SELECT company_name, email, email_sender_address, iban
        FROM company_settings
      `,
    ),
  ).toEqual([
    {
      company_name: 'E2E Rakentaja Oy',
      email: sensitiveValues.email,
      email_sender_address: sensitiveValues.sender,
      iban: sensitiveValues.iban,
    },
  ]);
  expect(
    readE2eSqliteRows(
      e2eWeb.paths.databaseFilePath,
      `
        SELECT action, changed_field_categories
        FROM company_settings_audit_events
      `,
    ),
  ).toEqual([
    {
      action: 'companySettings.updated',
      changed_field_categories:
        '["identity","address","contact","banking","invoicingDefaults","emailConfiguration"]',
    },
  ]);

  await e2eWeb.page.getByRole('button', { name: 'Tapahtumat' }).click();
  await expect(
    e2eWeb.page
      .getByRole('main')
      .getByRole('heading', { name: 'Tapahtumat' }),
  ).toBeVisible();
  await expect(
    e2eWeb.page.getByText('Useita tietoryhmiä päivitettiin'),
  ).toBeVisible();
  const activityHtml = await e2eWeb.page.content();
  for (const privateValue of Object.values(sensitiveValues)) {
    expect(activityHtml).not.toContain(privateValue);
  }

  const activityResponse = await e2eWeb.api.get(
    '/activity?category=companySettings&pageSize=100',
  );
  expect(activityResponse.status()).toBe(200);
  const activityText = JSON.stringify(await activityResponse.json());
  for (const privateValue of Object.values(sensitiveValues)) {
    expect(activityText).not.toContain(privateValue);
  }

  await e2eWeb.page.getByRole('button', { name: 'Oma yritys' }).click();
  await e2eWeb.page.getByRole('button', { name: 'Diagnostiikka' }).click();
  await expect(
    e2eWeb.page
      .getByRole('main')
      .getByRole('heading', { name: 'Diagnostiikka' }),
  ).toBeVisible();
  const diagnosticsResponse = await e2eWeb.api.get('/diagnostics/events');
  expect(diagnosticsResponse.status()).toBe(200);
  const diagnosticsText = JSON.stringify(await diagnosticsResponse.json());
  const diagnosticHtml = await e2eWeb.page.content();
  const logs = readE2eOperationalLogs(e2eWeb.paths.logsRoot);

  for (const privateValue of Object.values(sensitiveValues)) {
    expect(diagnosticsText).not.toContain(privateValue);
    expect(diagnosticHtml).not.toContain(privateValue);
    expect(logs).not.toContain(privateValue);
  }
});

async function createCustomerThroughUi(
  page: Page,
  input: {
    address: string;
    comment: string;
    customerNumber: string;
    name: string;
  },
): Promise<void> {
  await openNewCustomerForm(page, input.customerNumber);
  await fillCustomerFields(page, input);
  const createResponse = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname === '/customers',
  );
  await page.getByRole('button', { name: 'Lisää', exact: true }).click();
  expect((await createResponse).status()).toBe(201);
  await expect(
    page.getByRole('heading', { level: 2, name: input.name }),
  ).toBeVisible();
}

async function openNewCustomerForm(
  page: Page,
  customerNumber: string,
): Promise<void> {
  await page.getByRole('button', { name: 'Uusi asiakas' }).click();
  await page
    .getByRole('group', { name: 'Asiakasnumero' })
    .getByText('Syötä itse', { exact: true })
    .click();
  await page.getByLabel('Asiakasnumero *').fill(customerNumber);
}

async function fillCustomerFields(
  page: Page,
  input: {
    address: string;
    comment: string;
    name: string;
  },
): Promise<void> {
  await page.getByLabel('Nimi *').fill(input.name);
  await page.getByLabel('Katuosoite').fill(input.address);
  await page.getByLabel('Postinumero').fill('00100');
  await page.getByRole('textbox', { name: 'Kaupunki', exact: true }).fill(
    'Testikaupunki',
  );
  await page.getByLabel('Kommentti').fill(input.comment);
}

async function expectRejectedCustomerCreate(page: Page): Promise<void> {
  const createResponse = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname === '/customers',
  );
  await page.getByRole('button', { name: 'Lisää', exact: true }).click();
  expect((await createResponse).status()).toBe(400);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
