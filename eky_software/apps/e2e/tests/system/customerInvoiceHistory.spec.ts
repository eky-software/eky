import { readE2eSqliteRows } from '../../src/assertions/readE2eSqliteRows.js';
import { createSyntheticCustomerInput } from '../../src/data/syntheticBusinessInputs.js';
import { expect, test } from '../../src/fixtures/isolatedBackendTest.js';
import { createApprovedInvoiceWithPdf } from '../../src/journeys/invoicingApiJourney.js';

test('CUS-SNAPSHOT-001 @critical @cross-module preserves delivered invoice history after customer edits and restart', async ({ e2eBackend }) => {
  const { invoiceId } = await createApprovedInvoiceWithPdf(e2eBackend.api);
  const invoicePath = `/invoices/${invoiceId}`;
  const prepared = await e2eBackend.api.post(`${invoicePath}/email/dry-run`);
  expect(prepared.status()).toBe(200);
  const { email } = await prepared.json() as {
    email: { to: string; subject: string; body: string };
  };
  const delivered = await e2eBackend.api.post(`${invoicePath}/email/dry-run/send`, {
    data: { to: email.to, subject: email.subject, body: email.body },
  });
  expect(delivered.status()).toBe(200);

  const invoiceResponse = await e2eBackend.api.get(invoicePath);
  expect(invoiceResponse.status()).toBe(200);
  const beforeInvoice = await invoiceResponse.json();
  const customerId = beforeInvoice.invoice.customerId as string;
  expect(typeof customerId).toBe('string');
  const documentResponse = await e2eBackend.api.get(`${invoicePath}/pdf`);
  expect(documentResponse.status()).toBe(200);
  const beforePdf = await documentResponse.body();
  expect(beforePdf.length).toBeGreaterThan(0);
  const historyResponse = await e2eBackend.api.get(`${invoicePath}/delivery-events`);
  expect(historyResponse.status()).toBe(200);
  const beforeHistory = await historyResponse.json();
  const beforeRows = readHistoryRows();
  for (const rows of Object.values(beforeRows)) expect(rows.length).toBeGreaterThan(0);

  const updatedCustomer = await e2eBackend.api.put(`/customers/${customerId}`, {
    data: createSyntheticCustomerInput({
      customerNumber: 'E2E-UPDATED-CUSTOMER', customerType: 'propertyManager',
      name: 'Changed synthetic master data', email: 'changed@example.invalid',
    }),
  });
  expect(updatedCustomer.status()).toBe(200);
  expect(await updatedCustomer.json()).toMatchObject({ customer: {
    customerNumber: 'E2E-UPDATED-CUSTOMER', customerType: 'propertyManager',
    name: 'Changed synthetic master data',
  } });

  await e2eBackend.restartBackend();
  const afterInvoice = await e2eBackend.api.get(invoicePath);
  const afterPdf = await e2eBackend.api.get(`${invoicePath}/pdf`);
  const afterHistory = await e2eBackend.api.get(`${invoicePath}/delivery-events`);
  expect(afterInvoice.status()).toBe(200);
  expect(afterPdf.status()).toBe(200);
  expect(afterHistory.status()).toBe(200);
  expect(await afterInvoice.json()).toEqual(beforeInvoice);
  expect((await afterPdf.body()).equals(beforePdf)).toBe(true);
  expect(await afterHistory.json()).toEqual(beforeHistory);
  expect(readHistoryRows()).toEqual(beforeRows);
  const afterCustomer = await e2eBackend.api.get(`/customers/${customerId}`);
  expect(afterCustomer.status()).toBe(200);
  expect(await afterCustomer.json()).toMatchObject({ customer: {
    customerType: 'propertyManager', name: 'Changed synthetic master data',
  } });

  function readHistoryRows() {
    const file = e2eBackend.paths.databaseFilePath;
    return {
      revisions: readE2eSqliteRows(file,
        'SELECT * FROM invoice_content_revisions WHERE invoice_id = ? ORDER BY id', invoiceId),
      documents: readE2eSqliteRows(file,
        'SELECT * FROM invoice_documents WHERE invoice_id = ? ORDER BY id', invoiceId),
      events: readE2eSqliteRows(file,
        'SELECT * FROM invoice_delivery_events WHERE invoice_id = ? ORDER BY id', invoiceId),
    };
  }
});
