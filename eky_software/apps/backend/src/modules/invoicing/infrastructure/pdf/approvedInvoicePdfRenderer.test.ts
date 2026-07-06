import { describe, expect, it } from 'vitest';

import type { ApprovedInvoiceViewLine } from '../../domain/approvedInvoiceView.js';
import {
  formatPdfCents,
  formatPdfDate,
  formatPdfIban,
  formatPdfPercentBasisPoints,
  formatPdfQuantity,
} from './approvedInvoicePdfFormatting.js';
import { renderApprovedInvoicePdf } from './approvedInvoicePdfRenderer.js';
import { createApprovedInvoicePdfSample } from './approvedInvoicePdfSample.js';

describe('approved invoice PDF renderer', () => {
  it('renders a non-empty PDF from ApprovedInvoiceView snapshot data', async () => {
    const pdf = await renderApprovedInvoicePdf(createApprovedInvoicePdfSample());

    expect(pdf.length).toBeGreaterThan(1000);
    expect(Buffer.from(pdf.subarray(0, 4)).toString('ascii')).toBe('%PDF');
  });

  it('accepts Finnish characters in snapshot data', async () => {
    const invoice = createApprovedInvoicePdfSample();
    const firstLine = invoice.lines[0] as ApprovedInvoiceViewLine;

    await expect(
      renderApprovedInvoicePdf({
        ...invoice,
        companyNameSnapshot: 'Äänekäs Rakennus Oy',
        billingRecipientNameSnapshot: 'Isännöinti Öljymäki Oy',
        lines: [
          {
            ...firstLine,
            description: 'Liesituulettimen poistoilmaventtiilin säätötyö',
          },
        ],
      }),
    ).resolves.toBeInstanceOf(Uint8Array);
  });

  it('formats invoice values for the PDF layout', () => {
    expect(formatPdfCents(45430)).toBe('454,30 EUR');
    expect(formatPdfCents(106675)).toBe('1 066,75 EUR');
    expect(formatPdfDate('2026-07-03')).toBe('03.07.2026');
    expect(formatPdfPercentBasisPoints(2550)).toBe('25,50 %');
    expect(formatPdfQuantity(150)).toBe('1,50');
    expect(formatPdfIban('FI2112345600000785')).toBe(
      'FI21 1234 5600 0007 85',
    );
  });

  it('keeps the renderer independent from database and master-data readers', async () => {
    const pdf = await renderApprovedInvoicePdf(createApprovedInvoicePdfSample());

    expect(pdf.length).toBeGreaterThan(0);
  });
});
