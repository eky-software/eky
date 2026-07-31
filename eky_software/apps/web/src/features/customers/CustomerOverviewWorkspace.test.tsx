import type { Customer } from '@eky/api-client';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { CustomerOverviewWorkspace } from './CustomerOverviewWorkspace.js';

const baseProps = {
  activityState: {
    activityEntries: [],
    errorMessage: null,
    goToPage: () => undefined,
    hasNextPage: false,
    hasPreviousPage: false,
    isLoading: false,
    page: 1,
  },
  billingRecipientInvoiceState: {
    approved: createEmptyPage(),
    cancelled: createEmptyPage(),
    credited: createEmptyPage(),
    errorMessage: null,
    goToPage: () => undefined,
    isLoading: false,
    pageSize: 5 as const,
    paid: createEmptyPage(),
    sent: createEmptyPage(),
    setPageSize: () => undefined,
    setSort: () => undefined,
    sort: 'invoiceDateDesc' as const,
  },
  customer: null,
  customers: [],
  defaultHourlyRateState: { status: 'loaded' as const, valueCents: null },
  errorMessage: null,
  invoiceState: {
    approved: createEmptyPage(),
    cancelled: createEmptyPage(),
    credited: createEmptyPage(),
    drafts: createEmptyPage(),
    errorMessage: null,
    goToPage: () => undefined,
    isLoading: false,
    pageSize: 5 as const,
    paid: createEmptyPage(),
    sent: createEmptyPage(),
    setPageSize: () => undefined,
    setSort: () => undefined,
    sort: 'invoiceDateDesc' as const,
  },
  isLoading: false,
  onBack: () => undefined,
  onEdit: () => undefined,
  onOpenInvoice: () => undefined,
  onOpenRelatedCustomer: () => undefined,
};

describe('CustomerOverviewWorkspace', () => {
  it('renders a bounded loading state', () => {
    const html = renderToStaticMarkup(
      <CustomerOverviewWorkspace {...baseProps} isLoading />,
    );

    expect(html).toContain('Ladataan asiakaskorttia...');
  });

  it('renders the provided safe error without technical fallback content', () => {
    const html = renderToStaticMarkup(
      <CustomerOverviewWorkspace
        {...baseProps}
        errorMessage="Asiakaskorttia ei voitu ladata."
      />,
    );

    expect(html).toContain('Asiakaskorttia ei voitu ladata.');
    expect(html).toContain('← Asiakaslistaan');
  });

  it('keeps customer list navigation available while loading', () => {
    const html = renderToStaticMarkup(
      <CustomerOverviewWorkspace {...baseProps} isLoading />,
    );

    expect(html).toContain('nav');
    expect(html).toContain('← Asiakaslistaan');
  });

  it('shows the separate recipient invoice panel only for a property manager', () => {
    const propertyManagerHtml = renderToStaticMarkup(
      <CustomerOverviewWorkspace
        {...baseProps}
        customer={createCustomer({ customerType: 'propertyManager' })}
        customers={[createCustomer({ customerType: 'propertyManager' })]}
      />,
    );
    const companyHtml = renderToStaticMarkup(
      <CustomerOverviewWorkspace
        {...baseProps}
        customer={createCustomer()}
        customers={[createCustomer()]}
      />,
    );

    expect(propertyManagerHtml).toContain(
      'Taloyhtiöiden laskut vastaanottajana',
    );
    expect(companyHtml).not.toContain(
      'Taloyhtiöiden laskut vastaanottajana',
    );
  });

  it('keeps customer master data visible when recipient invoices fail', () => {
    const propertyManager = createCustomer({
      customerType: 'propertyManager',
      name: 'Selkeä Isännöinti Oy',
    });
    const html = renderToStaticMarkup(
      <CustomerOverviewWorkspace
        {...baseProps}
        billingRecipientInvoiceState={{
          ...baseProps.billingRecipientInvoiceState,
          errorMessage:
            'Vastaanottajana saatuja laskuja ei voitu ladata turvallisesti.',
        }}
        customer={propertyManager}
        customers={[propertyManager]}
      />,
    );

    expect(html).toContain('Selkeä Isännöinti Oy');
    expect(html).toContain(
      'Vastaanottajana saatuja laskuja ei voitu ladata turvallisesti.',
    );
    expect(html).toContain('Asiakkaan laskut');
    expect(html).toContain('Asiakkaan tapahtumat');
  });
});

function createEmptyPage() {
  return {
    items: [],
    page: 1,
    totalCount: 0,
    totalPages: 0,
  };
}

function createCustomer(overrides: Partial<Customer> = {}): Customer {
  return {
    businessId: '1234567-8',
    city: 'Turku',
    comment: '',
    companyId: 'company-1',
    createdAt: '2026-07-30T10:00:00.000Z',
    customerNumber: '1001',
    customerType: 'company',
    email: 'customer@example.fi',
    hourlyRateOverrideCents: null,
    id: 'customer-1',
    managedByCustomerId: '',
    name: 'Esimerkki Oy',
    phone: '040 123 4567',
    postalCode: '00100',
    status: 'active',
    streetAddress: 'Kotikatu 1',
    updatedAt: '2026-07-31T10:00:00.000Z',
    ...overrides,
  };
}
