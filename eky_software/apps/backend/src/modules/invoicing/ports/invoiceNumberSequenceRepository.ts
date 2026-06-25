import type { InvoiceNumberSequenceState } from '../domain/invoiceNumbering.js';

export interface InvoiceNumberSequenceRepository {
  getSequence(
    companyId: string,
    seriesKey: string,
    sequenceScope: string,
  ): Promise<InvoiceNumberSequenceState | undefined>;
  saveSequence(
    sequence: InvoiceNumberSequenceState,
  ): Promise<InvoiceNumberSequenceState>;
}
