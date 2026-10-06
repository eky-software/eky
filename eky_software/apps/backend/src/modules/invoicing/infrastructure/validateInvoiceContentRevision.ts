import { InvoiceContentRevisionIntegrityError } from '../application/invoiceContentRevisionIntegrityError.js';
import type { InvoiceContentRevision } from '../domain/invoiceContentRevision.js';
import { fromInvoicePerformancePeriodColumns } from '../domain/invoicePerformancePeriod.js';
import { getInvoiceTaxTreatmentSnapshot } from '../domain/invoiceTaxTreatment.js';

// Validate stored consistency, without recalculating or repairing historical data.
export function validateInvoiceContentRevision(revision: InvoiceContentRevision): void {
  const source = [
    revision.creditedInvoiceId, revision.creditedRevisionId,
    revision.creditedInvoiceNumberSnapshot, revision.creditedInvoiceDateSnapshot,
  ];
  if (revision.invoiceKind === 'standard') {
    if (source.some((value) => value !== null)) fail();
  } else if (source.some((value) => value === null) || revision.creditedInvoiceId === revision.invoiceId) {
    fail();
  }
  if ((revision.referenceNumber === null) !== (revision.referenceNumberType === null)) fail();
  try {
    fromInvoicePerformancePeriodColumns(revision);
  } catch {
    fail();
  }
  const tax = getInvoiceTaxTreatmentSnapshot(revision.taxTreatment);
  if (revision.taxTreatmentLabelSnapshot !== tax.label || revision.taxLegalBasisSnapshot !== tax.legalBasis) {
    fail();
  }
  if (revision.taxTreatment === 'reverseChargeConstruction' && (
    revision.priceInputMode !== 'net' || revision.totalVatCents !== 0 ||
    revision.totalNetCents !== revision.totalGrossCents
  )) fail();

  const ids = new Set<string>();
  const orders = new Set<number>();
  for (const line of revision.lines) {
    if (line.invoiceId !== revision.invoiceId || ids.has(line.lineId) || orders.has(line.lineOrder)) {
      fail();
    }
    ids.add(line.lineId);
    orders.add(line.lineOrder);
    if (line.unit.trim().length > 8) fail();
    if ((line.sourceInvoiceLineId === null) !== (line.sourceRevisionId === null)) fail();
    if (line.sourceRevisionId !== null && (
      revision.invoiceKind !== 'credit' || line.sourceRevisionId !== revision.creditedRevisionId
    )) fail();
    if (revision.taxTreatment === 'normalVat') {
      if (line.vatRateBasisPoints === null) fail();
    } else if (line.vatRateBasisPoints !== null || line.vatCents !== 0 || line.netCents !== line.grossCents) {
      fail();
    }
    if (revision.origin !== 'legacySnapshot' &&
      BigInt(line.netCents) + BigInt(line.vatCents) !== BigInt(line.grossCents)) {
      fail();
    }
  }

  // Legacy totals may reflect an old calculation; availability is not a zero VAT value.
  if (revision.vatBreakdownState === 'unavailable') return;
  if (revision.lines.length === 0 ||
    BigInt(revision.totalNetCents) + BigInt(revision.totalVatCents) !== BigInt(revision.totalGrossCents)) {
    fail();
  }
  if (revision.taxTreatment === 'reverseChargeConstruction') {
    if (revision.vatBreakdown.length !== 0) fail();
    return;
  }
  const rates = new Set<number>();
  let net = 0n;
  let vat = 0n;
  let gross = 0n;
  for (const group of revision.vatBreakdown) {
    if (rates.has(group.vatRateBasisPoints) ||
      BigInt(group.netCents) + BigInt(group.vatCents) !== BigInt(group.grossCents)) {
      fail();
    }
    rates.add(group.vatRateBasisPoints);
    net += BigInt(group.netCents);
    vat += BigInt(group.vatCents);
    gross += BigInt(group.grossCents);
  }
  const lineRates = new Set(revision.lines.map((line) => line.vatRateBasisPoints));
  if (rates.size === 0 || rates.size !== lineRates.size ||
    [...rates].some((rate) => !lineRates.has(rate)) ||
    net !== BigInt(revision.totalNetCents) || vat !== BigInt(revision.totalVatCents) ||
    gross !== BigInt(revision.totalGrossCents)) {
    fail();
  }
}

function fail(): never {
  throw new InvoiceContentRevisionIntegrityError();
}
