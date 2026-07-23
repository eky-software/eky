import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { ApprovedInvoiceTotals } from './ApprovedInvoiceTotals.js';
import { uiText } from '../../../i18n/fi.js';

describe('ApprovedInvoiceTotals', () => {
  it('renders VAT breakdown and stored invoice totals', () => {
    const html = renderToStaticMarkup(
      <ApprovedInvoiceTotals
        breakdown={[
          {
            grossCents: 12550,
            netCents: 10000,
            vatCents: 2550,
            vatRateBasisPoints: 2550,
          },
        ]}
        invoiceKind="standard"
        totals={{
          grossTotalCents: 12550,
          netTotalCents: 10000,
          vatBreakdown: [
            {
              grossCents: 12550,
              netCents: 10000,
              vatCents: 2550,
              vatRateBasisPoints: 2550,
            },
          ],
          vatTotalCents: 2550,
        }}
      />,
    );

    expect(html).toContain(uiText.invoicing.vatBreakdown);
    expect(html).toContain(uiText.invoicing.netAmount);
    expect(html).toContain(uiText.invoicing.vatAmount);
    expect(html).toContain(uiText.invoicing.grossTotal);
    expect(html).toContain(uiText.invoicing.invoiceTotals);
    expect(html).toContain('100,00');
    expect(html).toContain('25,50');
    expect(html).toContain('125,50');
  });
});
