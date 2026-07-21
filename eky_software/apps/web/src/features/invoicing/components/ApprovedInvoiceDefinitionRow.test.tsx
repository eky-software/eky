import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { ApprovedInvoiceDefinitionRow } from './ApprovedInvoiceDefinitionRow.js';

describe('ApprovedInvoiceDefinitionRow', () => {
  it('renders the supplied label and value with the existing detail structure', () => {
    const html = renderToStaticMarkup(
      <dl>
        <ApprovedInvoiceDefinitionRow label="Viitenumero" value="202600018" />
      </dl>,
    );

    expect(html).toContain('<dt>Viitenumero</dt>');
    expect(html).toContain('>202600018</dd>');
  });
});
