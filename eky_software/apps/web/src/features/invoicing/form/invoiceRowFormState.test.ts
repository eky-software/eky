import { describe, expect, it } from 'vitest';

import {
  addInvoiceRow,
  createInitialInvoiceRows,
  refreshAutoAppliedHourlyRates,
  removeInvoiceRow,
  updateInvoiceRow,
  updateInvoiceRowDescription,
} from './invoiceRowFormState.js';

describe('invoiceRowFormState', () => {
  it('starts with one editable default row', () => {
    expect(createInitialInvoiceRows()).toEqual([
      {
        id: 'invoice-row-1',
        description: '',
        quantity: '0',
        unit: 'h',
        unitPrice: '',
        vatRateBasisPoints: 2550,
        discountType: 'none',
        discountValue: '',
        hourlyRateAutofillState: 'available',
      },
    ]);
  });

  it('applies the hourly rate once when the description matches the shortcut', () => {
    const rows = updateInvoiceRowDescription(
      createInitialInvoiceRows(),
      'invoice-row-1',
      '  TYÖ  ',
      {
        hourlyRateCents: 6550,
        shortcut: 'työ',
      },
    );

    expect(rows[0]).toMatchObject({
      description: '  TYÖ  ',
      hourlyRateAutofillState: 'applied',
      unit: 'h',
      unitPrice: '65,50',
    });
  });

  it('does not overwrite a manually entered unit price', () => {
    const manuallyPricedRows = updateInvoiceRow(
      createInitialInvoiceRows(),
      'invoice-row-1',
      'unitPrice',
      '72,00',
    );
    const rows = updateInvoiceRowDescription(
      manuallyPricedRows,
      'invoice-row-1',
      'työ',
      {
        hourlyRateCents: 6550,
        shortcut: 'työ',
      },
    );

    expect(rows[0]).toMatchObject({
      hourlyRateAutofillState: 'blocked',
      unitPrice: '72,00',
    });
  });

  it('does not apply the hourly rate a second time after manual editing', () => {
    const autoPricedRows = updateInvoiceRowDescription(
      createInitialInvoiceRows(),
      'invoice-row-1',
      'työ',
      {
        hourlyRateCents: 6500,
        shortcut: 'työ',
      },
    );
    const manuallyEditedRows = updateInvoiceRow(
      autoPricedRows,
      'invoice-row-1',
      'unitPrice',
      '80,00',
    );
    const renamedRows = updateInvoiceRowDescription(
      updateInvoiceRowDescription(
        manuallyEditedRows,
        'invoice-row-1',
        'muu työ',
        { hourlyRateCents: 7000, shortcut: 'työ' },
      ),
      'invoice-row-1',
      'työ',
      { hourlyRateCents: 7000, shortcut: 'työ' },
    );

    expect(renamedRows[0]).toMatchObject({
      hourlyRateAutofillState: 'blocked',
      unitPrice: '80,00',
    });
  });

  it('applies the shortcut only once even when the description matches again', () => {
    const autoPricedRows = updateInvoiceRowDescription(
      createInitialInvoiceRows(),
      'invoice-row-1',
      'työ',
      { hourlyRateCents: 6500, shortcut: 'työ' },
    );
    const renamedRows = updateInvoiceRowDescription(
      updateInvoiceRowDescription(
        autoPricedRows,
        'invoice-row-1',
        'muu',
        { hourlyRateCents: 7000, shortcut: 'työ' },
      ),
      'invoice-row-1',
      'työ',
      { hourlyRateCents: 7000, shortcut: 'työ' },
    );

    expect(renamedRows[0]).toMatchObject({
      hourlyRateAutofillState: 'applied',
      unitPrice: '65,00',
    });
  });

  it('keeps the row unchanged when the shortcut or hourly rate is unavailable', () => {
    const withoutShortcut = updateInvoiceRowDescription(
      createInitialInvoiceRows(),
      'invoice-row-1',
      'työ',
      { hourlyRateCents: 6500, shortcut: '' },
    );
    const withoutRate = updateInvoiceRowDescription(
      createInitialInvoiceRows(),
      'invoice-row-1',
      'työ',
      { hourlyRateCents: null, shortcut: 'työ' },
    );

    expect(withoutShortcut[0]?.unitPrice).toBe('');
    expect(withoutRate[0]?.unitPrice).toBe('');
  });

  it('refreshes an auto-applied hourly rate when the customer changes', () => {
    const autoPricedRows = updateInvoiceRowDescription(
      createInitialInvoiceRows(),
      'invoice-row-1',
      'työ',
      { hourlyRateCents: 6500, shortcut: 'työ' },
    );

    const rows = refreshAutoAppliedHourlyRates(autoPricedRows, {
      hourlyRateCents: 8500,
      shortcut: 'työ',
    });

    expect(rows[0]).toMatchObject({
      hourlyRateAutofillState: 'applied',
      unit: 'h',
      unitPrice: '85,00',
    });
  });

  it('does not refresh a manually edited hourly rate', () => {
    const autoPricedRows = updateInvoiceRowDescription(
      createInitialInvoiceRows(),
      'invoice-row-1',
      'työ',
      { hourlyRateCents: 6500, shortcut: 'työ' },
    );
    const manuallyPricedRows = updateInvoiceRow(
      autoPricedRows,
      'invoice-row-1',
      'unitPrice',
      '72,00',
    );

    const rows = refreshAutoAppliedHourlyRates(manuallyPricedRows, {
      hourlyRateCents: 8500,
      shortcut: 'työ',
    });

    expect(rows[0]).toMatchObject({
      hourlyRateAutofillState: 'blocked',
      unitPrice: '72,00',
    });
  });

  it('clears a stale auto-applied rate when no new rate is available', () => {
    const autoPricedRows = updateInvoiceRowDescription(
      createInitialInvoiceRows(),
      'invoice-row-1',
      'työ',
      { hourlyRateCents: 6500, shortcut: 'työ' },
    );

    const rows = refreshAutoAppliedHourlyRates(autoPricedRows, {
      hourlyRateCents: null,
      shortcut: 'työ',
    });

    expect(rows[0]).toMatchObject({
      hourlyRateAutofillState: 'applied',
      unitPrice: '',
    });
  });

  it('does not refresh an auto-applied row after its description changes', () => {
    const autoPricedRows = updateInvoiceRowDescription(
      createInitialInvoiceRows(),
      'invoice-row-1',
      'työ',
      { hourlyRateCents: 6500, shortcut: 'työ' },
    );
    const renamedRows = updateInvoiceRow(
      autoPricedRows,
      'invoice-row-1',
      'description',
      'muu työ',
    );

    const rows = refreshAutoAppliedHourlyRates(renamedRows, {
      hourlyRateCents: 8500,
      shortcut: 'työ',
    });

    expect(rows[0]?.unitPrice).toBe('65,00');
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
    expect(updatedRows[1]?.quantity).toBe('0');
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
