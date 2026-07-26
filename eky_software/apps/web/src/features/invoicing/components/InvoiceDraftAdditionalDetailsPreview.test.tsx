import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { InvoiceDraftAdditionalDetailsPreview } from './InvoiceDraftAdditionalDetailsPreview.js';
import { createInitialNewInvoiceForm } from '../form/newInvoiceFormState.js';
import { uiText } from '../../../i18n/fi.js';

describe('InvoiceDraftAdditionalDetailsPreview', () => {
  it('hides an invoice-date default with empty optional details', () => {
    expect(renderPreview()).toBe('');
  });

  it('shows a single performance date before delivery and note', () => {
    const html = renderPreview({
      deliveryAddressText: 'Testikohde',
      note: 'Testilasku',
      performanceDate: '2026-07-16',
      performancePeriodType: 'singleDate',
    });

    expect(html).toContain(uiText.invoicing.performanceDate);
    expect(html).toContain('16.07.2026');
    expect(html.indexOf(uiText.invoicing.performanceDate)).toBeLessThan(
      html.indexOf(uiText.invoicing.deliveryAddressText),
    );
    expect(html.indexOf(uiText.invoicing.deliveryAddressText)).toBeLessThan(
      html.indexOf(uiText.invoicing.note),
    );
  });

  it('shows a date range even when delivery and note are empty', () => {
    const html = renderPreview({
      performancePeriodEnd: '2026-07-31',
      performancePeriodStart: '2026-07-01',
      performancePeriodType: 'dateRange',
    });

    expect(html).toContain(uiText.invoicing.performancePeriodDateRange);
    expect(html).toContain('01.07.2026–31.07.2026');
    expect(html).not.toContain(uiText.invoicing.deliveryAddressText);
    expect(html).not.toContain(uiText.invoicing.note);
  });
});

type Form = ReturnType<typeof createInitialNewInvoiceForm>;

function renderPreview(overrides: Partial<Form> = {}): string {
  return renderToStaticMarkup(
    <InvoiceDraftAdditionalDetailsPreview
      form={{
        ...createInitialNewInvoiceForm(new Date(2026, 6, 16)),
        ...overrides,
      }}
    />,
  );
}
