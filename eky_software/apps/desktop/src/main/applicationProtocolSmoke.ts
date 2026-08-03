import { localRuntimeSessionHeaderName } from './protocolPolicy.js';

interface CreateDeleteDraftSmokeFixtureInput {
  backendPort: number;
  runtimeSessionSecret: string;
}

export async function createDeleteDraftSmokeFixture(
  input: CreateDeleteDraftSmokeFixtureInput,
): Promise<string> {
  const request = createSmokeRequest(
    input.backendPort,
    input.runtimeSessionSecret,
  );
  const customerResponse = await request('/customers', {
    businessId: '',
    city: 'Helsinki',
    comment: 'Synthetic desktop delete transport smoke fixture',
    customerNumber: 'SMOKE-DELETE-1',
    customerNumberMode: 'manual',
    customerType: 'company',
    email: 'delete-smoke@example.invalid',
    hourlyRateOverrideCents: null,
    managedByCustomerId: '',
    name: 'Eky Delete Smoke Customer Oy',
    phone: '',
    postalCode: '00100',
    status: 'active',
    streetAddress: 'Testikatu 3',
  });
  const customerId = readNestedIdentifier(customerResponse, 'customer', 'id');
  const invoiceDate = new Date().toISOString().slice(0, 10);
  const draftResponse = await request('/invoice-drafts', {
    customerId,
    deliveryAddressText: '',
    invoiceDate,
    lines: [
      {
        code: 'DELETE',
        description: 'Synteettinen poistotestin laskurivi',
        discount: { type: 'none' },
        quantityHundredths: 100,
        unit: 'h',
        unitPriceCents: 100,
        vatRateBasisPoints: 2550,
      },
    ],
    note: '',
    paymentTermDays: 14,
    priceInputMode: 'net',
    reminderPeriodDays: 8,
    subject: 'Desktop delete transport smoke',
  });

  return readNestedIdentifier(draftResponse, 'invoiceDraft', 'id');
}

export async function markInvoiceDeliveredForArchiveSmoke(input: {
  backendPort: number;
  invoiceId: string;
  runtimeSessionSecret: string;
}): Promise<void> {
  const response = await fetch(
    `http://127.0.0.1:${input.backendPort}/invoices/${encodeURIComponent(input.invoiceId)}/mark-sent`,
    {
      body: JSON.stringify({ deliveryMethod: 'manual' }),
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        [localRuntimeSessionHeaderName]: input.runtimeSessionSecret,
      },
      method: 'POST',
      signal: AbortSignal.timeout(10_000),
    },
  );

  if (!response.ok) {
    throw new Error('DESKTOP_SMOKE_INVOICE_ARCHIVE_DELIVERY_FAILED');
  }
}

function createSmokeRequest(
  backendPort: number,
  runtimeSessionSecret: string,
): (pathname: string, body: Record<string, unknown>) => Promise<unknown> {
  return async (pathname, body) => {
    const response = await fetch(`http://127.0.0.1:${backendPort}${pathname}`, {
      body: JSON.stringify(body),
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        [localRuntimeSessionHeaderName]: runtimeSessionSecret,
      },
      method: 'POST',
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      throw new Error('DESKTOP_SMOKE_DELETE_FIXTURE_FAILED');
    }

    try {
      return await response.json();
    } catch {
      throw new Error('DESKTOP_SMOKE_DELETE_FIXTURE_FAILED');
    }
  };
}

function readNestedIdentifier(
  value: unknown,
  parentField: string,
  identifierField: string,
): string {
  if (
    typeof value !== 'object' ||
    value === null ||
    !(parentField in value)
  ) {
    throw new Error('DESKTOP_SMOKE_DELETE_FIXTURE_FAILED');
  }

  const parent = (value as Record<string, unknown>)[parentField];

  if (
    typeof parent !== 'object' ||
    parent === null ||
    !(identifierField in parent)
  ) {
    throw new Error('DESKTOP_SMOKE_DELETE_FIXTURE_FAILED');
  }

  const identifier = (parent as Record<string, unknown>)[identifierField];

  if (typeof identifier !== 'string' || identifier.length === 0) {
    throw new Error('DESKTOP_SMOKE_DELETE_FIXTURE_FAILED');
  }

  return identifier;
}
