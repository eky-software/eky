import { request as sendHttpRequest } from 'node:http';

import type {
  APIRequestContext,
  APIResponse,
} from '@playwright/test';

import { expectSafeHttpError } from '../../src/assertions/expectSafeHttpError.js';
import {
  createSyntheticCompanySettingsInput,
  createSyntheticCustomerInput,
  createSyntheticInvoiceDraftInput,
} from '../../src/data/syntheticBusinessInputs.js';
import {
  expect,
  test,
  type IsolatedBackendHarness,
} from '../../src/fixtures/isolatedBackendTest.js';

type JsonMethod = 'DELETE' | 'POST' | 'PUT';

interface RequiredJsonRouteContract {
  acceptedStatuses: readonly number[];
  createValidBody(sequence: number): Record<string, unknown>;
  method: JsonMethod;
  maximumBodySizeBytes: number;
  name: string;
  path: string;
}

interface ForbiddenBodyRouteContract {
  emptyBodyStatuses: readonly number[];
  method: JsonMethod;
  maximumBodySizeBytes: number;
  name: string;
  path: string;
}

const emailBody = {
  body: 'Synthetic E2E invoice message.',
  cc: 'copy@example.invalid',
  subject: 'Synthetic invoice',
  to: 'recipient@example.invalid',
};
const emailSendBody = {
  ...emailBody,
  attemptId: 'synthetic-attempt',
  authorizationToken: 'synthetic-authorization',
};

test('SEC-JSON-001 @security enforces JSON body contracts for every audited mutation route', async ({
  e2eBackend,
}) => {
  const { customerId, invoiceDraftId } = await createContractFixtures(e2eBackend);
  const requiredContracts = createRequiredContracts({
    customerId,
    invoiceDraftId,
  });

  for (const contract of requiredContracts) {
    await expectAcceptedJson(contract, e2eBackend.api, 1, 'application/json');
    await expectAcceptedJson(
      contract,
      e2eBackend.api,
      2,
      'Application/JSON; Charset=UTF-8',
    );
    await expectRejectedMediaType(contract, e2eBackend.api, 'text/plain');
    await expectRejectedMissingMediaType(contract, e2eBackend.api);
    await expectMalformedJsonRejected(contract, e2eBackend.api);
    await expectUnknownFieldRejected(contract, e2eBackend.api);
    await expectBodySizeLimit(contract, e2eBackend.api);
  }

  await expectOptionalApprovalContract(e2eBackend.api);

  for (const contract of createForbiddenBodyContracts()) {
    await expectForbiddenBodyContract(contract, e2eBackend.api);
  }
  await expectChunkedBodyLimit(e2eBackend);

  expect((await e2eBackend.anonymousApi.get('/health')).status()).toBe(200);
});

