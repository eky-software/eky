import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { InvoiceRowsEditor } from './InvoiceRowsEditor.js';
import {
  addInvoiceRow,
  createInitialInvoiceRows,
} from '../form/invoiceRowFormState.js';
import { uiText } from '../../../i18n/fi.js';

describe('InvoiceRowsEditor', () => {
  it('renders one default row and all supported selections', () => {
    const html = renderEditor(createInitialInvoiceRows());

    expect(html).toContain(uiText.invoicing.addRow);
    expect(html).toContain(uiText.invoicing.discountNone);
    expect(html).toContain(uiText.invoicing.discountPercentage);
    expect(html).toContain(uiText.invoicing.discountFixed);
    expect(html).toContain('25,5 %');
    expect(html).toContain('13,5 %');
    expect(html).toContain('10 %');
    expect(html).toContain('0 %');
    expect(html).toContain(`value="${uiText.invoicing.unitHour}"`);
    expect(html).toContain(`value="${uiText.invoicing.unitPiece}"`);
    expect(html).toContain(`value="${uiText.invoicing.unitDay}"`);
    expect(html).toContain(`value="${uiText.invoicing.unitKilometre}"`);
    expect(html).toContain(`value="${uiText.invoicing.unitBatch}"`);
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

  it('renders safe row validation errors', () => {
    const html = renderToStaticMarkup(
      <InvoiceRowsEditor
        errorsByRowId={{
          'invoice-row-1': {
            description: uiText.invoicing.validationDescriptionRequired,
            quantity: uiText.invoicing.validationQuantityInvalid,
            unitPrice: uiText.invoicing.validationUnitPriceInvalid,
          },
        }}
        rows={createInitialInvoiceRows()}
        onAdd={vi.fn()}
        onChange={vi.fn()}
        onRemove={vi.fn()}
      />,
    );

    expect(html).toContain(uiText.invoicing.validationDescriptionRequired);
    expect(html).toContain(uiText.invoicing.validationQuantityInvalid);
    expect(html).toContain(uiText.invoicing.validationUnitPriceInvalid);
    expect(html).not.toContain('stack');
    expect(html).not.toContain('responseBody');
  });
});

function renderEditor(
  rows: React.ComponentProps<typeof InvoiceRowsEditor>['rows'],
): string {
  return renderToStaticMarkup(
    <InvoiceRowsEditor
      errorsByRowId={undefined}
      rows={rows}
      onAdd={vi.fn()}
      onChange={vi.fn()}
      onRemove={vi.fn()}
    />,
  );
}
