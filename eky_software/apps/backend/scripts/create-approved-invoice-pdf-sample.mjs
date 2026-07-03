import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createApprovedInvoicePdfSample } from '../dist/modules/invoicing/infrastructure/pdf/approvedInvoicePdfSample.js';
import { renderApprovedInvoicePdf } from '../dist/modules/invoicing/infrastructure/pdf/approvedInvoicePdfRenderer.js';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const outputPath = resolve(
  scriptDirectory,
  '../dist/sample-pdfs/approved-invoice-sample.pdf',
);

const pdf = await renderApprovedInvoicePdf(createApprovedInvoicePdfSample());

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, pdf);

console.log(outputPath);
