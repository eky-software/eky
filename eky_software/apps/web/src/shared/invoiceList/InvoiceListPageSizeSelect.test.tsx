import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { InvoiceListPageSizeSelect } from './InvoiceListPageSizeSelect.js';

describe('InvoiceListPageSizeSelect', () => {
  it('renders the provided page sizes without inventing choices', () => {
    const html = renderToStaticMarkup(
      <InvoiceListPageSizeSelect
        label="Rivejä sivulla"
        onChange={() => undefined}
        options={[5, 20, 50]}
        value={20}
      />,
    );

    expect(html).toContain('aria-label="Rivejä sivulla"');
    expect(html).toContain('<option value="5">5</option>');
    expect(html).toContain('<option value="20" selected="">20</option>');
    expect(html).toContain('<option value="50">50</option>');
    expect(html).not.toContain('value="100"');
  });
});
