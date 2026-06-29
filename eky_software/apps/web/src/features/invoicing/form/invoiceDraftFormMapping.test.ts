import { describe, expect, it } from 'vitest';

import {
  parseEuroCents,
  parsePercentageBasisPoints,
  parseQuantityHundredths,
  toInvoiceDraftInput,
} from './invoiceDraftFormMapping.js';
import {
  createInitialInvoiceRows,
  updateInvoiceRow,
} from './invoiceRowFormState.js';
import {
  createInitialNewInvoiceForm,
  updateNewInvoiceFormField,
} from './newInvoiceFormState.js';

describe('invoice draft form mapping', () => {
  it.each([
    ['1', 100],
    ['1,5', 150],
    ['1,50', 150],
    [' 1.25 ', 125],
  ])('converts quantity %s into hundredths', (value, expectedValue) => {
    expect(parseQuantityHundredths(value)).toBe(expectedValue);
  });

  it.each([
    ['65', 6500],
    ['65,5', 6550],
    ['65,50', 6550],
    ['65.50', 6550],
  ])('converts euro input %s into cents', (value, expectedValue) => {
    expect(parseEuroCents(value)).toBe(expectedValue);
  });

  it.each([
    ['10', 1000],
    ['10,5', 1050],
    ['10,50', 1050],
  ])(
    'converts percentage input %s into basis points',
    (value, expectedValue) => {
      expect(parsePercentageBasisPoints(value)).toBe(expectedValue);
    },
  );

  it('maps a valid form into an InvoiceDraftInput without server-owned fields', () => {
    const input = toInvoiceDraftInput(
      createValidForm({
        discountType: 'percentage',
        discountValue: '10,5',
      }),
    );

    expect(input).toEqual({
      customerId: 'customer-1',
      invoiceDate: '2026-06-16',
      dueDate: '2026-06-30',
      paymentTermDays: 14,
      latePaymentInterestBasisPoints: 950,
      priceInputMode: 'net',
      subject: 'Työlasku',
      orderNumber: 'TILAUS-1',
      note: 'Saate',
      lines: [
        {
          description: 'Työtunti',
          quantityHundredths: 150,
          unit: 'h',
          unitPriceCents: 6550,
          vatRateBasisPoints: 2550,
          discount: {
            type: 'percentage',
            basisPoints: 1050,
          },
        },
      ],
    });
    expect(input).not.toHaveProperty('id');
    expect(input).not.toHaveProperty('companyId');
    expect(input).not.toHaveProperty('status');
    expect(input).not.toHaveProperty('totals');
    expect(input).not.toHaveProperty('createdAt');
    expect(input).not.toHaveProperty('updatedAt');
    expect(input.lines[0]).not.toHaveProperty('grossCents');
  });

  it('maps fixed discounts from euros into cents', () => {
    const input = toInvoiceDraftInput(
      createValidForm({
        discountType: 'fixed',
        discountValue: '12,50',
      }),
    );

    expect(input.lines[0]?.discount).toEqual({
      type: 'fixed',
      amountCents: 1250,
    });
  });

  it('omits late payment interest when the field is empty', () => {
    const input = toInvoiceDraftInput(
      createValidForm({ latePaymentInterestPercent: '' }),
    );

    expect(input).not.toHaveProperty('latePaymentInterestBasisPoints');
  });

  it('maps missing discount as explicit none discount', () => {
    const input = toInvoiceDraftInput(
      createValidForm({
        discountType: 'none',
        discountValue: '999,00',
      }),
    );

    expect(input.lines[0]?.discount).toEqual({ type: 'none' });
  });

  it('omits empty optional text fields', () => {
    const input = toInvoiceDraftInput(
      createValidForm({
        note: ' ',
        orderNumber: '',
        subject: '',
      }),
    );

    expect(input).not.toHaveProperty('subject');
    expect(input).not.toHaveProperty('orderNumber');
    expect(input).not.toHaveProperty('note');
  });
});

function createValidForm(
  overrides: {
    discountType?: 'none' | 'percentage' | 'fixed';
    discountValue?: string;
    latePaymentInterestPercent?: string;
    note?: string;
    orderNumber?: string;
    subject?: string;
  } = {},
) {
  const row = updateInvoiceRow(
    updateInvoiceRow(
      updateInvoiceRow(
        updateInvoiceRow(
          updateInvoiceRow(
            createInitialInvoiceRows(),
            'invoice-row-1',
            'description',
            'Työtunti',
          ),
          'invoice-row-1',
          'quantity',
          '1,5',
        ),
        'invoice-row-1',
        'unitPrice',
        '65,50',
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
      updateNewInvoiceFormField(
        createInitialNewInvoiceForm(new Date(2026, 5, 16)),
        'customerId',
        'customer-1',
      ),
      'subject',
      overrides.subject ?? 'Työlasku',
    ),
    lines: row,
    latePaymentInterestPercent:
      overrides.latePaymentInterestPercent ?? '9,50',
    note: overrides.note ?? 'Saate',
    orderNumber: overrides.orderNumber ?? 'TILAUS-1',
  };
}