function createRequiredContracts(input: {
  customerId: string;
  invoiceDraftId: string;
}): RequiredJsonRouteContract[] {
  return [
    {
      acceptedStatuses: [201],
      createValidBody: (sequence) =>
        createSyntheticCustomerInput({
          customerNumber: `E2E-JSON-${String(sequence)}`,
          name: `Synthetic JSON Customer ${String(sequence)} Oy`,
        }),
      method: 'POST',
      maximumBodySizeBytes: 16 * 1024,
      name: 'create customer',
      path: '/customers',
    },
    {
      acceptedStatuses: [200],
      createValidBody: () =>
        createSyntheticCustomerInput({
          customerNumber: 'E2E-JSON-BASE',
          name: 'Updated Synthetic JSON Customer Oy',
        }),
      method: 'PUT',
      maximumBodySizeBytes: 16 * 1024,
      name: 'update customer',
      path: `/customers/${input.customerId}`,
    },
    {
      acceptedStatuses: [200],
      createValidBody: () => createSyntheticCompanySettingsInput(),
      method: 'PUT',
      maximumBodySizeBytes: 16 * 1024,
      name: 'update company settings',
      path: '/company-settings',
    },
    {
      acceptedStatuses: [200],
      createValidBody: () => ({ secret: 'synthetic-e2e-secret' }),
      method: 'PUT',
      maximumBodySizeBytes: 4 * 1024,
      name: 'set company email secret',
      path: '/company-settings/email-secret',
    },
    {
      acceptedStatuses: [201],
      createValidBody: () => createSyntheticInvoiceDraftInput(input.customerId),
      method: 'POST',
      maximumBodySizeBytes: 256 * 1024,
      name: 'create invoice draft',
      path: '/invoice-drafts',
    },
    {
      acceptedStatuses: [200],
      createValidBody: () => createSyntheticInvoiceDraftInput(input.customerId),
      method: 'PUT',
      maximumBodySizeBytes: 256 * 1024,
      name: 'update invoice draft',
      path: `/invoice-drafts/${input.invoiceDraftId}`,
    },
    {
      acceptedStatuses: [404],
      createValidBody: () => ({
        lines: [],
        note: '',
        refundIban: '',
        subject: 'Synthetic credit',
      }),
      method: 'PUT',
      maximumBodySizeBytes: 256 * 1024,
      name: 'update credit invoice draft',
      path: '/invoice-drafts/missing-credit-draft/credit',
    },
    {
      acceptedStatuses: [200],
      createValidBody: () => ({
        vatRates: [
          {
            isActive: true,
            isDefault: true,
            label: '25,50 %',
            rateBasisPoints: 2_550,
            sortOrder: 0,
          },
        ],
      }),
      method: 'PUT',
      maximumBodySizeBytes: 32 * 1024,
      name: 'update invoice VAT rates',
      path: '/invoice-vat-rates',
    },
    {
      acceptedStatuses: [200],
      createValidBody: () => ({
        firstSequenceNumber: 1,
        fiscalYearStartMonth: 1,
        mode: 'calendarYearSequence',
        sequencePadding: 4,
      }),
      method: 'PUT',
      maximumBodySizeBytes: 16 * 1024,
      name: 'update invoice numbering settings',
      path: '/invoice-numbering-settings',
    },
    {
      acceptedStatuses: [200],
      createValidBody: () => ({
        defaultLatePaymentInterestBasisPoints: 950,
        defaultReminderPeriodDays: 14,
      }),
      method: 'PUT',
      maximumBodySizeBytes: 16 * 1024,
      name: 'update invoice payment settings',
      path: '/invoice-payment-settings',
    },
    {
      acceptedStatuses: [404],
      createValidBody: () => ({
        cancellationReason: 'Synthetic cancellation',
        confirmationInvoiceNumber: 'E2E-MISSING',
      }),
      method: 'POST',
      maximumBodySizeBytes: 8 * 1024,
      name: 'cancel approved invoice',
      path: '/invoices/missing-invoice/cancel',
    },
    {
      acceptedStatuses: [404],
      createValidBody: () => ({ deliveryMethod: 'manual' }),
      method: 'POST',
      maximumBodySizeBytes: 2 * 1024,
      name: 'mark approved invoice sent',
      path: '/invoices/missing-invoice/mark-sent',
    },
    {
      acceptedStatuses: [404],
      createValidBody: () => emailBody,
      method: 'POST',
      maximumBodySizeBytes: 96 * 1024,
      name: 'send dry-run invoice email',
      path: '/invoices/missing-invoice/email/dry-run/send',
    },
    {
      acceptedStatuses: [404],
      createValidBody: () => emailSendBody,
      method: 'POST',
      maximumBodySizeBytes: 96 * 1024,
      name: 'send SMTP test invoice email',
      path: '/invoices/missing-invoice/email/smtp-test/send',
    },
    {
      acceptedStatuses: [404],
      createValidBody: () => emailBody,
      method: 'POST',
      maximumBodySizeBytes: 96 * 1024,
      name: 'prepare SMTP test invoice email',
      path: '/invoices/missing-invoice/email/smtp-test/prepare',
    },
    {
      acceptedStatuses: [404],
      createValidBody: () => emailSendBody,
      method: 'POST',
      maximumBodySizeBytes: 96 * 1024,
      name: 'send SMTP invoice email',
      path: '/invoices/missing-invoice/email/smtp/send',
    },
    {
      acceptedStatuses: [404],
      createValidBody: () => emailBody,
      method: 'POST',
      maximumBodySizeBytes: 96 * 1024,
      name: 'prepare SMTP invoice email',
      path: '/invoices/missing-invoice/email/smtp/prepare',
    },
  ];
}

