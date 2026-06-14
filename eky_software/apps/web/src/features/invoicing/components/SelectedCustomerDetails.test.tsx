import type { Customer } from '@eky/api-client';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import {
  formatCustomerAddress,
  SelectedCustomerDetails,
} from './SelectedCustomerDetails.js';
import { uiText } from '../../../i18n/fi.js';

describe('SelectedCustomerDetails', () => {
  it('renders the selected customer card information', () => {
    const html = renderToStaticMarkup(
      <SelectedCustomerDetails
        customer={createCustomer()}
        propertyManager={null}
      />,
    );

    expect(html).toContain('Esimerkki Asiakas Oy');
    expect(html).toContain('1001');
    expect(html).toContain('1234567-8');
    expect(html).toContain('Testikatu 1, 00100 Helsinki');
    expect(html).toContain('testi@example.fi');
    expect(html).toContain('040 123 4567');
    expect(html).toContain('65,50 €/h');
    expect(html).toContain('Sisäinen testikommentti');
    expect(html).toContain(uiText.customers.active);
  });

  it('shows the property manager for a managed housing company', () => {
    const html = renderToStaticMarkup(
      <SelectedCustomerDetails
        customer={createCustomer({
          customerType: 'housingCompany',
          managedByCustomerId: 'property-manager-1',
        })}
        propertyManager={createCustomer({
          id: 'property-manager-1',
          customerNumber: '2001',
          customerType: 'propertyManager',
          name: 'Esimerkki Isännöinti Oy',
        })}
      />,
    );

    expect(html).toContain(uiText.customers.managedByPropertyManager);
    expect(html).toContain('2001 – Esimerkki Isännöinti Oy');
  });

  it('shows safe fallbacks for missing optional information', () => {
    const html = renderToStaticMarkup(
      <SelectedCustomerDetails
        customer={createCustomer({
          businessId: '',
          city: '',
          comment: '',
          email: '',
          hourlyRateOverrideCents: null,
          phone: '',
          postalCode: '',
          streetAddress: '',
        })}
        propertyManager={null}
      />,
    );

    expect(html).toContain(uiText.invoicing.notSet);
    expect(html).toContain(uiText.invoicing.customerDefaultHourlyRate);
    expect(html).not.toContain(uiText.customers.comment);
  });
});

describe('formatCustomerAddress', () => {
  it('joins the street address, postal code and city compactly', () => {
    expect(formatCustomerAddress(createCustomer())).toBe(
      'Testikatu 1, 00100 Helsinki',
    );
  });

  it('does not add punctuation around missing address parts', () => {
    expect(
      formatCustomerAddress(
        createCustomer({
          postalCode: '',
          streetAddress: '',
        }),
      ),
    ).toBe('Helsinki');
  });
});

function createCustomer(overrides: Partial<Customer> = {}): Customer {
  return {
    id: 'customer-1',
    companyId: 'dev-company',
    customerNumber: '1001',
    name: 'Esimerkki Asiakas Oy',
    customerType: 'company',
    businessId: '1234567-8',
    streetAddress: 'Testikatu 1',
    postalCode: '00100',
    city: 'Helsinki',
    email: 'testi@example.fi',
    managedByCustomerId: '',
    phone: '040 123 4567',
    comment: 'Sisäinen testikommentti',
    hourlyRateOverrideCents: 6550,
    status: 'active',
    createdAt: '2026-06-15T10:00:00.000Z',
    updatedAt: '2026-06-15T10:00:00.000Z',
    ...overrides,
  };
}
