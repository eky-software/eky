import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { InvoiceRowsEditor } from './InvoiceRowsEditor.js';
import {
  addInvoiceRow,
  createInitialInvoiceRows,
  updateInvoiceRow,
} from '../form/invoiceRowFormState.js';
import { uiText } from '../../../i18n/fi.js';

describe('InvoiceRowsEditor', () => {
  it('renders one default row and all supported selections', () => {
    const html = renderEditor(createInitialInvoiceRows());

    expect(html).toContain(uiText.invoicing.addRow);
    expect(html).toContain('“työ”');
    expect(html).toContain(uiText.invoicing.hourlyRateShortcutHelpSuffix);
    expect(html).toContain(uiText.invoicing.toggleRowDiscount);
    expect(html).not.toContain(uiText.invoicing.discountPercentage);
    expect(html).not.toContain(uiText.invoicing.discountFixed);
    expect(html).toContain('25,5 %');
    expect(html).toContain('13,5 %');
    expect(html).toContain('10 %');
    expect(html).toContain('0 %');
    expect(html).toContain(`value="${uiText.invoicing.unitHour}"`);
    expect(html).toContain(`value="${uiText.invoicing.unitPiece}"`);
    expect(html).toContain(`value="${uiText.invoicing.unitDay}"`);
    expect(html).toContain(`value="${uiText.invoicing.unitKilometre}"`);
    expect(html).toContain(`value="${uiText.invoicing.unitBatch}"`);
    expect(html).toContain(`value="${uiText.invoicing.unitPackage}"`);
    expect(html).toContain(uiText.invoicing.unitCustom);
    expect(html).not.toContain('invoice-row-1-customUnit');
  });

  it('renders a custom unit input when a row uses a custom unit', () => {
    const rows = updateInvoiceRow(
      createInitialInvoiceRows(),
      'invoice-row-1',
      'unit',
      'ltk',
    );
    const html = renderEditor(rows);

    expect(html).toContain(uiText.invoicing.unitCustom);
    expect(html).toContain('invoice-row-1-customUnit');
    expect(html).toContain(uiText.invoicing.rowCustomUnitPlaceholder);
    expect(html).toContain('value="ltk"');
  });

  it('prevents removing the only row', () => {
    const html = renderEditor(createInitialInvoiceRows());

    expect(html).toContain(
      `disabled="" title="${uiText.invoicing.keepOneRow}"`,
    );
  });

  it('renders each row and enables removal when several rows exist', () => {
    const html = renderEditor(addInvoiceRow(createInitialInvoiceRows()));

    expect(html).toContain('invoice-row-1-description');
    expect(html).toContain('invoice-row-2-description');
    expect(html).not.toContain(
      `disabled="" title="${uiText.invoicing.keepOneRow}"`,
    );
  });

  it('opens the discount panel when a row has a discount', () => {
    const rows = updateInvoiceRow(
      createInitialInvoiceRows(),
      'invoice-row-1',
      'discountType',
      'percentage',
    );
    const html = renderEditor(rows);

    expect(html).toContain(uiText.invoicing.discountNone);
    expect(html).toContain(uiText.invoicing.discountPercentage);
    expect(html).toContain(uiText.invoicing.discountFixed);
    expect(html).toContain('aria-expanded="true"');
  });

  it('renders safe row validation errors', () => {
    const html = renderToStaticMarkup(
      <InvoiceRowsEditor
        vatRates={null}
        errorsByRowId={{
          'invoice-row-1': {
            description: uiText.invoicing.validationDescriptionRequired,
            discountValue: uiText.invoicing.validationFixedDiscountInvalid,
            quantity: uiText.invoicing.validationQuantityInvalid,
            unit: uiText.invoicing.validationUnitInvalid,
            unitPrice: uiText.invoicing.validationUnitPriceInvalid,
          },
        }}
        hourlyRateShortcut="työ"
        hourlyRateShortcutErrorMessage={null}
        rows={createInitialInvoiceRows()}
        onAdd={vi.fn()}
        onChange={vi.fn()}
        onRemove={vi.fn()}
      />,
    );

    expect(html).toContain(uiText.invoicing.validationDescriptionRequired);
    expect(html).toContain(uiText.invoicing.validationFixedDiscountInvalid);
    expect(html).toContain(uiText.invoicing.validationQuantityInvalid);
    expect(html).toContain(uiText.invoicing.validationUnitInvalid);
    expect(html).toContain(uiText.invoicing.validationUnitPriceInvalid);
    expect(html).not.toContain('stack');
    expect(html).not.toContain('responseBody');
  });

  it('renders a safe company settings load error without technical details', () => {
    const html = renderToStaticMarkup(
      <InvoiceRowsEditor
        vatRates={null}
        errorsByRowId={undefined}
        hourlyRateShortcut=""
        hourlyRateShortcutErrorMessage={
          uiText.invoicing.companySettingsLoadError
        }
        rows={createInitialInvoiceRows()}
        onAdd={vi.fn()}
        onChange={vi.fn()}
        onRemove={vi.fn()}
      />,
    );

    expect(html).toContain(uiText.invoicing.companySettingsLoadError);
    expect(html).not.toContain('responseBody');
    expect(html).not.toContain('stack');
  });
});

function renderEditor(
  rows: React.ComponentProps<typeof InvoiceRowsEditor>['rows'],
): string {
  return renderToStaticMarkup(
    <InvoiceRowsEditor
      vatRates={null}
      errorsByRowId={undefined}
      hourlyRateShortcut="työ"
      hourlyRateShortcutErrorMessage={null}
      rows={rows}
      onAdd={vi.fn()}
      onChange={vi.fn()}
      onRemove={vi.fn()}
    />,
  );
}