function createForbiddenBodyContracts(): ForbiddenBodyRouteContract[] {
  return [
    {
      emptyBodyStatuses: [404],
      method: 'POST',
      maximumBodySizeBytes: 1024,
      name: 'create credit invoice draft',
      path: '/invoices/missing-invoice/credit-draft',
    },
    {
      emptyBodyStatuses: [404],
      method: 'POST',
      maximumBodySizeBytes: 1024,
      name: 'approve credit invoice draft',
      path: '/invoice-drafts/missing-credit-draft/approve-credit',
    },
    {
      emptyBodyStatuses: [200],
      method: 'DELETE',
      maximumBodySizeBytes: 1024,
      name: 'remove company email secret',
      path: '/company-settings/email-secret',
    },
    {
      emptyBodyStatuses: [404],
      method: 'DELETE',
      maximumBodySizeBytes: 1024,
      name: 'delete invoice draft',
      path: '/invoice-drafts/missing-invoice-draft',
    },
    {
      emptyBodyStatuses: [404],
      method: 'POST',
      maximumBodySizeBytes: 1024,
      name: 'generate approved invoice PDF',
      path: '/invoices/missing-invoice/pdf',
    },
    {
      emptyBodyStatuses: [404],
      method: 'POST',
      maximumBodySizeBytes: 1024,
      name: 'reopen approved invoice',
      path: '/invoices/missing-invoice/reopen-for-edit',
    },
    {
      emptyBodyStatuses: [404],
      method: 'POST',
      maximumBodySizeBytes: 1024,
      name: 'copy approved invoice to draft',
      path: '/invoices/missing-invoice/copy-to-draft',
    },
    {
      emptyBodyStatuses: [404],
      method: 'POST',
      maximumBodySizeBytes: 1024,
      name: 'prepare dry-run invoice email',
      path: '/invoices/missing-invoice/email/dry-run',
    },
  ];
}

async function createContractFixtures(
  e2eBackend: IsolatedBackendHarness,
): Promise<{ customerId: string; invoiceDraftId: string }> {
  const customerResponse = await e2eBackend.api.post('/customers', {
    data: createSyntheticCustomerInput({
      customerNumber: 'E2E-JSON-BASE',
      name: 'Synthetic JSON Base Customer Oy',
    }),
  });
  expect(customerResponse.status()).toBe(201);
  const customerBody = (await customerResponse.json()) as {
    customer: { id: string };
  };

  const draftResponse = await e2eBackend.api.post('/invoice-drafts', {
    data: createSyntheticInvoiceDraftInput(customerBody.customer.id),
  });
  expect(draftResponse.status()).toBe(201);
  const draftBody = (await draftResponse.json()) as {
    invoiceDraft: { id: string };
  };

  return {
    customerId: customerBody.customer.id,
    invoiceDraftId: draftBody.invoiceDraft.id,
  };
}

async function expectAcceptedJson(
  contract: RequiredJsonRouteContract,
  api: APIRequestContext,
  sequence: number,
  contentType: string,
): Promise<void> {
  const response = await sendRawJson(
    api,
    contract.method,
    contract.path,
    JSON.stringify(contract.createValidBody(sequence)),
    contentType,
  );

  expect(
    contract.acceptedStatuses,
    `${contract.name} rejected ${contentType} with ${String(response.status())}`,
  ).toContain(response.status());
}

