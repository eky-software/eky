import type { Route } from '@playwright/test';

import { createSyntheticCustomerInput } from '../../src/data/syntheticBusinessInputs.js';
import { expect, test } from '../../src/fixtures/isolatedWebTest.js';

const fallback = 'Jotain meni vikaan.';

for (const [operation, unknownMessage] of [
  ['list', 'E2E_SYNTHETIC_PRIVATE_ERROR'],
  ['detail', 'constructor'],
  ['create', 'toString'],
  ['update', '__proto__'],
] as const) {
  test(`CUS-ERROR-001 @critical @fault @security hides unknown API errors during ${operation}`, async ({ e2eWeb }) => {
    const { page } = e2eWeb;
    const expectedFallback = operation === 'detail'
      ? 'Asiakaskorttia ei voitu ladata. Yritä hetken kuluttua uudelleen.' : fallback;
    const customerInput = createSyntheticCustomerInput({
      customerNumber: 'E2E-ERROR', name: 'E2E Error Customer',
    });
    let customerId = '';
    if (operation === 'detail' || operation === 'update') {
      const created = await e2eWeb.api.post('/customers', { data: customerInput });
      expect(created.status()).toBe(201);
      const { customer } = await created.json() as { customer: { id: string } };
      customerId = customer.id;
      await page.reload();
      await expect(page.getByRole('button', { name: /E2E Error Customer/ })).toBeVisible();
    }
    const pattern = operation === 'detail' || operation === 'update'
      ? `**/customers/${customerId}` : '**/customers';
    const method = operation === 'create' ? 'POST' : operation === 'update' ? 'PUT' : 'GET';
    const failRequest = async (route: Route) => {
      if (route.request().method() !== method) return route.continue();
      await route.fulfill({ status: 500, json: { error: unknownMessage } });
    };
    await page.route(pattern, failRequest);

    if (operation === 'list') {
      await page.reload();
    } else if (operation === 'detail') {
      await page.getByRole('button', { name: /E2E Error Customer/ }).click();
    } else {
      if (operation === 'create') {
        await page.getByRole('button', { name: 'Uusi asiakas', exact: true }).click();
      } else {
        await page.getByRole('button', { name: /E2E Error Customer/ }).click();
        await page.getByRole('button', { name: 'Muokkaa', exact: true }).click();
      }
      await page.getByLabel('Nimi *').fill('Preserved synthetic edit');
      await page.getByRole('button', {
        name: operation === 'create' ? 'Lisää' : 'Tallenna muutokset', exact: true,
      }).click();
    }

    await expect(page.getByText(expectedFallback, { exact: true })).toBeVisible();
    await expect(page.getByText(unknownMessage, { exact: true })).toHaveCount(0);
    if (operation === 'create' || operation === 'update') {
      await expect(page.getByLabel('Nimi *')).toHaveValue('Preserved synthetic edit');
      await expect(page.getByRole('button', {
        name: operation === 'create' ? 'Lisää' : 'Tallenna muutokset', exact: true,
      })).toBeEnabled();
    }
    await page.unroute(pattern, failRequest);
    if (operation === 'create') {
      await page.getByLabel('Asiakaskohtainen tuntihinta €/h').fill('not-a-price');
      await page.getByRole('button', { name: 'Lisää', exact: true }).click();
      await expect(page.getByText(
        'Tuntihinnan pitää olla euroina, esimerkiksi 65 tai 65,50.', { exact: true },
      )).toBeVisible();
      await expect(page.getByLabel('Nimi *')).toHaveValue('Preserved synthetic edit');
    }
    await page.reload();
    await expect(page.getByText(expectedFallback, { exact: true })).toHaveCount(0);
    const listed = await e2eWeb.api.get('/customers');
    expect(listed.status()).toBe(200);
    expect((await listed.json()).customers).toHaveLength(operation === 'create' || operation === 'list' ? 0 : 1);
  });
}

test('CUS-REL-005 @critical explains the manager type-change block and preserves the form', async ({ e2eWeb }) => {
  const managerInput = createSyntheticCustomerInput({
    customerNumber: 'E2E-MANAGER', customerType: 'propertyManager', name: 'E2E Protected Manager',
  });
  const managerResponse = await e2eWeb.api.post('/customers', { data: managerInput });
  expect(managerResponse.status()).toBe(201);
  const { customer: manager } = await managerResponse.json() as { customer: { id: string } };
  const housingInput = createSyntheticCustomerInput({
    customerNumber: 'E2E-HOUSING', customerType: 'housingCompany',
    managedByCustomerId: manager.id, status: 'inactive',
  });
  const housingResponse = await e2eWeb.api.post('/customers', { data: housingInput });
  expect(housingResponse.status()).toBe(201);
  const { customer: housing } = await housingResponse.json() as { customer: { id: string } };
  const { page } = e2eWeb;
  await page.reload();
  await page.getByRole('button', { name: /E2E Protected Manager/ }).click();
  await page.getByRole('button', { name: 'Muokkaa', exact: true }).click();
  await page.getByLabel('Asiakastyyppi *').selectOption('company');
  await page.getByRole('button', { name: 'Tallenna muutokset', exact: true }).click();
  await expect(page.getByText(/Isännöitsijätoimiston tyyppiä ei voi muuttaa/)).toBeVisible();
  await expect(page.getByLabel('Asiakastyyppi *')).toHaveValue('company');
  await expect(page.getByLabel('Nimi *')).toHaveValue('E2E Protected Manager');
  const deniedRead = await e2eWeb.api.get(`/customers/${manager.id}`);
  expect(deniedRead.status()).toBe(200);
  expect(await deniedRead.json()).toMatchObject({ customer: { customerType: 'propertyManager' } });

  const detached = await e2eWeb.api.put(`/customers/${housing.id}`, {
    data: { ...housingInput, managedByCustomerId: '' },
  });
  expect(detached.status()).toBe(200);
  await page.getByRole('button', { name: 'Tallenna muutokset', exact: true }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'E2E Protected Manager' })).toBeVisible();
  await expect(page.getByLabel('Nimi *')).toHaveCount(0);
  const finalRead = await e2eWeb.api.get(`/customers/${manager.id}`);
  expect(finalRead.status()).toBe(200);
  expect(await finalRead.json()).toMatchObject({ customer: { customerType: 'company' } });
});
