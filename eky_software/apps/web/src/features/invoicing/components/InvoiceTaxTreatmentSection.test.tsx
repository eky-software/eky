import type { Customer } from '@eky/api-client';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { InvoiceTaxTreatmentSection } from './InvoiceTaxTreatmentSection.js';
import {
  applyInvoiceTaxTreatment,
  createInitialNewInvoiceForm,
} from '../form/newInvoiceFormState.js';
import { uiText } from '../../../i18n/fi.js';

describe('InvoiceTaxTreatmentSection', () => {
  it('keeps reverse charge inside a closed advanced section by default', () => {
    const html = renderToStaticMarkup(
      <InvoiceTaxTreatmentSection
        errors={undefined}
        form={createInitialNewInvoiceForm(new Date(2026, 6, 26))}
        selectedCustomer={null}
        onTaxTreatmentChange={vi.fn()}
      />,
    );

    expect(html).toContain(uiText.invoicing.advancedInvoiceSettings);
    expect(html).toContain('value="reverseChargeConstruction"');
    expect(html).not.toContain('<details open');
  });

  it('shows legal customer details without performance controls for reverse charge', () => {
    const form = applyInvoiceTaxTreatment(
      createInitialNewInvoiceForm(new Date(2026, 6, 26)),
      'reverseChargeConstruction',
      2550,
    );
    const html = renderToStaticMarkup(
      <InvoiceTaxTreatmentSection
        errors={undefined}
        form={form}
        selectedCustomer={createCustomer()}
        onTaxTreatmentChange={vi.fn()}
      />,
    );

    expect(html).toContain('<details');
    expect(html).toContain('open=""');
    expect(html).toContain('Rakennusostaja Oy');
    expect(html).toContain('1234567-8');
    expect(html).toContain(uiText.invoicing.reverseChargeWarningTitle);
    expect(html).not.toContain(uiText.invoicing.performancePeriod);
  });
});

function createCustomer(): Customer {
  return {
    businessId: '1234567-8',
    city: 'Helsinki',
    comment: '',
    companyId: 'dev-company',
    createdAt: '2026-07-26T10:00:00.000Z',
    customerNumber: '1001',
    customerType: 'company',
    email: 'ostaja@example.fi',
    hourlyRateOverrideCents: null,
    id: 'customer-1',
    managedByCustomerId: '',
    name: 'Rakennusostaja Oy',
    phone: '',
    postalCode: '00100',
    status: 'active',
    streetAddress: 'Ostajankatu 1',
    updatedAt: '2026-07-26T10:00:00.000Z',
  };
}
