import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { CustomerOverviewWorkspace } from './CustomerOverviewWorkspace.js';

const baseProps = {
  customer: null,
  customers: [],
  defaultHourlyRateCents: null,
  errorMessage: null,
  isLoading: false,
  onBack: () => undefined,
  onEdit: () => undefined,
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
    expect(html).toContain('Takaisin asiakaslistaan');
  });
});
