import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { InvoiceVatRatesForm } from './InvoiceVatRatesForm.js';
import { uiText } from '../../i18n/fi.js';

describe('InvoiceVatRatesForm', () => {
  it('renders editable rates with active, default, add, remove and save actions', () => {
    const html = renderToStaticMarkup(
      <InvoiceVatRatesForm
        errorMessage={null}
        isSaving={false}
        rows={[
          {
            id: 'rate-1',
            isActive: true,
            isDefault: true,
            label: 'Yleinen ALV',
            ratePercent: '25,50',
          },
          {
            id: 'rate-2',
            isActive: false,
            isDefault: false,
            label: 'Vanha kanta',
            ratePercent: '14,00',
          },
        ]}
        settings={{
          isPersisted: true,
          vatRates: [],
        }}
        successMessage={null}
        validationErrors={{ rows: {} }}
        onAdd={vi.fn()}
        onChange={vi.fn()}
        onRemove={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );

    expect(html).toContain('25,50');
    expect(html).toContain('14,00');
    expect(html).toContain(uiText.companySettings.invoiceVatRateActive);
    expect(html).toContain(uiText.companySettings.invoiceVatRateDefault);
    expect(html).toContain(uiText.companySettings.invoiceVatRatesAdd);
    expect(html).toContain(uiText.companySettings.invoiceVatRatesRemove);
    expect(html).toContain(uiText.companySettings.invoiceVatRatesSave);
    expect(html).toContain('type="radio"');
    expect(html).toContain('type="checkbox"');
  });
});
