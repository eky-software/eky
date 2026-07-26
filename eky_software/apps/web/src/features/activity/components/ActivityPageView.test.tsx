import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { ActivityPageView } from './ActivityPageView.js';

describe('ActivityPageView', () => {
  it('renders safe activity references and Finnish labels', () => {
    const html = renderToStaticMarkup(
      <ActivityPageView
        errorMessage={null}
        isLoading={false}
        items={[
          {
            id: 'invoicing:event-1',
            module: 'invoicing',
            occurredAt: '2026-07-27T10:00:00.000Z',
            reference: { kind: 'invoiceNumber', value: '20260001' },
            type: 'invoice.delivered',
          },
        ]}
      />,
    );

    expect(html).toContain('Lasku toimitettu');
    expect(html).toContain('Lasku 20260001');
    expect(html).not.toContain('rawMetadata');
  });

  it('renders loading, empty and safe error states', () => {
    const loading = renderToStaticMarkup(
      <ActivityPageView errorMessage={null} isLoading items={[]} />,
    );
    const empty = renderToStaticMarkup(
      <ActivityPageView errorMessage={null} isLoading={false} items={[]} />,
    );
    const error = renderToStaticMarkup(
      <ActivityPageView
        errorMessage="Tapahtumia ei voitu ladata."
        isLoading={false}
        items={[]}
      />,
    );

    expect(loading).toContain('Ladataan tapahtumia');
    expect(empty).toContain('Tapahtumia ei ole vielä');
    expect(error).toContain('role="alert"');
  });
});
