import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { InvoiceIssuanceReadinessPanel } from './InvoiceIssuanceReadinessPanel.js';
import { uiText } from '../../../i18n/fi.js';

describe('InvoiceIssuanceReadinessPanel', () => {
  it('shows safe Finnish instructions without master data values', () => {
    const html = renderToStaticMarkup(
      <InvoiceIssuanceReadinessPanel
        issues={['companyIbanMissing', 'customerAddressMissing']}
      />,
    );

    expect(html).toContain(uiText.invoicing.invoiceIssuanceReadinessTitle);
    expect(html).toContain(
      uiText.invoicing.invoiceIssuanceReadinessIssue.companyIbanMissing,
    );
    expect(html).toContain(
      uiText.invoicing.invoiceIssuanceReadinessIssue.customerAddressMissing,
    );
    expect(html).not.toContain('FI2112345600000785');
  });
});
