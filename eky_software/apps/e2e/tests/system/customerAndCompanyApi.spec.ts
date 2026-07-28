import {
  createSyntheticCompanySettingsInput,
  createSyntheticCustomerInput,
} from '../../src/data/syntheticBusinessInputs.js';
import { expect, test } from '../../src/fixtures/isolatedBackendTest.js';

test('CUS-API-001 @critical creates, updates and lists a customer with safe activity', async ({
  e2eBackend,
}) => {
  const createInput = createSyntheticCustomerInput();
  const createResponse = await e2eBackend.api.post('/customers', {
    data: createInput,
  });
  expect(createResponse.status()).toBe(201);
  const createdBody = (await createResponse.json()) as {
    customer: Record<string, unknown>;
  };
  expect(createdBody.customer).toMatchObject({
    customerNumber: 'E2E-1001',
    name: 'Synthetic Customer Oy',
    status: 'active',
  });
  const customerId = String(createdBody.customer.id);

  const updateResponse = await e2eBackend.api.put(`/customers/${customerId}`, {
    data: createSyntheticCustomerInput({
      comment: 'Updated synthetic customer',
      name: 'Updated Synthetic Customer Oy',
    }),
  });
  expect(updateResponse.status()).toBe(200);
  const updatedBody = (await updateResponse.json()) as {
    customer: Record<string, unknown>;
  };
  expect(updatedBody.customer).toMatchObject({
    id: customerId,
    name: 'Updated Synthetic Customer Oy',
  });

  const listResponse = await e2eBackend.api.get(
    '/customers?companyId=forged-company',
  );
  expect(listResponse.status()).toBe(200);
  const listBody = (await listResponse.json()) as {
    customers: Record<string, unknown>[];
  };
  expect(listBody.customers).toHaveLength(1);
  expect(listBody.customers[0]).toMatchObject({
    id: customerId,
    name: 'Updated Synthetic Customer Oy',
  });
  expect(listBody.customers[0]?.companyId).not.toBe('forged-company');

  const activityResponse = await e2eBackend.api.get(
    '/activity?category=customers&page=1&pageSize=20',
  );
  expect(activityResponse.status()).toBe(200);
  const activityText = await activityResponse.text();
  const activityBody = JSON.parse(activityText) as {
    activityItems: Array<Record<string, unknown>>;
  };
  expect(activityBody.activityItems.map((item) => item.type)).toEqual([
    'customer.updated',
    'customer.created',
  ]);
  expect(activityText).not.toContain('Updated Synthetic Customer Oy');
  expect(activityText).not.toContain('customer@example.invalid');
  expect(activityText).not.toContain('Testikatu 1');
});

test('COMPANY-AUDIT-001 @critical stores settings while activity exposes only changed categories', async ({
  e2eBackend,
}) => {
  const settingsInput = createSyntheticCompanySettingsInput();
  const updateResponse = await e2eBackend.api.put('/company-settings', {
    data: settingsInput,
  });
  expect(updateResponse.status()).toBe(200);
  const settingsBody = (await updateResponse.json()) as {
    companySettings: Record<string, unknown>;
  };
  expect(settingsBody.companySettings).toMatchObject({
    bankName: 'Synthetic Bank',
    companyName: 'Synthetic Builder Oy',
    emailSenderAddress: 'billing@example.invalid',
    iban: 'FI2112345600000785',
  });

  const activityResponse = await e2eBackend.api.get(
    '/activity?category=companySettings&page=1&pageSize=20',
  );
  expect(activityResponse.status()).toBe(200);
  const activityText = await activityResponse.text();
  const activityBody = JSON.parse(activityText) as {
    activityItems: Array<Record<string, unknown>>;
  };
  expect(activityBody.activityItems).toHaveLength(1);
  expect(activityBody.activityItems[0]).toMatchObject({
    module: 'companySettings',
    outcome: 'success',
    type: 'companySettings.updated',
  });
  expect(activityBody.activityItems[0]?.changeCategories).toEqual(
    expect.arrayContaining([
      'banking',
      'emailConfiguration',
      'identity',
    ]),
  );
  expect(activityText).not.toContain('FI2112345600000785');
  expect(activityText).not.toContain('billing@example.invalid');
  expect(activityText).not.toContain('NDEAFIHH');
});
