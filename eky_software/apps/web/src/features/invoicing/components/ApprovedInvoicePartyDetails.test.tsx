import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { ApprovedInvoicePartyDetails } from './ApprovedInvoicePartyDetails.js';
import { uiText } from '../../../i18n/fi.js';

describe('ApprovedInvoicePartyDetails', () => {
  it('renders party snapshot fields including long contact values', () => {
    const longEmail =
      'billing.with.a.very.long.address.for.preview.testing@example-builder-company.test';
    const html = renderToStaticMarkup(
      <ApprovedInvoicePartyDetails
        businessId="7654321-0"
        city="Tampere"
        customerNumber="1001"
        email={longEmail}
        name="Example Builder Oy"
        phone="03 123 4567"
        postalCode="33100"
        streetAddress="Builder Street 2"
        title={uiText.invoicing.seller}
        vatNumber="FI76543210"
        website="www.example-builder.fi"
      />,
    );

    expect(html).toContain('Example Builder Oy');
    expect(html).toContain('7654321-0');
    expect(html).toContain('FI76543210');
    expect(html).toContain('33100 Tampere');
    expect(html).toContain(longEmail);
    expect(html).toContain('www.example-builder.fi');
  });
});
