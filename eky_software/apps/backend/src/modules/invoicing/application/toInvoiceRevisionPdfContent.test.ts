import { describe, expect, it, vi } from 'vitest';

import * as creditCalculation from '../domain/calculateCreditInvoiceDraft.js';
import * as lineCalculation from '../domain/calculateInvoiceLine.js';
import * as totalCalculation from '../domain/calculateInvoiceTotals.js';
import * as reverseChargeCalculation from '../domain/calculateReverseChargeInvoice.js';
import type { InvoiceContentRevision } from '../domain/invoiceContentRevision.js';
import { InvoiceDraftValidationError } from '../domain/invoiceDraftValidationError.js';
import {
  reverseChargeConstructionLabel,
  reverseChargeConstructionLegalBasis,
} from '../domain/invoiceTaxTreatment.js';
import { InvoiceContentRevisionIntegrityError } from './invoiceContentRevisionIntegrityError.js';
import {
  createCreditRevisionPdfContentFixture,
  createInvoiceRevisionPdfContentFixture,
} from './toInvoiceRevisionPdfContent.fixture.js';
import {
  InvoiceRevisionPdfContentUnavailableError,
  toInvoiceRevisionPdfContent,
} from './toInvoiceRevisionPdfContent.js';

describe('toInvoiceRevisionPdfContent', () => {
  it('exact: maps only the explicit rendering contract from the snapshot', () => {
    expect(toInvoiceRevisionPdfContent(createInvoiceRevisionPdfContentFixture()))
      .toStrictEqual({
        invoiceKind: 'standard',
        creditedInvoiceNumber: null,
        creditedInvoiceDate: null,
        invoiceNumber: '20261001',
        referenceNumber: '202610010',
        customerNumberSnapshot: 'C-001',
        customerNameSnapshot: 'Example Customer Oy',
        customerBusinessIdSnapshot: '1234567-8',
        customerEmailSnapshot: 'customer@example.invalid',
        customerPhoneSnapshot: '010 000 0001',
        customerStreetAddressSnapshot: 'Test Customer Street 1',
        customerPostalCodeSnapshot: '00100',
        customerCitySnapshot: 'Test Customer City',
        companyNameSnapshot: 'Example Seller Oy',
        companyBusinessIdSnapshot: '2345678-9',
        companyVatNumberSnapshot: 'FI23456789',
        companyStreetAddressSnapshot: 'Test Seller Street 2',
        companyPostalCodeSnapshot: '00200',
        companyCitySnapshot: 'Test Seller City',
        companyEmailSnapshot: 'seller@example.invalid',
        companyPhoneSnapshot: '010 000 0002',
        companyWebsiteSnapshot: 'https://seller.example.invalid',
        companyIbanSnapshot: 'FI2112345600000785',
        companyBicSnapshot: 'NDEAFIHH',
        companyBankNameSnapshot: 'Example Bank',
        billingRecipientCustomerId: 'synthetic-recipient',
        billingRecipientCustomerNumberSnapshot: 'R-003',
        billingRecipientNameSnapshot: 'Example Recipient Oy',
        billingRecipientBusinessIdSnapshot: '3456789-0',
        billingRecipientEmailSnapshot: 'recipient@example.invalid',
        billingRecipientPhoneSnapshot: '010 000 0003',
        billingRecipientStreetAddressSnapshot: 'Test Recipient Street 3',
        billingRecipientPostalCodeSnapshot: '00300',
        billingRecipientCitySnapshot: 'Test Recipient City',
        invoiceDate: '2026-10-01',
        dueDate: '2026-10-20',
        paymentTermDays: 14,
        reminderPeriodDays: 7,
        latePaymentInterestBasisPoints: 950,
        priceInputMode: 'net',
        taxTreatment: 'normalVat',
        taxTreatmentLabelSnapshot: '',
        taxLegalBasisSnapshot: '',
        performancePeriod: { type: 'singleDate', date: '2026-09-29' },
        orderNumber: 'ORDER-004',
        note: '  Snapshot note\nSecond line  ',
        deliveryAddressText: 'Test Site 5',
        refundIbanSnapshot: '',
        lines: [
          {
            code: 'ITEM-1', description: 'Example item 1', quantityHundredths: 100,
            unit: 'kpl', unitPriceCents: 2, vatRateBasisPoints: 2550,
            discount: { type: 'none' }, netCents: 2, grossCents: 3,
          },
          {
            code: 'ITEM-2', description: 'Example item 2', quantityHundredths: 100,
            unit: 'h', unitPriceCents: 2, vatRateBasisPoints: 2550,
            discount: { type: 'percentage', basisPoints: 1000 }, netCents: 2, grossCents: 3,
          },
          {
            code: 'ITEM-3', description: 'Example item 3', quantityHundredths: 100,
            unit: 'pak', unitPriceCents: 105, vatRateBasisPoints: 1350,
            discount: { type: 'fixed', amountCents: 5 }, netCents: 100, grossCents: 114,
          },
        ],
        totals: { netTotalCents: 104, vatTotalCents: 15, grossTotalCents: 119 },
        vatBreakdown: [
          { vatRateBasisPoints: 1350, netCents: 100, vatCents: 14, grossCents: 114 },
          { vatRateBasisPoints: 2550, netCents: 4, vatCents: 1, grossCents: 5 },
        ],
      });
  });

  it('snapshot: ignores extra live state, join values and future internal fields', () => {
    const revision = createCreditRevisionPdfContentFixture();
    const expected = toInvoiceRevisionPdfContent(revision);
    Object.assign(revision, {
      status: 'cancelled', updatedAt: '2099-01-01', paymentState: 'paid',
      paidOn: '2099-01-01', paidAmountCents: 999999, paymentSource: 'manual',
      cancelledAt: '2099-01-01', cancelledBy: 'other-actor', cancellationReason: 'other',
      creditedInvoiceNumber: 'LIVE-NUMBER', creditedInvoiceDate: '2099-01-01',
      internalOnly: 'must not enter PDF input',
    });
    for (const line of revision.lines) Object.assign(line, { internalOnly: 'line metadata' });
    for (const group of revision.vatBreakdown) Object.assign(group, { internalOnly: 'VAT metadata' });

    expect(toInvoiceRevisionPdfContent(revision)).toStrictEqual(expected);
    expect(expected.creditedInvoiceNumber).toBe('20260991');
    expect(expected.creditedInvoiceDate).toBe('2026-09-01');
    expect(expected.referenceNumber).toBe('');
  });

  it('snapshot: preserves a null recipient selector and empty snapshot text', () => {
    const revision = {
      ...createInvoiceRevisionPdfContentFixture(),
      billingRecipientCustomerId: null,
      billingRecipientNameSnapshot: '',
      customerEmailSnapshot: '',
    };
    const content = toInvoiceRevisionPdfContent(revision);
    expect(content.billingRecipientCustomerId).toBeNull();
    expect(content.billingRecipientNameSnapshot).toBe('');
    expect(content.customerEmailSnapshot).toBe('');
    expect(content.customerNameSnapshot).toBe('Example Customer Oy');
  });

  it.each(['approval', 'validatedLegacySnapshot'] as const)(
    'no-recalc: keeps authoritative %s totals distinct from rounded line sums',
    (origin) => {
      const revision = { ...createInvoiceRevisionPdfContentFixture(), origin };
      const content = toInvoiceRevisionPdfContent(revision);
      expect(revision.lines.reduce((sum, line) => sum + line.vatCents, 0)).toBe(16);
      expect(content.totals.vatTotalCents).toBe(15);
      expect(content.totals.grossTotalCents).toBe(119);
      expect(content.vatBreakdown).toStrictEqual(revision.vatBreakdown);
    },
  );

  it('no-recalc: preserves gross-mode totals and input order', () => {
    const fixture = createInvoiceRevisionPdfContentFixture();
    const revision = {
      ...fixture,
      priceInputMode: 'gross' as const,
      lines: fixture.lines.map((line) => ({
        ...line, unitPriceCents: 2, vatRateBasisPoints: 2550,
        discountType: 'none' as const, discountValue: 0,
        baseCents: 2, discountCents: 0, netCents: 2, vatCents: 0, grossCents: 2,
      })).reverse(),
      totalNetCents: 5, totalVatCents: 1, totalGrossCents: 6,
      vatBreakdown: [
        { vatRateBasisPoints: 2550, netCents: 5, vatCents: 1, grossCents: 6 },
      ],
    };
    const content = toInvoiceRevisionPdfContent(revision);
    expect(content.priceInputMode).toBe('gross');
    expect(content.lines.map((line) => line.code)).toEqual(['ITEM-3', 'ITEM-2', 'ITEM-1']);
    expect(content.lines.map((line) => line.netCents)).toEqual([2, 2, 2]);
    expect(content.totals).toEqual({ netTotalCents: 5, vatTotalCents: 1, grossTotalCents: 6 });
    expect(content.vatBreakdown).toStrictEqual(revision.vatBreakdown);
  });

  it('no-recalc: never invokes line, standard, credit or reverse charge calculators', () => {
    const calculators = [
      vi.spyOn(lineCalculation, 'calculateInvoiceLine'),
      vi.spyOn(totalCalculation, 'calculateInvoiceTotals'),
      vi.spyOn(creditCalculation, 'sumCreditTotals'),
      vi.spyOn(reverseChargeCalculation, 'calculateReverseChargeInvoice'),
    ];
    try {
      for (const calculator of calculators) {
        calculator.mockImplementation(() => {
          throw new Error('Rendering must not recalculate stored amounts.');
        });
      }
      toInvoiceRevisionPdfContent(createInvoiceRevisionPdfContentFixture());
      toInvoiceRevisionPdfContent(createCreditRevisionPdfContentFixture());
      for (const calculator of calculators) expect(calculator).not.toHaveBeenCalled();
    } finally {
      for (const calculator of calculators) calculator.mockRestore();
    }
  });

  it.each([
    { mode: 'net', net: 67, vat: 18, gross: 85 },
    { mode: 'net', net: 67, vat: 16, gross: 83 },
    { mode: 'gross', net: 54, vat: 13, gross: 67 },
    { mode: 'gross', net: 52, vat: 15, gross: 67 },
  ] as const)('credit-rounding: preserves allocated $mode cents $net/$vat/$gross', (values) => {
    const fixture = createCreditRevisionPdfContentFixture();
    const inputCents = values.mode === 'net' ? values.net : values.gross;
    const revision = {
      ...fixture,
      priceInputMode: values.mode,
      lines: fixture.lines.map((line) => ({
        ...line, unitPriceCents: inputCents, baseCents: inputCents,
        netCents: values.net, vatCents: values.vat, grossCents: values.gross,
      })),
      totalNetCents: values.net, totalVatCents: values.vat, totalGrossCents: values.gross,
      vatBreakdown: [{
        vatRateBasisPoints: 2550, netCents: values.net,
        vatCents: values.vat, grossCents: values.gross,
      }],
    };
    const content = toInvoiceRevisionPdfContent(revision);
    expect(content.totals).toEqual({
      netTotalCents: values.net, vatTotalCents: values.vat, grossTotalCents: values.gross,
    });
    expect(content.vatBreakdown).toStrictEqual(revision.vatBreakdown);
    expect(content.lines[0]).toMatchObject({ netCents: values.net, grossCents: values.gross });
    expect(content.invoiceKind).toBe('credit');
  });

  it('reverse: preserves null VAT rates and a known empty authoritative breakdown', () => {
    const fixture = createInvoiceRevisionPdfContentFixture();
    const content = toInvoiceRevisionPdfContent({
      ...fixture,
      taxTreatment: 'reverseChargeConstruction',
      taxTreatmentLabelSnapshot: reverseChargeConstructionLabel,
      taxLegalBasisSnapshot: reverseChargeConstructionLegalBasis,
      lines: fixture.lines.map((line) => ({
        ...line, vatRateBasisPoints: null, vatCents: 0, grossCents: line.netCents,
      })),
      totalVatCents: 0, totalGrossCents: fixture.totalNetCents,
      vatBreakdown: [],
    });
    expect(content.taxTreatment).toBe('reverseChargeConstruction');
    expect(content.taxTreatmentLabelSnapshot).toBe(reverseChargeConstructionLabel);
    expect(content.taxLegalBasisSnapshot).toBe(reverseChargeConstructionLegalBasis);
    expect(content.lines.map((line) => line.vatRateBasisPoints)).toEqual([null, null, null]);
    expect(content.vatBreakdown).toEqual([]);
    expect(content.totals).toEqual({ netTotalCents: 104, vatTotalCents: 0, grossTotalCents: 104 });
  });

  it.each(['normalVat', 'reverseChargeConstruction'] as const)(
    'legacy-denial: rejects unavailable %s rather than manufacturing an empty breakdown',
    (taxTreatment) => {
      const fixture = createInvoiceRevisionPdfContentFixture();
      const isReverseCharge = taxTreatment === 'reverseChargeConstruction';
      const revision: InvoiceContentRevision = {
        ...fixture, taxTreatment,
        taxTreatmentLabelSnapshot: isReverseCharge ? reverseChargeConstructionLabel : '',
        taxLegalBasisSnapshot: isReverseCharge ? reverseChargeConstructionLegalBasis : '',
        totalVatCents: isReverseCharge ? 0 : fixture.totalVatCents,
        totalGrossCents: isReverseCharge ? fixture.totalNetCents : fixture.totalGrossCents,
        lines: isReverseCharge ? fixture.lines.map((line) => ({
          ...line, vatRateBasisPoints: null, vatCents: 0, grossCents: line.netCents,
        })) : fixture.lines,
        origin: 'legacySnapshot', vatBreakdownState: 'unavailable', vatBreakdown: null,
      };
      const before = structuredClone(revision);
      expect(() => toInvoiceRevisionPdfContent(revision))
        .toThrow(new InvoiceRevisionPdfContentUnavailableError());
      expect(() => toInvoiceRevisionPdfContent(revision))
        .not.toThrow(InvoiceContentRevisionIntegrityError);
      expect(revision).toStrictEqual(before);
    },
  );

  it.each([
    { origin: 'legacySnapshot' },
    { origin: 'unknown' },
    { vatBreakdownState: 'unavailable' },
    { vatBreakdown: null },
  ])('legacy-denial: rejects an inconsistent runtime source variant %j', (overrides) => {
    const revision = {
      ...createInvoiceRevisionPdfContentFixture(), ...overrides,
    } as unknown as InvoiceContentRevision;
    expect(() => toInvoiceRevisionPdfContent(revision))
      .toThrow(new InvoiceContentRevisionIntegrityError());
  });

  it.each([
    {
      performanceDate: null, performancePeriodStart: null, performancePeriodEnd: null,
      expected: { type: 'invoiceDate' },
    },
    {
      performanceDate: '2026-09-29', performancePeriodStart: null, performancePeriodEnd: null,
      expected: { type: 'singleDate', date: '2026-09-29' },
    },
    {
      performanceDate: null, performancePeriodStart: '2026-09-01', performancePeriodEnd: '2026-09-29',
      expected: { type: 'dateRange', startDate: '2026-09-01', endDate: '2026-09-29' },
    },
  ])('snapshot: uses the domain performance mapping for $expected.type', ({ expected, ...columns }) => {
    const content = toInvoiceRevisionPdfContent({
      ...createInvoiceRevisionPdfContentFixture(), ...columns,
    });
    expect(content.performancePeriod).toStrictEqual(expected);
  });

  it('snapshot: does not turn an incomplete performance range into a default', () => {
    expect(() => toInvoiceRevisionPdfContent({
      ...createInvoiceRevisionPdfContentFixture(),
      performanceDate: null, performancePeriodStart: '2026-09-01', performancePeriodEnd: null,
    })).toThrow(InvoiceDraftValidationError);
  });

  it('mutation-isolation: leaves frozen input intact and allocates every output object', () => {
    const revision = createInvoiceRevisionPdfContentFixture();
    const before = structuredClone(revision);
    revision.lines.forEach(Object.freeze);
    revision.vatBreakdown.forEach(Object.freeze);
    Object.freeze(revision.lines);
    Object.freeze(revision.vatBreakdown);
    Object.freeze(revision);

    const first = toInvoiceRevisionPdfContent(revision);
    const second = toInvoiceRevisionPdfContent(revision);
    expect(first.lines).not.toBe(revision.lines);
    expect(first.vatBreakdown).not.toBe(revision.vatBreakdown);
    expect(first.vatBreakdown[0]).not.toBe(revision.vatBreakdown[0]);
    expect(first.lines[0]).not.toBe(revision.lines[0]);
    expect(first.lines[1]?.discount).not.toBe(second.lines[1]?.discount);
    Object.assign(first, { companyNameSnapshot: 'Changed' });
    Object.assign(first.lines[0]!, { description: 'Changed', grossCents: 999 });
    Object.assign(first.lines[1]!.discount, { basisPoints: 999 });
    Object.assign(first.vatBreakdown[0]!, { vatCents: 999 });
    Object.assign(first.totals, { vatTotalCents: 999 });
    Object.assign(first.performancePeriod, { date: '2099-01-01' });

    expect(revision).toStrictEqual(before);
    expect(second).toStrictEqual(toInvoiceRevisionPdfContent(before));
  });

  it('mutation-isolation: later source changes cannot change already mapped content', () => {
    const revision = createInvoiceRevisionPdfContentFixture();
    const content = toInvoiceRevisionPdfContent(revision);
    const before = structuredClone(content);
    Object.assign(revision, { invoiceNumber: 'other', performanceDate: '2099-01-01' });
    Object.assign(revision.lines[0]!, { code: 'other', netCents: 999, discountValue: 999 });
    Object.assign(revision.vatBreakdown[0]!, { netCents: 999 });
    expect(content).toStrictEqual(before);
  });
});
