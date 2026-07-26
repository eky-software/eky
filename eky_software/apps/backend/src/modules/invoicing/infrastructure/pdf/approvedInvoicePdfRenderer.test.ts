import PDFDocument from 'pdfkit';
import { describe, expect, it, vi } from 'vitest';

import type {
  ApprovedInvoiceView,
  ApprovedInvoiceViewLine,
} from '../../domain/approvedInvoiceView.js';
import {
  formatPdfCents,
  formatPdfDate,
  formatPdfIban,
  formatPdfPercentBasisPoints,
  formatPdfPresentedCents,
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

  it('renders a non-empty credit invoice PDF from snapshot data', async () => {
    const invoice = createApprovedInvoicePdfSample();

    const pdf = await renderApprovedInvoicePdf({
      ...invoice,
      creditedInvoiceId: 'source-invoice-1',
      creditedInvoiceNumber: '20260001',
      creditedInvoiceDate: '2026-07-01',
      invoiceKind: 'credit',
      invoiceNumber: '20260002',
      referenceNumber: '',
      referenceNumberType: 'none',
      dueDate: invoice.invoiceDate,
      paymentTermDays: 0,
      reminderPeriodDays: 0,
      latePaymentInterestBasisPoints: 0,
      lines: invoice.lines.map((line) => ({
        ...line,
        sourceInvoiceLineId: `source-${line.id}`,
      })),
    });

    expect(pdf.length).toBeGreaterThan(1000);
    expect(Buffer.from(pdf.subarray(0, 4)).toString('ascii')).toBe('%PDF');
  });

  it('renders a normal VAT single performance date without other additional details', async () => {
    const { pdf, renderedText } = await renderAndCollectText({
      deliveryAddressText: '',
      note: '',
      performancePeriod: {
        type: 'singleDate',
        date: '2026-06-18',
      },
    });

    expect(pdf.length).toBeGreaterThan(1000);
    expect(renderedText).toContain('Suorituspäivä');
    expect(renderedText.filter((value) => value === '18.06.2026')).toHaveLength(
      1,
    );
    expect(renderedText).toContain('ALV-erittely');
  });

  it('renders a normal VAT performance range without other additional details', async () => {
    const { renderedText } = await renderAndCollectText({
      deliveryAddressText: '',
      note: '',
      performancePeriod: {
        type: 'dateRange',
        startDate: '2026-06-01',
        endDate: '2026-06-15',
      },
    });

    expect(renderedText).toContain('Laskutusjakso');
    expect(
      renderedText.filter((value) => value === '01.06.2026–15.06.2026'),
    ).toHaveLength(1);
    expect(renderedText).toContain('ALV-erittely');
  });

  it('renders an inherited performance period on a credit invoice', async () => {
    const invoice = createApprovedInvoicePdfSample();
    const { renderedText } = await renderAndCollectText({
      creditedInvoiceId: 'source-invoice-1',
      creditedInvoiceNumber: '20260001',
      creditedInvoiceDate: '2026-07-01',
      invoiceKind: 'credit',
      invoiceNumber: '20260002',
      performancePeriod: {
        type: 'singleDate',
        date: '2026-06-18',
      },
      referenceNumber: '',
      referenceNumberType: 'none',
      dueDate: invoice.invoiceDate,
      paymentTermDays: 0,
      reminderPeriodDays: 0,
      latePaymentInterestBasisPoints: 0,
    });

    expect(renderedText).toContain('Suorituspäivä');
    expect(renderedText).toContain('18.06.2026');
  });

  it('does not render a separate performance row for the invoice-date default', async () => {
    const { renderedText } = await renderAndCollectText({
      performancePeriod: { type: 'invoiceDate' },
    });

    expect(renderedText).not.toContain('Suorituspäivä');
    expect(renderedText).not.toContain('Laskutusjakso');
  });

  it('renders reverse charge labels without normal VAT columns or breakdown', async () => {
    const invoice = createApprovedInvoicePdfSample();
    const textSpy = vi.spyOn(PDFDocument.prototype, 'text');

    try {
      const pdf = await renderApprovedInvoicePdf({
        ...invoice,
        priceInputMode: 'net',
        taxTreatment: 'reverseChargeConstruction',
        taxTreatmentLabelSnapshot: 'Käännetty verovelvollisuus',
        taxLegalBasisSnapshot: 'AVL 8 c §',
        performancePeriod: {
          type: 'dateRange',
          startDate: '2026-06-01',
          endDate: '2026-06-15',
        },
        lines: invoice.lines.map((line) => ({
          ...line,
          grossCents: line.netCents,
          unitPriceCents: line.netCents,
          vatCents: 0,
          vatRateBasisPoints: null,
        })),
        totals: {
          grossTotalCents: invoice.totals.netTotalCents,
          netTotalCents: invoice.totals.netTotalCents,
          vatBreakdown: [],
          vatTotalCents: 0,
        },
        vatBreakdown: [],
      });
      const renderedText = textSpy.mock.calls.map(([value]) => value);

      expect(pdf.length).toBeGreaterThan(1000);
      expect(renderedText).toContain('Käännetty verovelvollisuus');
      expect(renderedText).toContain('AVL 8 c §');
      expect(renderedText).toContain('Ostajan Y-tunnus');
      expect(renderedText).toContain('1234567-8');
      expect(renderedText).toContain('Laskutusjakso');
      expect(
        renderedText.filter((value) => value === '01.06.2026–15.06.2026'),
      ).toHaveLength(1);
      expect(renderedText).not.toContain('ALV-erittely');
      expect(renderedText).not.toContain('ALV %');
      expect(renderedText).not.toContain('Alv yhteensä');
      expect(renderedText).not.toContain('25,50 %');
    } finally {
      textSpy.mockRestore();
    }
  });

  it('formats invoice values for the PDF layout', () => {
    expect(formatPdfCents(45430)).toBe('454,30 EUR');
    expect(formatPdfCents(106675)).toBe('1 066,75 EUR');
    expect(formatPdfPresentedCents(45430, 'standard')).toBe('454,30 EUR');
    expect(formatPdfPresentedCents(45430, 'credit')).toBe('-454,30 EUR');
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

async function renderAndCollectText(
  overrides: Partial<ApprovedInvoiceView>,
): Promise<{ pdf: Uint8Array; renderedText: unknown[] }> {
  const textSpy = vi.spyOn(PDFDocument.prototype, 'text');

  try {
    const pdf = await renderApprovedInvoicePdf({
      ...createApprovedInvoicePdfSample(),
      ...overrides,
    });

    return {
      pdf,
      renderedText: textSpy.mock.calls.map(([value]) => value),
    };
  } finally {
    textSpy.mockRestore();
  }
}
