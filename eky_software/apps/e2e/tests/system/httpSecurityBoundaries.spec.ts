import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { expectSafeHttpError } from '../../src/assertions/expectSafeHttpError.js';
import { securityPayloadCorpus } from '../../src/data/securityPayloadCorpus.js';
import {
  createSyntheticCustomerInput,
  createSyntheticInvoiceDraftInput,
} from '../../src/data/syntheticBusinessInputs.js';
import {
  expect,
  test,
  type IsolatedBackendHarness,
} from '../../src/fixtures/isolatedBackendTest.js';

test('SEC-MASS-001 @security rejects server-owned and unknown invoice fields without persistence', async ({
  e2eBackend,
}) => {
  const customerId = await createCustomer(e2eBackend);

  for (const [fieldName, value] of Object.entries(
    securityPayloadCorpus.massAssignmentFields,
  )) {
    const response = await e2eBackend.api.post('/invoice-drafts', {
      data: createSyntheticInvoiceDraftInput(customerId, {
        [fieldName]: value,
      }),
    });
    await expectSafeHttpError(response, [400], [String(value)]);
  }

  const nestedResponse = await e2eBackend.api.post('/invoice-drafts', {
    data: createSyntheticInvoiceDraftInput(customerId, {
      lines: [
        {
          code: 'WORK',
          companyId: 'forged-company',
          description: 'Synthetic work',
          discount: { type: 'none' },
          quantityHundredths: 100,
          unit: 'h',
          unitPriceCents: 6_500,
          vatRateBasisPoints: 2_550,
        },
      ],
    }),
  });
  await expectSafeHttpError(nestedResponse, [400], ['forged-company']);

  const listResponse = await e2eBackend.api.get('/invoice-drafts');
  expect(listResponse.status()).toBe(200);
  await expect(listResponse.json()).resolves.toEqual({ invoiceDrafts: [] });
});

test('SEC-PROTOTYPE-001 @security rejects prototype keys and remains healthy', async ({
  e2eBackend,
}) => {
  const customerId = await createCustomer(e2eBackend);
  const validBody = createSyntheticInvoiceDraftInput(customerId);

  for (const key of securityPayloadCorpus.prototypeJsonKeys) {
    const rawBody = JSON.stringify(validBody).replace(
      /}$/,
      `,"${key}":{"polluted":"yes"}}`,
    );
    const response = await e2eBackend.api.post('/invoice-drafts', {
      data: rawBody,
      headers: { 'Content-Type': 'application/json' },
    });
    await expectSafeHttpError(response, [400], ['polluted']);
  }

  expect((Object.prototype as { polluted?: string }).polluted).toBeUndefined();
  const validResponse = await e2eBackend.api.post('/invoice-drafts', {
    data: validBody,
  });
  expect(validResponse.status()).toBe(201);
  expect((await e2eBackend.anonymousApi.get('/health')).status()).toBe(200);
});

test('SEC-INJECTION-001 @security preserves allowed text literally without log injection', async ({
  e2eBackend,
}) => {
  const response = await e2eBackend.api.post('/customers', {
    data: createSyntheticCustomerInput({
      comment: `${securityPayloadCorpus.htmlText}\n${securityPayloadCorpus.svgText}`,
      name: securityPayloadCorpus.sqlLikeText,
    }),
  });
  expect(response.status()).toBe(201);

  const listResponse = await e2eBackend.api.get('/customers');
  expect(listResponse.status()).toBe(200);
  const listBody = (await listResponse.json()) as {
    customers: Array<Record<string, unknown>>;
  };
  expect(listBody.customers).toHaveLength(1);
  expect(listBody.customers[0]?.name).toBe(securityPayloadCorpus.sqlLikeText);
  expect(listBody.customers[0]?.comment).toBe(
    `${securityPayloadCorpus.htmlText}\n${securityPayloadCorpus.svgText}`,
  );

  const logs = readAllFiles(e2eBackend.paths.logsRoot);
  expect(logs).not.toContain(securityPayloadCorpus.sqlLikeText);
  expect(logs).not.toContain(securityPayloadCorpus.htmlText);
  expect(logs).not.toContain(securityPayloadCorpus.svgText);
  expect(logs).not.toContain('DROP TABLE customers');

  const secondCreate = await e2eBackend.api.post('/customers', {
    data: createSyntheticCustomerInput({
      customerNumber: 'E2E-1002',
      name: 'Still Healthy Oy',
    }),
  });
  expect(secondCreate.status()).toBe(201);
});

test('SEC-TYPE-001 @security rejects wrong string field types without persistence', async ({
  e2eBackend,
}) => {
  const companySettingsBefore = await e2eBackend.api.get('/company-settings');
  expect(companySettingsBefore.status()).toBe(200);
  const companySettingsBodyBefore = await companySettingsBefore.json();

  for (const invalidValue of [123, true, [], {}]) {
    const customerResponse = await e2eBackend.api.post('/customers', {
      data: {
        ...createSyntheticCustomerInput(),
        email: invalidValue,
      },
    });
    await expectSafeHttpError(customerResponse, [400]);

    const settingsResponse = await e2eBackend.api.put('/company-settings', {
      data: {
        companyName: invalidValue,
      },
    });
    await expectSafeHttpError(settingsResponse, [400]);
  }

  const customersResponse = await e2eBackend.api.get('/customers');
  expect(customersResponse.status()).toBe(200);
  await expect(customersResponse.json()).resolves.toEqual({ customers: [] });

  const companySettingsAfter = await e2eBackend.api.get('/company-settings');
  expect(companySettingsAfter.status()).toBe(200);
  await expect(companySettingsAfter.json()).resolves.toEqual(
    companySettingsBodyBefore,
  );
});

