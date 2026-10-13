import type { InvoiceContentRevision } from '../domain/invoiceContentRevision.js';
import { fromInvoicePerformancePeriodColumns } from '../domain/invoicePerformancePeriod.js';
import { getInvoiceTaxTreatmentSnapshot } from '../domain/invoiceTaxTreatment.js';
import {
  addInvoiceRevisionVatGroup,
  validateInvoiceRevisionHeaderFacts,
  validateInvoiceRevisionLineFacts,
  validateInvoiceRevisionTotals,
} from './invoiceRevisionConsistency.js';

// Validate stored consistency, without recalculating or repairing historical data.
export function validateInvoiceContentRevision(revision: InvoiceContentRevision): void {
  let performancePeriodValid = true;
  try {
    fromInvoicePerformancePeriodColumns(revision);
  } catch {
    performancePeriodValid = false;
  }
  const tax = getInvoiceTaxTreatmentSnapshot(revision.taxTreatment);
  validateInvoiceRevisionHeaderFacts({
    invoiceKind: revision.invoiceKind,
    taxTreatment: revision.taxTreatment,
    priceInputMode: revision.priceInputMode,
    totalNetCents: revision.totalNetCents,
    totalVatCents: revision.totalVatCents,
    totalGrossCents: revision.totalGrossCents,
    creditSourcePresent: [
      revision.creditedInvoiceId !== null, revision.creditedRevisionId !== null,
      revision.creditedInvoiceNumberSnapshot !== null, revision.creditedInvoiceDateSnapshot !== null,
    ],
    creditedInvoiceIsSelf: revision.creditedInvoiceId === revision.invoiceId,
    referenceNumberPresent: revision.referenceNumber !== null,
    referenceNumberTypePresent: revision.referenceNumberType !== null,
    performancePeriodValid,
    taxSnapshotMatches: revision.taxTreatmentLabelSnapshot === tax.label && revision.taxLegalBasisSnapshot === tax.legalBasis,
  });

  const ids = new Set<string>();
  const orders = new Set<number>();
  for (const line of revision.lines) {
    validateInvoiceRevisionLineFacts(revision, {
      vatRateBasisPoints: line.vatRateBasisPoints,
      netCents: line.netCents,
      vatCents: line.vatCents,
      grossCents: line.grossCents,
      invoiceMatches: line.invoiceId === revision.invoiceId,
      duplicateLineId: ids.has(line.lineId),
      duplicateLineOrder: orders.has(line.lineOrder),
      trimmedUnitLength: line.unit.trim().length,
      sourceLinePresent: line.sourceInvoiceLineId !== null,
      sourceRevisionPresent: line.sourceRevisionId !== null,
      sourceRevisionMatchesCredit: line.sourceRevisionId === revision.creditedRevisionId,
    });
    ids.add(line.lineId);
    orders.add(line.lineOrder);
  }

  // Do not visit legacy VAT data or allocate its unused rate sets.
  if (revision.vatBreakdownState === 'unavailable') return;
  const vatTotals = { netCents: 0n, vatCents: 0n, grossCents: 0n };
  if (revision.taxTreatment === 'reverseChargeConstruction') {
    validateInvoiceRevisionTotals(revision, {
      hasLines: revision.lines.length > 0,
      hasVatGroups: revision.vatBreakdown.length > 0,
      vatRatesMatch: false,
      vatTotals,
    });
    return;
  }
  const rates = new Set<number>();
  for (const group of revision.vatBreakdown) {
    addInvoiceRevisionVatGroup(vatTotals, group, rates.has(group.vatRateBasisPoints));
    rates.add(group.vatRateBasisPoints);
  }
  const lineRates = new Set(revision.lines.map((line) => line.vatRateBasisPoints));
  validateInvoiceRevisionTotals(revision, {
    hasLines: revision.lines.length > 0,
    hasVatGroups: rates.size > 0,
    vatRatesMatch: rates.size === lineRates.size && [...rates].every((rate) => lineRates.has(rate)),
    vatTotals,
  });
}