async function expectRejectedMediaType(
  contract: RequiredJsonRouteContract,
  api: APIRequestContext,
  contentType: string,
): Promise<void> {
  const marker = `body-${contract.name}`;
  const response = await sendRawJson(
    api,
    contract.method,
    contract.path,
    JSON.stringify({
      ...contract.createValidBody(3),
      marker,
    }),
    contentType,
  );

  await expectSafeHttpError(response, [415], [marker, contentType]);
}

async function expectRejectedMissingMediaType(
  contract: RequiredJsonRouteContract,
  api: APIRequestContext,
): Promise<void> {
  const marker = `missing-media-${contract.name}`;
  const response = await sendRawJson(
    api,
    contract.method,
    contract.path,
    JSON.stringify({
      ...contract.createValidBody(4),
      marker,
    }),
  );

  await expectSafeHttpError(response, [415], [marker]);
}

async function expectMalformedJsonRejected(
  contract: RequiredJsonRouteContract,
  api: APIRequestContext,
): Promise<void> {
  const marker = `malformed-${contract.name}`;
  const response = await sendRawJson(
    api,
    contract.method,
    contract.path,
    `{"marker":"${marker}"`,
    'application/json',
  );

  await expectSafeHttpError(response, [400], [marker]);
}

async function expectUnknownFieldRejected(
  contract: RequiredJsonRouteContract,
  api: APIRequestContext,
): Promise<void> {
  const marker = `unknown-${contract.name}`;
  const response = await sendRawJson(
    api,
    contract.method,
    contract.path,
    JSON.stringify({
      ...contract.createValidBody(5),
      unknownField: marker,
    }),
    'application/json',
  );

  await expectSafeHttpError(response, [400], [marker]);
}

async function expectOptionalApprovalContract(
  api: APIRequestContext,
): Promise<void> {
  const path = '/invoice-drafts/missing-invoice-draft/approve';
  for (const contentType of [
    'application/json',
    'Application/JSON; Charset=UTF-8',
  ]) {
    const response = await sendRawJson(api, 'POST', path, '{}', contentType);
    expect(response.status()).toBe(404);
  }

  await expectSafeHttpError(
    await sendRawJson(api, 'POST', path, '{}', 'text/plain'),
    [415],
    ['text/plain'],
  );
  await expectSafeHttpError(
    await sendRawJson(api, 'POST', path, '{}'),
    [415],
  );
  await expectSafeHttpError(
    await sendRawJson(api, 'POST', path, '{', 'application/json'),
    [400],
  );
  await expectSafeHttpError(
    await sendRawJson(
      api,
      'POST',
      path,
      JSON.stringify({ unknownField: 'optional-unknown' }),
      'application/json',
    ),
    [400],
    ['optional-unknown'],
  );

  const emptyResponse = await api.fetch(path, { method: 'POST' });
  expect(emptyResponse.status()).toBe(404);

  const maximumBody = padJsonBody('{}', 4 * 1024);
  expect(
    (await sendRawJson(
      api,
      'POST',
      path,
      maximumBody,
      'application/json',
    )).status(),
  ).toBe(404);
  await expectSafeHttpError(
    await sendRawJson(
      api,
      'POST',
      path,
      `${maximumBody} `,
      'application/json',
      true,
    ),
    [413],
  );
}

