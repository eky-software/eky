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
    paid: createEmptyPage(),
    sent: createEmptyPage(),
  },
  isLoading: false,
  onBack: () => undefined,
  onEdit: () => undefined,
  onOpenInvoice: () => undefined,
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
});

function createEmptyPage() {
  return {
    items: [],
    page: 1,
    totalCount: 0,
    totalPages: 0,
  };
}
