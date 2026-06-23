import {
  EkyApiError,
  type InvoiceDraft,
  type InvoiceDraftInput,
} from '@eky/api-client';
import { describe, expect, it, vi } from 'vitest';

import {
  autosaveInvoiceDraftInput,
  getInvoiceDraftAutosaveErrorMessage,
  invoiceDraftAutosaveDelayMs,
  prepareInvoiceDraftAutosave,
  shouldApplyAutosaveResult,
} from './useInvoiceDraftAutosave.js';
import {
  createInitialInvoiceRows,
  updateInvoiceRow,
} from '../form/invoiceRowFormState.js';
import {
  createInitialNewInvoiceForm,
  updateNewInvoiceFormField,
} from '../form/newInvoiceFormState.js';
import { uiText } from '../../../i18n/fi.js';

describe('prepareInvoiceDraftAutosave', () => {
  it('does not enable autosave in create mode', () => {
    const plan = prepareInvoiceDraftAutosave(
      { type: 'create' },
      createValidForm(),
    );

    expect(plan).toEqual({
      isEnabled: false,
      reason: 'create-mode',
    });
  });

  it('waits for valid form data in edit mode', () => {
    const plan = prepareInvoiceDraftAutosave(
      {
        draft: createInvoiceDraft(createInvoiceDraftInput()),
        type: 'edit',
      },
      createInitialNewInvoiceForm(),
    );

    expect(plan).toEqual({
      isEnabled: true,
      isValid: false,
      reason: 'invalid-form',
    });
  });

  it('prepares an update input for an existing draft', () => {
    const input = createInvoiceDraftInput();
    const plan = prepareInvoiceDraftAutosave(
      {
        draft: createInvoiceDraft(input),
        type: 'edit',
      },
      createValidForm(),
    );

    expect(plan).toEqual({
      draftId: 'draft-1',
      input,
      isEnabled: true,
      isValid: true,
    });
  });
});

describe('autosaveInvoiceDraftInput', () => {
  it('uses updateInvoiceDraft and never creates a new draft', async () => {
    const input = createInvoiceDraftInput();
    const draft = createInvoiceDraft(input);
    const apiClient = {
      updateInvoiceDraft: vi.fn(async () => draft),
    };

    await expect(
      autosaveInvoiceDraftInput('draft-1', input, apiClient),
    ).resolves.toBe(draft);

    expect(apiClient.updateInvoiceDraft).toHaveBeenCalledWith(
      'draft-1',
      input,
    );
  });
});

describe('shouldApplyAutosaveResult', () => {
  it('allows the latest response for the same form revision', () => {
    expect(
      shouldApplyAutosaveResult({
        currentFormRevision: 3,
        latestRequestId: 2,
        requestId: 2,
        startedFormRevision: 3,
      }),
    ).toBe(true);
  });

  it('rejects an older response', () => {
    expect(
      shouldApplyAutosaveResult({
        currentFormRevision: 3,
        latestRequestId: 3,
        requestId: 2,
        startedFormRevision: 3,
      }),
    ).toBe(false);
  });

  it('rejects a response when the form changed during the request', () => {
    expect(
      shouldApplyAutosaveResult({
        currentFormRevision: 4,
        latestRequestId: 2,
        requestId: 2,
        startedFormRevision: 3,
      }),
    ).toBe(false);
  });
});

describe('getInvoiceDraftAutosaveErrorMessage', () => {
  it('returns a safe Finnish error message for unknown API errors', () => {
    const message = getInvoiceDraftAutosaveErrorMessage(
      new EkyApiError('SQLITE_SECRET_DETAIL', {
        responseBody: {
          stack: 'hidden stack',
        },
        status: 500,
      }),
    );

    expect(message).toBe(uiText.invoicing.autosaveError);
    expect(message).not.toContain('SQLITE');
    expect(message).not.toContain('stack');
  });

  it('uses a deliberate debounce delay', () => {
    expect(invoiceDraftAutosaveDelayMs).toBeGreaterThanOrEqual(1500);
    expect(invoiceDraftAutosaveDelayMs).toBeLessThanOrEqual(2000);
  });
});

function createValidForm() {
  const rows = updateInvoiceRow(
    updateInvoiceRow(
      updateInvoiceRow(
        createInitialInvoiceRows(),
        'invoice-row-1',
        'description',
        'Työtunti',
      ),
      'invoice-row-1',
      'quantity',
      '1',
    ),
    'invoice-row-1',
    'unitPrice',
    '65',
  );

  return {
    ...updateNewInvoiceFormField(
      createInitialNewInvoiceForm(new Date(2026, 5, 16)),
      'customerId',
      'customer-1',
    ),
    lines: rows,
  };
}

function createInvoiceDraftInput(): InvoiceDraftInput {
  return {
    customerId: 'customer-1',
    dueDate: '2026-06-30',
    invoiceDate: '2026-06-16',
    lines: [
      {
        description: 'Työtunti',
        discount: { type: 'none' },
        quantityHundredths: 100,
        unit: 'h',
        unitPriceCents: 6500,
        vatRateBasisPoints: 2550,
      },
    ],
    paymentTermDays: 14,
    priceInputMode: 'net',
  };
}

function createInvoiceDraft(input: InvoiceDraftInput): InvoiceDraft {
  return {
    companyId: 'dev-company',
    createdAt: '2026-06-16T12:00:00.000Z',
    customerId: input.customerId,
    dueDate: input.dueDate ?? '2026-06-30',
    id: 'draft-1',
    invoiceDate: input.invoiceDate,
    lines: [],
    note: '',
    orderNumber: '',
    paymentTermDays: input.paymentTermDays ?? 14,
    priceInputMode: input.priceInputMode,
    status: 'draft',
    subject: '',
    totals: {
      grossTotalCents: 8158,
      netTotalCents: 6500,
      vatBreakdown: [
        {
          grossCents: 8158,
          netCents: 6500,
          vatCents: 1658,
          vatRateBasisPoints: 2550,
        },
      ],
      vatTotalCents: 1658,
    },
    updatedAt: '2026-06-16T12:00:00.000Z',
  };
}
