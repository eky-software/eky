import { describe, expect, it } from 'vitest';

import {
  addInvoiceRow,
  createInitialInvoiceRows,
  removeInvoiceRow,
  updateInvoiceRow,
} from './invoiceRowFormState.js';

describe('invoiceRowFormState', () => {
  it('starts with one editable default row', () => {
    expect(createInitialInvoiceRows()).toEqual([
      {
        id: 'invoice-row-1',
        description: '',
        quantity: '1,00',
        unit: 'h',
        unitPrice: '',
        vatRateBasisPoints: 2550,
        discountType: 'none',
        discountValue: '',
      },
    ]);
  });

  it('adds a new row without changing the existing row', () => {
    const rows = createInitialInvoiceRows();
    const updatedRows = addInvoiceRow(rows);

    expect(updatedRows).toHaveLength(2);
    expect(updatedRows[0]).toBe(rows[0]);
    expect(updatedRows[1]?.id).toBe('invoice-row-2');
  });

  it('removes a selected row when another row remains', () => {
    const rows = addInvoiceRow(createInitialInvoiceRows());

    expect(removeInvoiceRow(rows, 'invoice-row-1')).toEqual([rows[1]]);
  });

  it('keeps the last row in the form', () => {
    const rows = createInitialInvoiceRows();

    expect(removeInvoiceRow(rows, 'invoice-row-1')).toBe(rows);
  });

  it('updates one row field without changing the other rows', () => {
    const rows = addInvoiceRow(createInitialInvoiceRows());
    const updatedRows = updateInvoiceRow(
      rows,
      'invoice-row-2',
      'description',
      'Työtunti',
    );

    expect(updatedRows[0]).toBe(rows[0]);
    expect(updatedRows[1]?.description).toBe('Työtunti');
    expect(updatedRows[1]?.quantity).toBe('1,00');
  });

  it('stores unit, VAT and discount selections as local form values', () => {
    const rows = createInitialInvoiceRows();
    const withUnit = updateInvoiceRow(rows, 'invoice-row-1', 'unit', 'km');
    const withVat = updateInvoiceRow(
      withUnit,
      'invoice-row-1',
      'vatRateBasisPoints',
      1350,
    );
    const withDiscount = updateInvoiceRow(
      withVat,
      'invoice-row-1',
      'discountType',
      'percentage',
    );

    expect(withDiscount[0]).toMatchObject({
      unit: 'km',
      vatRateBasisPoints: 1350,
      discountType: 'percentage',
    });
  });
});
