import PDFDocument from 'pdfkit';
import { describe, expect, it, vi } from 'vitest';

import {
  createCreditRevisionPdfContentFixture,
  createInvoiceRevisionPdfContentFixture,
} from '../../application/toInvoiceRevisionPdfContent.fixture.js';
import {
  InvoiceRevisionPdfContentUnavailableError,
  toInvoiceRevisionPdfContent,
} from '../../application/toInvoiceRevisionPdfContent.js';
import type { InvoiceContentRevision } from '../../domain/invoiceContentRevision.js';
import {
  reverseChargeConstructionLabel,
  reverseChargeConstructionLegalBasis,
} from '../../domain/invoiceTaxTreatment.js';
import { renderApprovedInvoicePdf } from './approvedInvoicePdfRenderer.js';

describe('approved invoice revision PDF renderer', () => {
  it('renders exact snapshot parties, lines and authoritative totals without live state', async () => {
    const { text } = await renderRevision(createInvoiceRevisionPdfContentFixture());
    expect(text).toContain('Lasku: 20261001');
    expect(text).toContain('Example Seller Oy');
    expect(text).toContain('Example Customer Oy');
    expect(text).toContain('Example Recipient Oy');
    expect(text).toContain('Example item 1');
    expect(text).toContain('Alennus 10,00 %');
    expect(text).toContain('Alennus 0,05 EUR');
    expect(text).toContain('1,04 EUR');
    expect(text).toContain('0,15 EUR');
    expect(text).toContain('1,19 EUR');
    expect(text).not.toContain('0,16 EUR');
    expect(text).toContain('29.09.2026');
    expect(text).toContain('Viitenumero: 202610010');
    expect(text).toContain('Eräpäivä: 20.10.2026');
    expect(text).not.toContain('Not rendered by the current layout');
  });

  it('renders stored credit references and cumulative rounding without a payment demand', async () => {
    const revision = createCreditRevisionPdfContentFixture();
    Object.assign(revision, {
      creditedInvoiceNumber: 'LIVE-NUMBER',
      creditedInvoiceDate: '2099-01-01',
    });
    const { text } = await renderRevision(revision);
    expect(text).toContain('Hyvityslasku: 20261001');
    expect(text).toContain('20260991');
    expect(text).toContain('01.09.2026');
    expect(text).not.toContain('LIVE-NUMBER');
    expect(text).not.toContain('01.01.2099');
    expect(text).toContain('-0,67 EUR');
    expect(text).toContain('-0,18 EUR');
    expect(text).toContain('-0,85 EUR');
    expect(text).not.toContain('-0,17 EUR');
    expect(text).toContain('Palautustili');
    expect(text).toContain('FI21 1234 5600 0007 85');
    expect(text.some((value) => /Viitenumero|Eräpäivä|Maksuehto/.test(value))).toBe(false);
  });

  it('renders reverse charge with stored labels and performance range, not a zero VAT group', async () => {
    const fixture = createInvoiceRevisionPdfContentFixture();
    const { text } = await renderRevision({
      ...fixture,
      taxTreatment: 'reverseChargeConstruction',
      taxTreatmentLabelSnapshot: reverseChargeConstructionLabel,
      taxLegalBasisSnapshot: reverseChargeConstructionLegalBasis,
      performanceDate: null,
      performancePeriodStart: '2026-09-01',
      performancePeriodEnd: '2026-09-29',
      totalVatCents: 0,
      totalGrossCents: fixture.totalNetCents,
      vatBreakdown: [],
      lines: fixture.lines.map((line) => ({
        ...line, vatRateBasisPoints: null, vatCents: 0, grossCents: line.netCents,
      })),
    });
    expect(text).toContain(reverseChargeConstructionLabel);
    expect(text).toContain(reverseChargeConstructionLegalBasis);
    expect(text).toContain('Laskutusjakso');
    expect(text).toContain('01.09.2026\u201329.09.2026');
    expect(text).toContain('Ostajan Y-tunnus');
    expect(text).toContain('1234567-8');
    expect(text).not.toContain('ALV-erittely');
    expect(text).not.toContain('ALV %');
    expect(text).not.toContain('Alv yhteensä');
    expect(text).not.toContain('0,00 %');
  });

  it('keeps the existing customer fallback when no separate recipient is selected', async () => {
    const fixture = createInvoiceRevisionPdfContentFixture();
    const { text } = await renderRevision({ ...fixture, billingRecipientCustomerId: null });
    expect(text).toContain('Example Customer Oy');
    expect(text).toContain('Test Customer Street 1');
    expect(text).toContain('customer@example.invalid');
    expect(text).not.toContain('Example Recipient Oy');
    expect(text).not.toContain('Test Recipient Street 3');
  });

  it('stops the mapper-to-renderer test path for preserved legacy history', async () => {
    const textSpy = vi.spyOn(PDFDocument.prototype, 'text');
    try {
      const revision: InvoiceContentRevision = {
        ...createInvoiceRevisionPdfContentFixture(),
        origin: 'legacySnapshot', vatBreakdownState: 'unavailable', vatBreakdown: null,
      };
      await expect(renderRevision(revision))
        .rejects.toThrow(new InvoiceRevisionPdfContentUnavailableError());
      expect(textSpy).not.toHaveBeenCalled();
    } finally {
      textSpy.mockRestore();
    }
  });
});

async function renderRevision(revision: InvoiceContentRevision): Promise<{ text: string[] }> {
  const content = toInvoiceRevisionPdfContent(revision);
  const before = structuredClone(content);
  const textSpy = vi.spyOn(PDFDocument.prototype, 'text');
  try {
    const pdf = await renderApprovedInvoicePdf(content);
    expect(pdf).toBeInstanceOf(Uint8Array);
    expect(pdf.length).toBeGreaterThan(1000);
    expect(Buffer.from(pdf.subarray(0, 5)).toString('ascii')).toBe('%PDF-');
    expect(Buffer.from(pdf.subarray(-20)).toString('ascii')).toContain('%%EOF');
    expect(content).toStrictEqual(before);
    return { text: textSpy.mock.calls.map(([value]) => String(value)) };
  } finally {
    textSpy.mockRestore();
  }
}
