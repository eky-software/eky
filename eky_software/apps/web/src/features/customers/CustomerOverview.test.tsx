import type { Customer } from '@eky/api-client';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { CustomerOverview } from './CustomerOverview.js';

describe('CustomerOverview', () => {
  it('renders customer master data as read-only semantic content', () => {
    const html = renderOverview(
      createCustomer({
        businessId: '1234567-8',
        comment: 'Sovittu yhteydenotto sähköpostilla.',
        email: 'laskutus@example.fi',
        hourlyRateOverrideCents: 7250,
        phone: '040 123 4567',
        streetAddress: 'Kotikatu 1',
      }),
    );

    expect(html).toContain('Asiakaskortti');
    expect(html).toContain('1001 · Yritys');
    expect(html).toContain('1234567-8');
    expect(html).toContain('laskutus@example.fi');
    expect(html).toContain('72,50 €/h');
    expect(html).toContain('Asiakaskohtainen tuntihinta');
    expect(html).toContain('Sovittu yhteydenotto sähköpostilla.');
    expect(html).toContain('Luotu');
    expect(html).toContain('Päivitetty');
    expect(html).not.toContain('<input');
    expect(html).not.toContain('<select');
    expect(html).not.toContain('<textarea');
  });

  it('shows the company default price when the customer has no override', () => {
    const html = renderOverview(
      createCustomer({ hourlyRateOverrideCents: null }),
      6550,
    );

    expect(html).toContain('65,50 €/h');
    expect(html).toContain('Oman yrityksen oletustuntihinta');
  });

  it('shows the related property manager for a housing company', () => {
    const propertyManager = createCustomer({
      customerNumber: '2001',
      customerType: 'propertyManager',
      id: 'property-manager-1',
      name: 'Selkeä Isännöinti Oy',
    });
    const housingCompany = createCustomer({
      customerType: 'housingCompany',
      managedByCustomerId: propertyManager.id,
      name: 'Asunto Oy Esimerkkipiha',
    });
    const html = renderToStaticMarkup(
      <CustomerOverview
        customer={housingCompany}
        customers={[housingCompany, propertyManager]}
        defaultHourlyRateState={{ status: 'loaded', valueCents: null }}
        onEdit={() => undefined}
        onOpenRelatedCustomer={() => undefined}
      />,
    );

    expect(html).toContain('Isännöitsijätoimisto');
    expect(html).toContain('2001 · Selkeä Isännöinti Oy');
    expect(html).toContain(
      'aria-label="Avaa asiakaskortti Selkeä Isännöinti Oy"',
    );
  });

  it('shows managed housing companies on a property manager card', () => {
    const propertyManager = createCustomer({
      customerType: 'propertyManager',
      id: 'property-manager-1',
      name: 'Selkeä Isännöinti Oy',
    });
    const housingCompany = createCustomer({
      customerNumber: '2002',
      customerType: 'housingCompany',
      id: 'housing-company-1',
      managedByCustomerId: propertyManager.id,
      name: 'Asunto Oy Esimerkkipiha',
    });
    const html = renderToStaticMarkup(
      <CustomerOverview
        customer={propertyManager}
        customers={[propertyManager, housingCompany]}
        defaultHourlyRateState={{ status: 'loaded', valueCents: null }}
        onEdit={() => undefined}
        onOpenRelatedCustomer={() => undefined}
      />,
    );

    expect(html).toContain('Hallinnoidut taloyhtiöt');
    expect(html).toContain('2002');
    expect(html).toContain('Asunto Oy Esimerkkipiha');
  });

  it('does not resolve a related customer from another company', () => {
    const propertyManager = createCustomer({
      companyId: 'another-company',
      customerType: 'propertyManager',
      id: 'property-manager-1',
      name: 'Vieraan yrityksen isännöitsijä',
    });
    const housingCompany = createCustomer({
      customerType: 'housingCompany',
      managedByCustomerId: propertyManager.id,
    });
    const html = renderToStaticMarkup(
      <CustomerOverview
        customer={housingCompany}
        customers={[housingCompany, propertyManager]}
        defaultHourlyRateState={{ status: 'loaded', valueCents: null }}
        onEdit={() => undefined}
        onOpenRelatedCustomer={() => undefined}
      />,
    );

    expect(html).toContain('Ei valittu');
    expect(html).not.toContain('Vieraan yrityksen isännöitsijä');
  });

  it('shows an inactive customer as read-only without editable controls', () => {
    const html = renderOverview(createCustomer({ status: 'inactive' }));

    expect(html).toContain('Passivoitu');
    expect(html).not.toContain('<input');
    expect(html).not.toContain('<select');
    expect(html).not.toContain('<textarea');
  });

  it('keeps a missing company default distinct from a loading failure', () => {
    const customer = createCustomer({ hourlyRateOverrideCents: null });
    const missingHtml = renderOverview(customer);
    const failedHtml = renderToStaticMarkup(
      <CustomerOverview
        customer={customer}
        customers={[customer]}
        defaultHourlyRateState={{ status: 'failed' }}
        onEdit={() => undefined}
        onOpenRelatedCustomer={() => undefined}
      />,
    );

    expect(missingHtml).toContain(
      'Oman yrityksen oletustuntihintaa ei ole asetettu',
    );
    expect(failedHtml).toContain(
      'Oman yrityksen oletustuntihintaa ei voitu ladata',
    );
    expect(failedHtml).not.toContain(
      'Oman yrityksen oletustuntihintaa ei ole asetettu',
    );
  });

  it('shows a bounded loading state for the company default', () => {
    const customer = createCustomer({ hourlyRateOverrideCents: null });
    const html = renderToStaticMarkup(
      <CustomerOverview
        customer={customer}
        customers={[customer]}
        defaultHourlyRateState={{ status: 'loading' }}
        onEdit={() => undefined}
        onOpenRelatedCustomer={() => undefined}
      />,
    );

    expect(html).toContain('Ladataan oletustuntihintaa...');
  });
});

function renderOverview(
  customer: Customer,
  defaultHourlyRateCents: number | null = null,
): string {
  return renderToStaticMarkup(
    <CustomerOverview
      customer={customer}
      customers={[customer]}
      defaultHourlyRateState={{
        status: 'loaded',
        valueCents: defaultHourlyRateCents,
      }}
      onEdit={() => undefined}
      onOpenRelatedCustomer={() => undefined}
    />,
  );
}

function createCustomer(overrides: Partial<Customer> = {}): Customer {
  return {
    businessId: '',
    city: 'Turku',
    comment: '',
    companyId: 'company-1',
    createdAt: '2026-07-30T10:00:00.000Z',
    customerNumber: '1001',
    customerType: 'company',
    email: '',
    hourlyRateOverrideCents: null,
    id: 'customer-1',
    managedByCustomerId: '',
    name: 'Esimerkki Rakennus Oy',
    phone: '',
    postalCode: '00100',
    status: 'active',
    streetAddress: '',
    updatedAt: '2026-07-31T10:00:00.000Z',
    ...overrides,
  };
}