async function expectForbiddenBodyContract(
  contract: ForbiddenBodyRouteContract,
  api: APIRequestContext,
): Promise<void> {
  const emptyResponse = await api.fetch(contract.path, {
    method: contract.method,
  });
  expect(
    contract.emptyBodyStatuses,
    `${contract.name} rejected its allowed empty body unexpectedly`,
  ).toContain(emptyResponse.status());

  const requests: Array<Promise<APIResponse>> = [
    sendRawJson(api, contract.method, contract.path, '{}', 'application/json'),
    sendRawJson(
      api,
      contract.method,
      contract.path,
      '{}',
      'Application/JSON; Charset=UTF-8',
    ),
    sendRawJson(api, contract.method, contract.path, '{}', 'text/plain'),
    sendRawJson(api, contract.method, contract.path, '{}'),
    sendRawJson(api, contract.method, contract.path, '{', 'application/json'),
    sendRawJson(
      api,
      contract.method,
      contract.path,
      JSON.stringify({ unknownField: 'forbidden-unknown' }),
      'application/json',
    ),
  ];

  for (const request of requests) {
    await expectSafeHttpError(await request, [400], ['forbidden-unknown']);
  }

  const maximumBody = '{}'.padEnd(contract.maximumBodySizeBytes, ' ');
  await expectSafeHttpError(
    await sendRawJson(
      api,
      contract.method,
      contract.path,
      maximumBody,
      'application/json',
    ),
    [400],
  );
  await expectSafeHttpError(
    await sendRawJson(
      api,
      contract.method,
      contract.path,
      `${maximumBody} `,
      'application/json',
      true,
    ),
    [413],
  );
}

async function expectBodySizeLimit(
  contract: RequiredJsonRouteContract,
  api: APIRequestContext,
): Promise<void> {
  const validBody = JSON.stringify(contract.createValidBody(6));
  const maximumBody = padJsonBody(
    validBody,
    contract.maximumBodySizeBytes,
  );
  const acceptedResponse = await sendRawJson(
    api,
    contract.method,
    contract.path,
    maximumBody,
    'application/json',
  );

  expect(
    contract.acceptedStatuses,
    `${contract.name} rejected its exact body-size boundary`,
  ).toContain(acceptedResponse.status());

  await expectSafeHttpError(
    await sendRawJson(
      api,
      contract.method,
      contract.path,
      `${maximumBody} `,
      'application/json',
      true,
    ),
    [413],
  );
}

async function expectChunkedBodyLimit(
  e2eBackend: IsolatedBackendHarness,
): Promise<void> {
  const body = JSON.stringify({
    secret: 'x'.repeat(4 * 1024),
  });
  const response = await sendChunkedRequest({
    body,
    origin: e2eBackend.backend.backendOrigin,
    path: '/company-settings/email-secret',
    sessionSecret: e2eBackend.backend.sessionSecret,
  });

  expect(response.status).toBe(413);
  expect(response.body).not.toContain('x'.repeat(100));
}

function padJsonBody(body: string, sizeBytes: number): string {
  const bodySizeBytes = Buffer.byteLength(body, 'utf8');
  if (bodySizeBytes > sizeBytes) {
    throw new Error('Synthetic JSON body exceeds its configured limit.');
  }

  return `${body}${' '.repeat(sizeBytes - bodySizeBytes)}`;
}

function sendChunkedRequest(input: {
  body: string;
  origin: string;
  path: string;
  sessionSecret: string;
}): Promise<{ body: string; status: number }> {
  return new Promise((resolveResponse, rejectResponse) => {
    const origin = new URL(input.origin);
    const request = sendHttpRequest(
      {
        headers: {
          'Content-Type': 'application/json',
          'Transfer-Encoding': 'chunked',
          'x-eky-local-session': input.sessionSecret,
        },
        hostname: origin.hostname,
        method: 'PUT',
        path: input.path,
        port: origin.port,
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => {
          chunks.push(chunk);
        });
        response.once('end', () => {
          resolveResponse({
            body: Buffer.concat(chunks).toString('utf8'),
            status: response.statusCode ?? 0,
          });
        });
      },
    );

    request.once('error', rejectResponse);
    const splitIndex = Math.floor(input.body.length / 2);
    request.write(input.body.slice(0, splitIndex));
    request.end(input.body.slice(splitIndex));
  });
}

function sendRawJson(
  api: APIRequestContext,
  method: JsonMethod,
  path: string,
  body: string,
  contentType?: string,
  closeConnection = false,
): Promise<APIResponse> {
  const headers: Record<string, string> = {};
  if (contentType !== undefined) {
    headers['Content-Type'] = contentType;
  }
  if (closeConnection) {
    headers.Connection = 'close';
  }

  return api.fetch(path, {
    data: body,
    headers,
    method,
  });
}
