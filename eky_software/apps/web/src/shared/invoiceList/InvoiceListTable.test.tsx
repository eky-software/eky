import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import {
  InvoiceListTable,
  type InvoiceListTableLabels,
} from './InvoiceListTable.js';
import styles from './InvoiceListTable.module.css';

const labels: InvoiceListTableLabels = {
  actions: 'Toiminnot',
  creditRelation: 'Hyvityssuhde',
  customer: 'Asiakas',
  dueDate: 'Eräpäivä',
  invoice: 'Lasku',
  invoiceDate: 'Päiväys',
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
            reference: '2026001',
            status: 'Maksettu',
            statusDetail: (
              <span>
                Maksupäivä <time dateTime="2026-07-18">18.07.2026</time>
              </span>
            ),
            totalCents: 12_345,
          },
        ]}
        showActions
        showCreditRelation
        showCustomer
      />,
    );

    expect(html).toContain('<table');
    expect(html).toContain('<thead>');
    expect(html).toContain('<tbody>');
    expect(html).toContain('aria-label="Maksetut laskut"');
    expect(html).toContain('scope="col">Hyvityssuhde</th>');
    expect(html).toContain('aria-label="Toiminnot"');
    expect(html).toContain('dateTime="2026-07-18"');
    expect(html).toContain('Maksupäivä');
    expect(html).toContain('123,45');
    expect(html).toContain(`<th class="${styles.numeric}" scope="col">`);
    expect(html).toContain(
      `<td class="${styles.numeric} ${styles.total}">`,
    );
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
    expect(html).not.toContain('>Hyvityssuhde</th>');
    expect(html).not.toContain('aria-label="Toiminnot"');
  });

  it('keeps the action inside its bounded table cell', () => {
    const html = renderToStaticMarkup(
      <InvoiceListTable
        ariaLabel="Laskut"
        labels={labels}
        rows={[
          {
            action: <button type="button">Avaa lasku</button>,
            dueDate: '2026-07-20',
            invoiceDate: '2026-07-06',
            key: 'invoice-1',
            reference: '2026001',
            status: 'Lähetetty',
            totalCents: 1_000,
          },
        ]}
        showActions
      />,
    );

    expect(html).toContain(`<td class="${styles.action}">`);
    expect(html).toContain('>Avaa lasku</button>');
  });
});
