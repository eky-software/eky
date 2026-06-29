import { describe, expect, it } from 'vitest';

import { validateInvoiceDraftForm } from './invoiceDraftFormValidation.js';
import {
  createInitialInvoiceRows,
  updateInvoiceRow,
} from './invoiceRowFormState.js';
import {
  createInitialNewInvoiceForm,
  updateNewInvoiceFormField,
} from './newInvoiceFormState.js';
import { uiText } from '../../../i18n/fi.js';

describe('validateInvoiceDraftForm', () => {
  it('accepts a valid invoice draft form', () => {
    expect(validateInvoiceDraftForm(createValidForm()).isValid).toBe(true);
  });

  it('requires a selected customer', () => {
    const result = validateInvoiceDraftForm(
      updateNewInvoiceFormField(createValidForm(), 'customerId', ''),
    );

    expect(result.isValid).toBe(false);
    expect(result.errors.customerId).toBe(
      uiText.invoicing.validationCustomerRequired,
    );
  });

  it('requires valid invoice and due dates', () => {
    const form = {
      ...createValidForm(),
      dueDate: '2026-02-30',
      invoiceDate: '',
    };
    const result = validateInvoiceDraftForm(form);

    expect(result.isValid).toBe(false);
    expect(result.errors.invoiceDate).toBe(
      uiText.invoicing.validationInvoiceDateRequired,
    );
    expect(result.errors.dueDate).toBe(
      uiText.invoicing.validationDateInvalid,
    );
  });

  it('rejects a due date before the invoice date', () => {
    const result = validateInvoiceDraftForm({
      ...createValidForm(),
      dueDate: '2026-06-15',
      invoiceDate: '2026-06-16',
    });

    expect(result.errors.dueDate).toBe(
      uiText.invoicing.validationDueDateBeforeInvoiceDate,
    );
  });

  it.each(['-1', '1,5', 'abc'])(
    'rejects invalid payment term value %s',
    (paymentTermDays) => {
      const result = validateInvoiceDraftForm({
        ...createValidForm(),
        paymentTermDays,
      });

      expect(result.errors.paymentTermDays).toBe(
        uiText.invoicing.validationPaymentTerm,
      );
    },
  );

  it.each(['abc', '-1', '1000,01'])(
    'rejects invalid late payment interest value %s',
    (latePaymentInterestPercent) => {
      const result = validateInvoiceDraftForm({
        ...createValidForm(),
        latePaymentInterestPercent,
      });

      expect(result.errors.latePaymentInterestPercent).toBe(
        uiText.invoicing.validationLatePaymentInterest,
      );
    },
  );

  it('allows empty late payment interest so backend can use the default', () => {
    const result = validateInvoiceDraftForm({
      ...createValidForm(),
      latePaymentInterestPercent: '',
    });

    expect(result.errors.latePaymentInterestPercent).toBeUndefined();
    expect(result.isValid).toBe(true);
  });

  it('requires a row description', () => {
    const result = validateInvoiceDraftForm(
      createValidForm({
        description: ' ',
      }),
    );

    expect(result.errors.lines['invoice-row-1']?.description).toBe(
      uiText.invoicing.validationDescriptionRequired,
    );
  });

  it.each(['abc', '-1', '1,234'])(
    'rejects invalid quantity value %s',
    (quantity) => {
      const result = validateInvoiceDraftForm(createValidForm({ quantity }));

      expect(result.errors.lines['invoice-row-1']?.quantity).toBe(
        uiText.invoicing.validationQuantityInvalid,
      );
    },
  );

  it('requires quantity to be greater than zero', () => {
    const result = validateInvoiceDraftForm(
      createValidForm({ quantity: '0' }),
    );

    expect(result.errors.lines['invoice-row-1']?.quantity).toBe(
      uiText.invoicing.validationQuantityPositive,
    );
  });

  it.each(['abc', '-1', '1,234'])(
    'rejects invalid unit price value %s',
    (unitPrice) => {
      const result = validateInvoiceDraftForm(createValidForm({ unitPrice }));

      expect(result.errors.lines['invoice-row-1']?.unitPrice).toBe(
        uiText.invoicing.validationUnitPriceInvalid,
      );
    },
  );

  it('allows zero unit price for explanation rows', () => {
    expect(
      validateInvoiceDraftForm(createValidForm({ unitPrice: '0' })).isValid,
    ).toBe(true);
  });

  it.each(['abc', '-1', '100,01'])(
    'rejects invalid percentage discount %s',
    (discountValue) => {
      const result = validateInvoiceDraftForm(
        createValidForm({
          discountType: 'percentage',
          discountValue,
        }),
      );

      expect(result.errors.lines['invoice-row-1']?.discountValue).toBe(
        uiText.invoicing.validationPercentageDiscountInvalid,
      );
    },
  );

  it.each(['abc', '-1', '1,234'])(
    'rejects invalid fixed discount %s',
    (discountValue) => {
      const result = validateInvoiceDraftForm(
        createValidForm({
          discountType: 'fixed',
          discountValue,
        }),
      );

      expect(result.errors.lines['invoice-row-1']?.discountValue).toBe(
        uiText.invoicing.validationFixedDiscountInvalid,
      );
    },
  );
});

function createValidForm(
  overrides: {
    description?: string;
    discountType?: 'none' | 'percentage' | 'fixed';
    discountValue?: string;
    quantity?: string;
    unitPrice?: string;
  } = {},
) {
  const rows = updateInvoiceRow(
    updateInvoiceRow(
      updateInvoiceRow(
        updateInvoiceRow(
          updateInvoiceRow(
            createInitialInvoiceRows(),
            'invoice-row-1',
            'description',
            overrides.description ?? 'Työtunti',
          ),
          'invoice-row-1',
          'quantity',
          overrides.quantity ?? '1,50',
        ),
        'invoice-row-1',
        'unitPrice',
        overrides.unitPrice ?? '65,50',
      ),
      'invoice-row-1',
      'discountType',
      overrides.discountType ?? 'none',
    ),
    'invoice-row-1',
    'discountValue',
    overrides.discountValue ?? '',
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
