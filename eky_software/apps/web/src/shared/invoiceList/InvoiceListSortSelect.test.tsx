import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { InvoiceListSortSelect } from './InvoiceListSortSelect.js';

describe('InvoiceListSortSelect', () => {
  it('renders an accessible controlled sort choice', () => {
    const html = renderToStaticMarkup(
      <InvoiceListSortSelect
        label="Järjestys"
        onChange={() => undefined}
        options={[
          { label: 'Uusimmat ensin', value: 'invoiceDateDesc' },
          { label: 'Vanhimmat ensin', value: 'invoiceDateAsc' },
        ]}
        value="invoiceDateAsc"
      />,
    );

    expect(html).toContain('aria-label="Järjestys"');
    expect(html).toContain(
      '<option value="invoiceDateAsc" selected="">Vanhimmat ensin</option>',
    );
  });
});
