import { describe, expect, it } from 'vitest';

import { calculateInvoiceDraftPreviewTotals } from './invoiceDraftPreviewTotals.js';
import {
  createInitialInvoiceRows,
  updateInvoiceRow,
  type InvoiceRowForm,
} from '../form/invoiceRowFormState.js';
import {
  createInitialNewInvoiceForm,
  type NewInvoiceFormState,
} from '../form/newInvoiceFormState.js';

describe('calculateInvoiceDraftPreviewTotals', () => {
  it('calculates net, VAT, and gross totals for 12 pieces at 10 euros', () => {
    const totals = calculateInvoiceDraftPreviewTotals(
      createForm({
        quantity: '12',
        unit: 'kpl',
        unitPrice: '10,00',
        vatRateBasisPoints: 2550,
      }),
    );

    expect(totals).toEqual({
      grossTotalCents: 15060,
      isAvailable: true,
      netTotalCents: 12000,
      vatBreakdown: [
        {
          grossCents: 15060,
          netCents: 12000,
          vatCents: 3060,
          vatRateBasisPoints: 2550,
        },
      ],
      vatTotalCents: 3060,
    });
  });

  it('calculates gross input by separating VAT from the entered gross total', () => {
    const totals = calculateInvoiceDraftPreviewTotals(
      createForm({
        priceInputMode: 'gross',
        quantity: '1',
        unitPrice: '125,50',
        vatRateBasisPoints: 2550,
      }),
    );

    expect(totals).toMatchObject({
      grossTotalCents: 12550,
      isAvailable: true,
      netTotalCents: 10000,
      vatTotalCents: 2550,
    });
  });

  it('applies percentage and fixed discounts to the preview', () => {
    const rows = [
      createRow({
        discountType: 'percentage',
        discountValue: '10',
        quantity: '2',
        unitPrice: '50,00',
        vatRateBasisPoints: 2550,
      }),
      createRow({
        id: 'invoice-row-2',
        discountType: 'fixed',
        discountValue: '5,00',
        quantity: '1',
        unitPrice: '20,00',
        vatRateBasisPoints: 1000,
      }),
    ];

    const totals = calculateInvoiceDraftPreviewTotals(createForm({ rows }));

    expect(totals).toMatchObject({
      grossTotalCents: 12945,
      isAvailable: true,
      netTotalCents: 10500,
      vatTotalCents: 2445,
    });
  });

  it('groups VAT breakdown by VAT rate', () => {
    const totals = calculateInvoiceDraftPreviewTotals(
      createForm({
        rows: [
          createRow({
            quantity: '1',
            unitPrice: '10,00',
            vatRateBasisPoints: 2550,
          }),
          createRow({
            id: 'invoice-row-2',
            quantity: '1',
            unitPrice: '10,00',
            vatRateBasisPoints: 1000,
          }),
        ],
      }),
    );

    expect(totals).toMatchObject({
      isAvailable: true,
      vatBreakdown: [
        {
          grossCents: 1100,
          netCents: 1000,
          vatCents: 100,
          vatRateBasisPoints: 1000,
        },
        {
          grossCents: 1255,
          netCents: 1000,
          vatCents: 255,
          vatRateBasisPoints: 2550,
        },
      ],
    });
  });

  it('calculates VAT from VAT-rate totals instead of summing rounded row VAT', () => {
    const totals = calculateInvoiceDraftPreviewTotals(
      createForm({
        rows: [
          createRow({ unitPrice: '55,00' }),
          ...Array.from({ length: 25 }, (_value, index) =>
            createRow({
              id: `small-row-${index}`,
              unitPrice: '1,00',
            }),
          ),
          ...Array.from({ length: 4 }, (_value, index) =>
            createRow({
              id: `larger-row-${index}`,
              unitPrice: '11,00',
            }),
          ),
        ],
      }),
    );

    expect(totals).toEqual({
      grossTotalCents: 15_562,
      isAvailable: true,
      netTotalCents: 12_400,
      vatBreakdown: [
        {
          grossCents: 15_562,
          netCents: 12_400,
          vatCents: 3162,
          vatRateBasisPoints: 2550,
        },
      ],
      vatTotalCents: 3162,
    });
  });

  it('returns unavailable totals for an invalid row instead of throwing', () => {
    expect(
      calculateInvoiceDraftPreviewTotals(
        createForm({
          quantity: 'abc',
          unitPrice: '10,00',
        }),
      ),
    ).toEqual({ isAvailable: false });
  });

  it('returns unavailable totals when discount exceeds the row value', () => {
    expect(
      calculateInvoiceDraftPreviewTotals(
        createForm({
          discountType: 'fixed',
          discountValue: '11,00',
          quantity: '1',
          unitPrice: '10,00',
        }),
      ),
    ).toEqual({ isAvailable: false });
  });

  it('previews reverse charge as net totals without seller VAT', () => {
    const totals = calculateInvoiceDraftPreviewTotals(
      createForm({
        taxTreatment: 'reverseChargeConstruction',
        vatRateBasisPoints: null,
        quantity: '2',
        unitPrice: '50,00',
      }),
    );

    expect(totals).toEqual({
      grossTotalCents: 10000,
      isAvailable: true,
      netTotalCents: 10000,
      vatBreakdown: [],
      vatTotalCents: 0,
    });
  });
});

function createForm(
  overrides: Partial<InvoiceRowForm> & {
    priceInputMode?: NewInvoiceFormState['priceInputMode'];
    rows?: InvoiceRowForm[];
    taxTreatment?: NewInvoiceFormState['taxTreatment'];
  } = {},
): NewInvoiceFormState {
  return {
    ...createInitialNewInvoiceForm(new Date(2026, 5, 16)),
    lines: overrides.rows ?? [createRow(overrides)],
    priceInputMode: overrides.priceInputMode ?? 'net',
    taxTreatment: overrides.taxTreatment ?? 'normalVat',
  };
}

function createRow(overrides: Partial<InvoiceRowForm> = {}): InvoiceRowForm {
  const rowId = overrides.id ?? 'invoice-row-1';
  let rows = createInitialInvoiceRows().map((row) => ({
    ...row,
    id: rowId,
  }));

  rows = updateInvoiceRow(
    rows,
    rowId,
    'description',
    overrides.description ?? 'Työtunti',
  );
  rows = updateInvoiceRow(
    rows,
    rowId,
    'quantity',
    overrides.quantity ?? '1',
  );
  rows = updateInvoiceRow(
    rows,
    rowId,
    'unit',
    overrides.unit ?? 'h',
  );
  rows = updateInvoiceRow(
    rows,
    rowId,
    'unitPrice',
    overrides.unitPrice ?? '10,00',
  );
  rows = updateInvoiceRow(
    rows,
    rowId,
    'vatRateBasisPoints',
    overrides.vatRateBasisPoints === undefined
      ? 2550
      : overrides.vatRateBasisPoints,
  );
  rows = updateInvoiceRow(
    rows,
    rowId,
    'discountType',
    overrides.discountType ?? 'none',
  );
  rows = updateInvoiceRow(
    rows,
    rowId,
    'discountValue',
    overrides.discountValue ?? '',
  );

  return rows[0] as InvoiceRowForm;
}
