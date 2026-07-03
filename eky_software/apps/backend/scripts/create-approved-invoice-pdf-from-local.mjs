import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createDatabaseConnection } from '../dist/database/connection/createDatabaseConnection.js';
import { SqliteApprovedInvoiceReader } from '../dist/modules/invoicing/infrastructure/sqliteApprovedInvoiceReader.js';
import { renderApprovedInvoicePdf } from '../dist/modules/invoicing/infrastructure/pdf/approvedInvoicePdfRenderer.js';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const invoiceNumber = process.argv.slice(2).find((argument) => argument !== '--')?.trim();
const companyId = process.env.COMPANY_ID?.trim() || 'dev-company';

if (!invoiceNumber) {
  console.error(
    'Anna laskunumero: pnpm --filter @eky/backend local:approved-invoice-pdf -- 2026010',
  );
  process.exitCode = 1;
} else {
  const database = createDatabaseConnection();

  try {
    const invoiceRow = database
      .prepare(
        `
          SELECT id
          FROM invoices
          WHERE
            company_id = ?
            AND invoice_number = ?
            AND status = 'approved'
        `,
      )
      .get(companyId, invoiceNumber);

    if (!invoiceRow || typeof invoiceRow.id !== 'string') {
      console.error(
        `Hyväksyttyä laskua numerolla ${invoiceNumber} ei löytynyt yritykselle ${companyId}.`,
      );
      process.exitCode = 1;
    } else {
      const reader = new SqliteApprovedInvoiceReader(database);
      const invoice = await reader.getApprovedInvoiceById(companyId, invoiceRow.id);

      if (!invoice) {
        console.error(
          `Hyväksytyn laskun ${invoiceNumber} snapshotia ei voitu lukea.`,
        );
        process.exitCode = 1;
      } else {
        const pdf = await renderApprovedInvoicePdf(invoice);
        const outputPath = resolve(
          scriptDirectory,
          '..',
          'dist',
          'sample-pdfs',
          `approved-invoice-${invoice.invoiceNumber}.pdf`,
        );

        mkdirSync(dirname(outputPath), { recursive: true });
        writeFileSync(outputPath, pdf);
        console.log(outputPath);
      }
    }
  } finally {
    database.close();
  }
}
