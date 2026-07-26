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
  applyInvoiceTaxTreatment,
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
      billingRecipientCustomerId: 'billing-customer-1',
      reminderPeriodDays: 8,
      deliveryAddressText: 'Työkohde 1',
      priceInputMode: 'net',
      taxTreatment: 'normalVat',
      performancePeriod: { type: 'invoiceDate' },
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

  it('trims custom invoice units before sending them to the API', () => {
    const input = toInvoiceDraftInput(createValidForm({ unit: ' ltk ' }));

    expect(input.lines[0]?.unit).toBe('ltk');
  });

  it('omits empty optional text fields', () => {
    const input = toInvoiceDraftInput(
      createValidForm({
        billingRecipientCustomerId: ' ',
        deliveryAddressText: ' ',
        note: ' ',
        orderNumber: '',
        subject: '',
      }),
    );

    expect(input).not.toHaveProperty('subject');
    expect(input).not.toHaveProperty('orderNumber');
    expect(input).not.toHaveProperty('note');
    expect(input).not.toHaveProperty('billingRecipientCustomerId');
    expect(input).not.toHaveProperty('deliveryAddressText');
  });

  it('omits reminder period when the field is empty', () => {
    const input = toInvoiceDraftInput(
      createValidForm({ reminderPeriodDays: '' }),
    );

    expect(input).not.toHaveProperty('reminderPeriodDays');
  });

  it('maps reverse charge without a VAT rate or server-owned totals', () => {
    const form = applyInvoiceTaxTreatment(
      {
        ...createValidForm(),
        performancePeriodType: 'dateRange',
        performancePeriodStart: '2026-06-01',
        performancePeriodEnd: '2026-06-15',
      },
      'reverseChargeConstruction',
      2550,
    );

    const input = toInvoiceDraftInput(form);

    expect(input).toMatchObject({
      taxTreatment: 'reverseChargeConstruction',
      priceInputMode: 'net',
      performancePeriod: {
        type: 'dateRange',
        startDate: '2026-06-01',
        endDate: '2026-06-15',
      },
    });
    expect(input.lines[0]?.vatRateBasisPoints).toBeNull();
    expect(input).not.toHaveProperty('totals');
    expect(input.lines[0]).not.toHaveProperty('vatCents');
  });
});

function createValidForm(
  overrides: {
    billingRecipientCustomerId?: string;
    deliveryAddressText?: string;
    discountType?: 'none' | 'percentage' | 'fixed';
    discountValue?: string;
    latePaymentInterestPercent?: string;
    note?: string;
    orderNumber?: string;
    reminderPeriodDays?: string;
    subject?: string;
    unit?: string;
  } = {},
) {
  let row = createInitialInvoiceRows();
  row = updateInvoiceRow(row, 'invoice-row-1', 'description', 'Työtunti');
  row = updateInvoiceRow(row, 'invoice-row-1', 'quantity', '1,5');
  row = updateInvoiceRow(
    row,
    'invoice-row-1',
    'unit',
    overrides.unit ?? 'h',
  );
  row = updateInvoiceRow(row, 'invoice-row-1', 'unitPrice', '65,50');
  row = updateInvoiceRow(
    row,
    'invoice-row-1',
    'discountType',
    overrides.discountType ?? 'none',
  );
  row = updateInvoiceRow(
    row,
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
    billingRecipientCustomerId:
      overrides.billingRecipientCustomerId ?? 'billing-customer-1',
    deliveryAddressText: overrides.deliveryAddressText ?? 'Työkohde 1',
    note: overrides.note ?? 'Saate',
    orderNumber: overrides.orderNumber ?? 'TILAUS-1',
    reminderPeriodDays: overrides.reminderPeriodDays ?? '8',
  };
}
