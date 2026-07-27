import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { ActivityPageView } from './ActivityPageView.js';

const baseProps = {
  errorMessage: null,
  hasNextPage: false,
  hasPreviousPage: false,
  isLoading: false,
  items: [],
  onCategoryChange: vi.fn(),
  onMonthChange: vi.fn(),
  onNextPage: vi.fn(),
  onOutcomeChange: vi.fn(),
  onPageSizeChange: vi.fn(),
  onPreviousPage: vi.fn(),
  query: {
    category: 'all' as const,
    month: '2026-07',
    outcome: 'all' as const,
    page: 1,
    pageSize: 20 as const,
  },
};

describe('ActivityPageView', () => {
  it('renders safe references, outcomes and monthly filter controls', () => {
    const html = renderToStaticMarkup(
      <ActivityPageView
        {...baseProps}
        items={[
          {
            id: 'invoicing:event-1',
            module: 'invoicing',
            occurredAt: '2026-07-27T10:00:00.000Z',
            outcome: 'failure',
            reference: { kind: 'invoiceNumber', value: '20260001' },
            type: 'invoice.deliveryFailed',
          },
        ]}
      />,
    );

    expect(html).toContain('Laskun lähetys epäonnistui');
    expect(html).toContain('Lasku 20260001');
    expect(html).toContain('Epäonnistui');
    expect(html).toContain('type="month"');
    expect(html).toContain('Kategoria');
    expect(html).toContain('Rivejä');
    expect(html).not.toContain('rawMetadata');
  });

  it('renders loading, empty and safe error states', () => {
    const loading = renderToStaticMarkup(
      <ActivityPageView {...baseProps} isLoading />,
    );
    const empty = renderToStaticMarkup(<ActivityPageView {...baseProps} />);
    const error = renderToStaticMarkup(
      <ActivityPageView
        {...baseProps}
        errorMessage="Tapahtumia ei voitu ladata."
      />,
    );

    expect(loading).toContain('Ladataan tapahtumia');
    expect(empty).toContain('Tapahtumia ei ole vielä');
    expect(error).toContain('role="alert"');
  });

  it('shows stable page navigation state', () => {
    const html = renderToStaticMarkup(
      <ActivityPageView
        {...baseProps}
        hasNextPage
        hasPreviousPage
        query={{ ...baseProps.query, page: 2 }}
      />,
    );

    expect(html).toContain('Edellinen');
    expect(html).toContain('Sivu 2');
    expect(html).toContain('Seuraava');
  });
});
