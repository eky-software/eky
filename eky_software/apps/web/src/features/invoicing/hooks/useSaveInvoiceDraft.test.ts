import {
  EkyApiError,
  type InvoiceDraft,
  type InvoiceDraftInput,
} from '@eky/api-client';
import { describe, expect, it, vi } from 'vitest';

import {
  getSaveInvoiceDraftErrorMessage,
  prepareInvoiceDraftSaveInput,
  saveInvoiceDraftInput,
} from './useSaveInvoiceDraft.js';
import {
  createInitialInvoiceRows,
  updateInvoiceRow,
} from '../form/invoiceRowFormState.js';
import {
  createInitialNewInvoiceForm,
  updateNewInvoiceFormField,
} from '../form/newInvoiceFormState.js';
import { uiText } from '../../../i18n/fi.js';

describe('prepareInvoiceDraftSaveInput', () => {
  it('does not prepare an API input when validation fails', () => {
    const result = prepareInvoiceDraftSaveInput(createInitialNewInvoiceForm());

    expect(result.isValid).toBe(false);
    expect(result.input).toBeUndefined();
    expect(result.errors.customerId).toBe(
      uiText.invoicing.validationCustomerRequired,
    );
  });

  it('prepares a valid InvoiceDraftInput without server-owned fields', () => {
    const result = prepareInvoiceDraftSaveInput(createValidForm());

    expect(result.isValid).toBe(true);

    if (!result.isValid) {
      throw new Error('Expected valid save input.');
    }

    expect(result.input).toEqual({
      customerId: 'customer-1',
      invoiceDate: '2026-06-16',
      dueDate: '2026-06-30',
      paymentTermDays: 14,
      priceInputMode: 'net',
      subject: 'Työlasku',
      lines: [
        {
          description: 'Työtunti',
          discount: { type: 'none' },
          quantityHundredths: 150,
          unit: 'h',
          unitPriceCents: 6550,
          vatRateBasisPoints: 2550,
        },
      ],
    });
    expect(result.input).not.toHaveProperty('id');
    expect(result.input).not.toHaveProperty('companyId');
    expect(result.input).not.toHaveProperty('status');
    expect(result.input).not.toHaveProperty('totals');
    expect(result.input).not.toHaveProperty('createdAt');
    expect(result.input).not.toHaveProperty('updatedAt');
  });
});

describe('saveInvoiceDraftInput', () => {
  it('calls createInvoiceDraft with the prepared input', async () => {
    const input = createInvoiceDraftInput();
    const draft = createInvoiceDraft(input);
    const apiClient = {
      createInvoiceDraft: vi.fn(async () => draft),
      updateInvoiceDraft: vi.fn(),
    };

    await expect(
      saveInvoiceDraftInput(input, apiClient, { type: 'create' }),
    ).resolves.toBe(draft);

    expect(apiClient.createInvoiceDraft).toHaveBeenCalledWith(input);
    expect(apiClient.updateInvoiceDraft).not.toHaveBeenCalled();
  });

  it('calls updateInvoiceDraft with the prepared input in edit mode', async () => {
    const input = createInvoiceDraftInput();
    const draft = createInvoiceDraft(input);
    const apiClient = {
      createInvoiceDraft: vi.fn(),
      updateInvoiceDraft: vi.fn(async () => draft),
    };

    await expect(
      saveInvoiceDraftInput(input, apiClient, {
        draftId: 'draft-1',
        type: 'edit',
      }),
    ).resolves.toBe(draft);

    expect(apiClient.updateInvoiceDraft).toHaveBeenCalledWith(
      'draft-1',
      input,
    );
    expect(apiClient.createInvoiceDraft).not.toHaveBeenCalled();
  });
});

describe('getSaveInvoiceDraftErrorMessage', () => {
  it('returns a safe Finnish API error message', () => {
    expect(
      getSaveInvoiceDraftErrorMessage(
        new EkyApiError('Invalid JSON response.', {
          responseBody: {
            stack: 'secret stack',
            trace: 'responseBody should not be rendered',
          },
          status: 500,
        }),
      ),
    ).toBe(uiText.apiErrors['Invalid JSON response.']);
  });

  it('returns a generic safe save error for unknown API messages', () => {
    const message = getSaveInvoiceDraftErrorMessage(
      new EkyApiError('SQLITE_INTERNAL_SECRET', {
        responseBody: {
          stack: 'secret stack',
          responseBody: 'raw body',
        },
        status: 500,
      }),
    );

    expect(message).toBe(uiText.invoicing.saveDraftError);
    expect(message).not.toContain('SQLITE');
    expect(message).not.toContain('stack');
    expect(message).not.toContain('responseBody');
  });

  it('returns a generic safe save error for non-API errors', () => {
    expect(getSaveInvoiceDraftErrorMessage(new Error('stack trace'))).toBe(
      uiText.invoicing.saveDraftError,
    );
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
      '1,50',
    ),
    'invoice-row-1',
    'unitPrice',
    '65,50',
  );

  return {
    ...updateNewInvoiceFormField(
      updateNewInvoiceFormField(
        createInitialNewInvoiceForm(new Date(2026, 5, 16)),
        'customerId',
        'customer-1',
      ),
      'subject',
      'Työlasku',
    ),
    lines: rows,
  };
}

function createInvoiceDraftInput(): InvoiceDraftInput {
  return {
    customerId: 'customer-1',
    invoiceDate: '2026-06-16',
    dueDate: '2026-06-30',
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
    latePaymentInterestBasisPoints: 950,
    priceInputMode: 'net',
  };
}

function createInvoiceDraft(input: InvoiceDraftInput): InvoiceDraft {
  return {
    companyId: 'dev-company',
    createdAt: '2026-06-16T12:00:00.000Z',
    customerId: input.customerId,
    billingRecipientCustomerId: input.billingRecipientCustomerId ?? null,
    deliveryAddressText: input.deliveryAddressText ?? '',
    dueDate: input.dueDate ?? '2026-06-30',
    id: 'draft-1',
    invoiceDate: input.invoiceDate,
    lines: [],
    note: '',
    orderNumber: '',
    paymentTermDays: input.paymentTermDays ?? 14,
    latePaymentInterestBasisPoints:
      input.latePaymentInterestBasisPoints ?? 950,
    priceInputMode: input.priceInputMode,
    reminderPeriodDays: input.reminderPeriodDays ?? 0,
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
