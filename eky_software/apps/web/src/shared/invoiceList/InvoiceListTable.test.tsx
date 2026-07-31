import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import {
  InvoiceListTable,
  type InvoiceListTableLabels,
} from './InvoiceListTable.js';

const labels: InvoiceListTableLabels = {
  actions: 'Toiminnot',
  creditRelation: 'Hyvityssuhde',
  customer: 'Asiakas',
  dueDate: 'Eräpäivä',
  invoice: 'Lasku',
  invoiceDate: 'Päiväys',
  paidOn: 'Maksupäivä',
  status: 'Tila',
  total: 'Yhteensä',
};

describe('InvoiceListTable', () => {
  it('renders a semantic invoice table with optional columns', () => {
    const html = renderToStaticMarkup(
      <InvoiceListTable
        ariaLabel="Maksetut laskut"
        labels={labels}
        rows={[
          {
            action: <button type="button">Avaa</button>,
            creditRelation: 'Ei hyvityksiä',
            customer: '1001 – Testiasiakas Oy',
            dueDate: '2026-07-20',
            invoiceDate: '2026-07-06',
            key: 'invoice-1',
            paidOn: '2026-07-18',
            reference: '2026001',
            status: 'Maksettu',
            totalCents: 12_345,
          },
        ]}
        showActions
        showCreditRelation
        showCustomer
        showPaidOn
      />,
    );

    expect(html).toContain('<table');
    expect(html).toContain('<thead>');
    expect(html).toContain('<tbody>');
    expect(html).toContain('aria-label="Maksetut laskut"');
    expect(html).toContain('scope="col">Maksupäivä</th>');
    expect(html).toContain('scope="col">Hyvityssuhde</th>');
    expect(html).toContain('aria-label="Toiminnot"');
    expect(html).toContain('dateTime="2026-07-18"');
    expect(html).toContain('123,45');
  });

  it('omits unused columns from compact invoice lists', () => {
    const html = renderToStaticMarkup(
      <InvoiceListTable
        ariaLabel="Luonnokset"
        labels={labels}
        rows={[
          {
            dueDate: '2026-07-20',
            invoiceDate: '2026-07-06',
            key: 'draft-1',
            reference: 'Luonnos',
            status: 'Luonnos',
            totalCents: 1_000,
          },
        ]}
      />,
    );

    expect(html).not.toContain('>Asiakas</th>');
    expect(html).not.toContain('>Maksupäivä</th>');
    expect(html).not.toContain('>Hyvityssuhde</th>');
    expect(html).not.toContain('aria-label="Toiminnot"');
  });
});
