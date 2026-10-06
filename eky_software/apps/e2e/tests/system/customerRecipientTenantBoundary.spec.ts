import { DatabaseSync } from 'node:sqlite';
import type { APIRequestContext } from '@playwright/test';

import {
  createSyntheticCompanySettingsInput,
  createSyntheticCustomerInput,
  createSyntheticInvoiceDraftInput,
} from '../../src/data/syntheticBusinessInputs.js';
import { expect, test, type IsolatedBackendHarness } from '../../src/fixtures/isolatedBackendTest.js';

test('CUS-RECIPIENT-002 @security keeps other-company recipient and customer invoices hidden', async ({
  e2eBackend,
}) => {
  const originalCompanyId = selectFixtureCompany(e2eBackend.paths.databaseFilePath, 'other-e2e-company');
  await e2eBackend.restartBackend();
  await configureInvoicing(e2eBackend.api);
  const propertyManagerId = await createCustomer(e2eBackend.api, {
    customerNumber: 'E2E-TENANT-PM',
    customerType: 'propertyManager',
    name: 'Other Company Property Manager Oy',
  });
  const housingCompanyId = await createCustomer(e2eBackend.api, {
    customerNumber: 'E2E-TENANT-HC',
    customerType: 'housingCompany',
    managedByCustomerId: propertyManagerId,
    name: 'Other Company Housing Oy',
  });
  const approvedInvoiceId = await createApprovedInvoice(
    e2eBackend.api,
    housingCompanyId,
    propertyManagerId,
    'Other company approved recipient invoice',
  );
  const sentInvoiceId = await createApprovedInvoice(
    e2eBackend.api,
    housingCompanyId,
    propertyManagerId,
    'Other company sent recipient invoice',
  );
  await markInvoiceSent(e2eBackend.api, sentInvoiceId);

  // Create the complete foreign revision/document chain through its own trusted
  // runtime context; never rewrite immutable rows or disable their constraints.
  selectFixtureCompany(e2eBackend.paths.databaseFilePath, originalCompanyId);
  await e2eBackend.restartBackend();
  assertFixtureIntegrity(e2eBackend, [approvedInvoiceId, sentInvoiceId]);

  const recipientApproved = await e2eBackend.api.get(
    `/invoices?status=approved&page=1&pageSize=5&sort=invoiceDateDesc&billingRecipientCustomerId=${propertyManagerId}`,
  );
  expect(recipientApproved.status()).toBe(200);
  expect(await recipientApproved.json()).toMatchObject({
    invoicePage: {
      invoices: [],
      totalCount: 0,
    },
  });

  const recipientSent = await e2eBackend.api.get(
    `/sent-invoice-groups?page=1&pageSize=5&sort=invoiceDateDesc&billingRecipientCustomerId=${propertyManagerId}`,
  );
  expect(recipientSent.status()).toBe(200);
  expect(await recipientSent.json()).toMatchObject({
    invoiceGroupPage: {
      groups: [],
      totalCount: 0,
    },
  });

  const customerOwned = await e2eBackend.api.get(
    `/invoices?status=approved&page=1&pageSize=5&sort=invoiceDateDesc&customerId=${housingCompanyId}`,
  );
  expect(customerOwned.status()).toBe(200);
  expect(await customerOwned.json()).toMatchObject({
    invoicePage: {
      invoices: [],
      totalCount: 0,
    },
  });
  expect(
    (await e2eBackend.api.get(`/invoices/${approvedInvoiceId}`)).status(),
  ).toBe(404);
  expect(
    (await e2eBackend.api.get(`/customers/${housingCompanyId}`)).status(),
  ).toBe(404);
});

async function configureInvoicing(api: APIRequestContext): Promise<void> {
  expect(
    (
      await api.put('/company-settings', {
        data: createSyntheticCompanySettingsInput(),
      })
    ).status(),
  ).toBe(200);
  expect(
    (
      await api.put('/invoice-numbering-settings', {
        data: {
          firstSequenceNumber: 1,
          fiscalYearStartMonth: 1,
          mode: 'calendarYearSequence',
          sequencePadding: 4,
        },
      })
    ).status(),
  ).toBe(200);
}

async function createCustomer(
  api: APIRequestContext,
  overrides: Record<string, unknown>,
): Promise<string> {
  const response = await api.post('/customers', {
    data: createSyntheticCustomerInput(overrides),
  });
  expect(response.status()).toBe(201);
  const body = (await response.json()) as {
    customer: { id: string };
  };

  return body.customer.id;
}

async function createApprovedInvoice(
  api: APIRequestContext,
  customerId: string,
  billingRecipientCustomerId: string,
  subject: string,
): Promise<string> {
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
    approvedInvoice: { invoiceId: string };
  };

  return approvalBody.approvedInvoice.invoiceId;
}

async function markInvoiceSent(
  api: APIRequestContext,
  invoiceId: string,
): Promise<void> {
  expect([200, 201]).toContain(
    (await api.post(`/invoices/${invoiceId}/pdf`)).status(),
  );
  expect(
    (
      await api.post(`/invoices/${invoiceId}/mark-sent`, {
        data: { deliveryMethod: 'manual' },
      })
    ).status(),
  ).toBe(200);
}

function selectFixtureCompany(
  databaseFilePath: string,
  companyId: string,
): string {
  const database = new DatabaseSync(databaseFilePath);

  try {
    database.exec('PRAGMA busy_timeout = 5000;');
    const identity = database.prepare(
      "SELECT company_id FROM local_runtime_identity WHERE singleton_key = 'local-runtime'",
    ).get() as { company_id: string };
    expect(database.prepare(
      "UPDATE local_runtime_identity SET company_id = ? WHERE singleton_key = 'local-runtime' AND company_id = ?",
    ).run(companyId, identity.company_id).changes).toBe(1);
    return identity.company_id;
  } finally {
    database.close();
  }
}

function assertFixtureIntegrity(harness: IsolatedBackendHarness, invoiceIds: readonly string[]): void {
  const database = new DatabaseSync(harness.paths.databaseFilePath, { readOnly: true });
  try {
    expect(database.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    expect(database.prepare('PRAGMA integrity_check').all()).toEqual([{ integrity_check: 'ok' }]);
    for (const invoiceId of invoiceIds) {
      expect(database.prepare(`SELECT r.company_id, r.origin FROM invoice_content_revisions r
        JOIN invoice_current_revisions c ON c.company_id = r.company_id
          AND c.invoice_id = r.invoice_id AND c.revision_id = r.id
        WHERE r.invoice_id = ?`).all(invoiceId))
        .toEqual([{ company_id: 'other-e2e-company', origin: 'approval' }]);
    }
  } finally { database.close(); }
}