test('SEC-PATH-001 @security rejects traversal and absolute resource identifiers without writes', async ({
  e2eBackend,
}) => {
  for (const pathValue of securityPayloadCorpus.pathValues) {
    const encodedId = encodeURIComponent(pathValue);
    const draftResponse = await e2eBackend.api.get(
      `/invoice-drafts/${encodedId}`,
    );
    await expectSafeHttpError(draftResponse, [400, 404], [pathValue]);

    const pdfResponse = await e2eBackend.api.get(
      `/invoices/${encodedId}/pdf`,
    );
    await expectSafeHttpError(pdfResponse, [400, 404], [pathValue]);
  }

  expect(readdirSync(e2eBackend.paths.documentsRoot)).toEqual([]);
  expect((await e2eBackend.anonymousApi.get('/health')).status()).toBe(200);
});

test('SEC-SIZE-001 @security enforces bounded invoice fields, arrays and body size', async ({
  e2eBackend,
}) => {
  const customerId = await createCustomer(e2eBackend);
  const maximumResponse = await e2eBackend.api.post('/invoice-drafts', {
    data: createSyntheticInvoiceDraftInput(customerId, {
      note: 'A'.repeat(5_000),
    }),
  });
  expect(maximumResponse.status()).toBe(201);

  const overFieldLimit = await e2eBackend.api.post('/invoice-drafts', {
    data: createSyntheticInvoiceDraftInput(customerId, {
      note: 'A'.repeat(5_001),
    }),
  });
  await expectSafeHttpError(overFieldLimit, [400]);

  const tooManyLines = await e2eBackend.api.post('/invoice-drafts', {
    data: createSyntheticInvoiceDraftInput(customerId, {
      lines: Array.from({ length: 501 }, () => ({
        code: '',
        description: 'Synthetic line',
        discount: { type: 'none' },
        quantityHundredths: 100,
        unit: 'h',
        unitPriceCents: 100,
        vatRateBasisPoints: 2_550,
      })),
    }),
  });
  await expectSafeHttpError(tooManyLines, [400]);

  const oversizedBody = await e2eBackend.api.post('/invoice-drafts', {
    data: JSON.stringify(
      createSyntheticInvoiceDraftInput(customerId, {
        note: 'A'.repeat(270 * 1_024),
      }),
    ),
    headers: { 'Content-Type': 'application/json' },
  });
  await expectSafeHttpError(oversizedBody, [413]);
  expect(e2eBackend.backend.managedProcess.child.exitCode).toBeNull();
  const healthResponse = await fetch(
    `${e2eBackend.backend.backendOrigin}/health`,
  );
  expect(healthResponse.status).toBe(200);
});

test('SEC-METHOD-001 @security rejects wrong methods', async ({
  e2eBackend,
}) => {
  const customerId = await createCustomer(e2eBackend);
  const wrongMethod = await e2eBackend.api.patch(`/customers/${customerId}`, {
    data: createSyntheticCustomerInput(),
  });
  await expectSafeHttpError(wrongMethod, [404, 405]);
});

test('SEC-METHOD-001 @security rejects text/plain JSON bodies', async ({
  e2eBackend,
}) => {
  const customerId = await createCustomer(e2eBackend);
  const response = await e2eBackend.api.post('/invoice-drafts', {
    data: JSON.stringify(createSyntheticInvoiceDraftInput(customerId)),
    headers: { 'Content-Type': 'text/plain' },
  });
  await expectSafeHttpError(response, [415]);
});

test('SEC-METHOD-001 @security rejects JSON bodies without a media type', async ({
  e2eBackend,
}) => {
  const customerId = await createCustomer(e2eBackend);
  const response = await e2eBackend.api.post('/invoice-drafts', {
    data: JSON.stringify(createSyntheticInvoiceDraftInput(customerId)),
    headers: {},
  });
  await expectSafeHttpError(response, [415]);
});

test('SEC-METHOD-001 @security rejects unsupported query keys and remains healthy', async ({
  e2eBackend,
}) => {
  const unknownQuery = await e2eBackend.api.get(
    '/activity?companyId=forged-company',
  );
  await expectSafeHttpError(unknownQuery, [400], ['forged-company']);
  expect((await e2eBackend.anonymousApi.get('/health')).status()).toBe(200);
});

async function createCustomer(
  e2eBackend: IsolatedBackendHarness,
): Promise<string> {
  const response = await e2eBackend.api.post('/customers', {
    data: createSyntheticCustomerInput(),
  });
  expect(response.status()).toBe(201);
  const body = (await response.json()) as {
    customer: { id: string };
  };
  return body.customer.id;
}

function readAllFiles(directory: string): string {
  return readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const path = join(directory, entry.name);
      return entry.isDirectory() ? readAllFiles(path) : readFileSync(path, 'utf8');
    })
    .join('\n');
}
