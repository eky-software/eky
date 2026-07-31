import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { InvoiceListPagination } from './InvoiceListPagination.js';

describe('InvoiceListPagination', () => {
  it('disables only unavailable page directions', () => {
    const firstPageHtml = renderPagination(1, 3);
    const lastPageHtml = renderPagination(3, 3);

    expect(firstPageHtml).toMatch(
      /<button[^>]*disabled=""[^>]*>Edellinen<\/button>/,
    );
    expect(firstPageHtml).not.toMatch(
      /<button[^>]*disabled=""[^>]*>Seuraava<\/button>/,
    );
    expect(lastPageHtml).not.toMatch(
      /<button[^>]*disabled=""[^>]*>Edellinen<\/button>/,
    );
    expect(lastPageHtml).toMatch(
      /<button[^>]*disabled=""[^>]*>Seuraava<\/button>/,
    );
  });
});

function renderPagination(page: number, totalPages: number): string {
  return renderToStaticMarkup(
    <InvoiceListPagination
      ariaLabel="Laskusivut"
      nextLabel="Seuraava"
      onNextPage={() => undefined}
      onPreviousPage={() => undefined}
      page={page}
      pageLabel={`Sivu ${page} / ${totalPages}`}
      previousLabel="Edellinen"
      totalPages={totalPages}
    />,
  );
}
