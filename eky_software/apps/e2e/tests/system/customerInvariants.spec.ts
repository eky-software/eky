import { readE2eSqliteRows } from '../../src/assertions/readE2eSqliteRows.js';
import { createSyntheticCustomerInput } from '../../src/data/syntheticBusinessInputs.js';
import { expect, test } from '../../src/fixtures/isolatedBackendTest.js';

for (const status of ['active', 'inactive']) {
  test(`CUS-REL-004 @critical @security protects an ${status} housing relationship through restart`, async ({ e2eBackend }) => {
    const managerInput = createSyntheticCustomerInput({
      customerNumber: 'E2E-MANAGER', customerType: 'propertyManager',
    });
    const createdManager = await e2eBackend.api.post('/customers', { data: managerInput });
    expect(createdManager.status()).toBe(201);
    const { customer: manager } = await createdManager.json() as { customer: { id: string } };
    const housingInput = createSyntheticCustomerInput({
      customerNumber: 'E2E-HOUSING', customerType: 'housingCompany',
      managedByCustomerId: manager.id, status,
    });
    const createdHousing = await e2eBackend.api.post('/customers', { data: housingInput });
    expect(createdHousing.status()).toBe(201);
    const { customer: housing } = await createdHousing.json() as { customer: { id: string } };

    const denied = await e2eBackend.api.put(`/customers/${manager.id}`, {
      data: { ...managerInput, customerType: 'company' },
    });
    expect(denied.status()).toBe(400);
    expect(await denied.json()).toEqual({ error: 'Referenced property manager type cannot be changed.' });
    expect(readE2eSqliteRows(e2eBackend.paths.databaseFilePath,
      'SELECT action FROM customer_audit_events')).toHaveLength(2);

    const edited = await e2eBackend.api.put(`/customers/${manager.id}`, {
      data: { ...managerInput, name: 'Updated synthetic manager' },
    });
    expect(edited.status()).toBe(200);
    const detached = await e2eBackend.api.put(`/customers/${housing.id}`, {
      data: { ...housingInput, managedByCustomerId: '' },
    });
    expect(detached.status()).toBe(200);
    const retyped = await e2eBackend.api.put(`/customers/${manager.id}`, {
      data: { ...managerInput, customerType: 'company' },
    });
    expect(retyped.status()).toBe(200);

    await e2eBackend.restartBackend();
    const managerRead = await e2eBackend.api.get(`/customers/${manager.id}`);
    const housingRead = await e2eBackend.api.get(`/customers/${housing.id}`);
    expect(managerRead.status()).toBe(200);
    expect(housingRead.status()).toBe(200);
    expect(await managerRead.json()).toMatchObject({ customer: { customerType: 'company' } });
    expect(await housingRead.json()).toMatchObject({ customer: { managedByCustomerId: '', status } });
  });
}

test('CUS-NUM-001 @critical @security preserves exact customer numbers and rejects exhaustion over HTTP', async ({ e2eBackend }) => {
  for (const [manual, expected] of [
    ['9007199254740992', '9007199254740993'],
    ['9'.repeat(49), `1${'0'.repeat(49)}`],
  ]) {
    const manualResponse = await e2eBackend.api.post('/customers', {
      data: createSyntheticCustomerInput({ customerNumber: manual }),
    });
    expect(manualResponse.status()).toBe(201);
    const automatic = await e2eBackend.api.post('/customers', {
      data: createSyntheticCustomerInput({ customerNumberMode: 'auto' }),
    });
    expect(automatic.status()).toBe(201);
    expect(await automatic.json()).toMatchObject({ customer: { customerNumber: expected } });
  }

  const lastManual = await e2eBackend.api.post('/customers', {
    data: createSyntheticCustomerInput({ customerNumber: '9'.repeat(50) }),
  });
  expect(lastManual.status()).toBe(201);
  const exhausted = await e2eBackend.api.post('/customers', {
    data: createSyntheticCustomerInput({ customerNumberMode: 'auto' }),
  });
  expect(exhausted.status()).toBe(400);
  expect(await exhausted.json()).toEqual({ error: 'Customer number range is exhausted.' });
  const listed = await e2eBackend.api.get('/customers');
  expect(listed.status()).toBe(200);
  const beforeRestart = await listed.json();
  expect(beforeRestart.customers).toHaveLength(5);
  expect(readE2eSqliteRows(e2eBackend.paths.databaseFilePath,
    'SELECT action FROM customer_audit_events')).toHaveLength(5);

  await e2eBackend.restartBackend();
  const afterRestart = await e2eBackend.api.get('/customers');
  expect(afterRestart.status()).toBe(200);
  expect(await afterRestart.json()).toEqual(beforeRestart);
});
