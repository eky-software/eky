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

  it('renders invoice settings activity without a technical reference', () => {
    const html = renderToStaticMarkup(
      <ActivityPageView
        {...baseProps}
        items={[
          {
            id: 'invoicing:settings-event',
            module: 'invoicing',
            occurredAt: '2026-07-27T10:00:00.000Z',
            outcome: 'success',
            reference: null,
            type: 'invoicePaymentSettings.updated',
          },
        ]}
      />,
    );

    expect(html).toContain('Laskutuksen maksuehtoja päivitetty');
    expect(html).toContain('Oma yritys');
    expect(html).not.toContain('company-');
  });

  it('renders safe invoice payment activity without payment details', () => {
    const html = renderToStaticMarkup(
      <ActivityPageView
        {...baseProps}
        items={[
          {
            id: 'invoicing:payment-event',
            module: 'invoicing',
            occurredAt: '2026-07-27T10:00:00.000Z',
            outcome: 'success',
            reference: { kind: 'invoiceNumber', value: '20260001' },
            type: 'invoice.paymentMarkedPaid',
          },
        ]}
      />,
    );

    expect(html).toContain('Lasku merkitty maksetuksi');
    expect(html).toContain('Lasku 20260001');
    expect(html).not.toContain('123,45');
    expect(html).not.toContain('actor-');
    expect(html).not.toContain('IBAN');
  });

  it('renders safe customer and company change categories without field values', () => {
    const html = renderToStaticMarkup(
      <ActivityPageView
        {...baseProps}
        items={[
          {
            changeCategories: ['contact', 'pricing'],
            id: 'customers:event-1',
            module: 'customers',
            occurredAt: '2026-07-27T10:00:00.000Z',
            outcome: 'success',
            reference: { kind: 'customerNumber', value: '1024' },
            type: 'customer.updated',
          },
          {
            changeCategories: ['banking', 'invoicingDefaults'],
            id: 'companySettings:event-1',
            module: 'companySettings',
            occurredAt: '2026-07-27T09:00:00.000Z',
            outcome: 'success',
            reference: null,
            type: 'companySettings.updated',
          },
        ]}
      />,
    );

    expect(html).toContain(
      'Asiakkaan 1024 yhteystietoja ja hinnoittelua päivitetty',
    );
    expect(html).toContain(
      'Oman yrityksen pankkitietoja ja laskutusasetuksia päivitetty',
    );
    expect(html).not.toContain('smtpPassword');
  });

  it('uses a bounded summary when more than three groups changed', () => {
    const html = renderToStaticMarkup(
      <ActivityPageView
        {...baseProps}
        items={[
          {
            changeCategories: [
              'address',
              'banking',
              'contact',
              'identity',
            ],
            id: 'companySettings:event-1',
            module: 'companySettings',
            occurredAt: '2026-07-27T09:00:00.000Z',
            outcome: 'success',
            reference: null,
            type: 'companySettings.updated',
          },
        ]}
      />,
    );

    expect(html).toContain('Useita tietoryhmiä päivitettiin');
    expect(html).not.toContain('pankkitietoja');
  });
});
