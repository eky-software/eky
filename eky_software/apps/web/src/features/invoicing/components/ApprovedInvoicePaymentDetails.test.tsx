import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { ApprovedInvoicePaymentDetails } from './ApprovedInvoicePaymentDetails.js';
import { uiText } from '../../../i18n/fi.js';

describe('ApprovedInvoicePaymentDetails', () => {
  it('renders stored payment details and formatted values', () => {
    const html = renderToStaticMarkup(
      <ApprovedInvoicePaymentDetails
        bankName="Example Bank"
        bic="NDEAFIHH"
        dueDate="2026-06-27"
        grossTotalCents={12550}
        iban="FI2112345600000785"
        referenceNumber="202600017"
      />,
    );

    expect(html).toContain(uiText.invoicing.paymentDetails);
    expect(html).toContain('Example Bank');
    expect(html).toContain('FI21 1234 5600 0007 85');
    expect(html).toContain('NDEAFIHH');
    expect(html).toContain('202600017');
    expect(html).toContain('27.06.2026');
    expect(html).toContain('125,50');
  });
});
