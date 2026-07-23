import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { ApprovedInvoiceLineTable } from './ApprovedInvoiceLineTable.js';
import { uiText } from '../../../i18n/fi.js';

describe('ApprovedInvoiceLineTable', () => {
  it('renders stored invoice line values using the selected price mode', () => {
    const html = renderToStaticMarkup(
      <ApprovedInvoiceLineTable
        invoiceKind="standard"
        lines={[
          {
            baseCents: 10000,
            code: 'WORK',
            description: 'Work row',
            discount: { type: 'percentage', basisPoints: 500 },
            discountCents: 500,
            grossCents: 11923,
            id: 'line-1',
            sourceInvoiceLineId: null,
            lineOrder: 1,
            netCents: 9500,
            quantityHundredths: 150,
            unit: 'h',
            unitPriceCents: 10000,
            vatCents: 2423,
            vatRateBasisPoints: 2550,
          },
        ]}
        priceInputMode="net"
      />,
    );

    expect(html).toContain(uiText.invoicing.priceInputNet);
    expect(html).toContain('WORK');
    expect(html).toContain('Work row');
    expect(html).toContain('1,50');
    expect(html).toContain('100,00');
    expect(html).toContain('25,50 %');
    expect(html).toContain('5,00 %');
    expect(html).toContain('95,00');
  });
});
