import type { StoredInvoiceNumberingSettings } from '../domain/invoiceNumbering.js';
import type {
  InvoiceNumberingSeriesCandidate,
  MinimumSafeInvoiceSequenceNumberResult,
} from '../domain/calculateMinimumSafeInvoiceSequenceNumber.js';
import type {
  InvoiceNumberingActiveSeries,
  InvoiceNumberingSeriesEvent,
  InvoiceNumberingSeriesOverview,
} from '../domain/invoiceNumberingSeries.js';

export interface ActivateInvoiceNumberingSeriesPersistenceInput {
  activeSeries: InvoiceNumberingActiveSeries;
  event: InvoiceNumberingSeriesEvent;
  expectedActiveSeriesKey: string;
  expectedRevision: number;
  nextSettings: StoredInvoiceNumberingSettings;
}

export type ActivateInvoiceNumberingSeriesPersistenceResult =
  | {
      outcome: 'activated';
      overview: InvoiceNumberingSeriesOverview;
    }
  | {
      outcome: 'conflict' | 'notFound' | 'unsafeFirstSequenceNumber';
    };

export interface InvoiceNumberingSeriesActivationPreviewCriteria {
  companyId: string;
  target: InvoiceNumberingSeriesCandidate;
}

export interface InvoiceNumberingSeriesRepository {
  getOverview(
    companyId: string,
  ): Promise<InvoiceNumberingSeriesOverview | undefined>;
  getActivationPreview(
    criteria: InvoiceNumberingSeriesActivationPreviewCriteria,
  ): Promise<MinimumSafeInvoiceSequenceNumberResult | undefined>;
  activate(
    input: ActivateInvoiceNumberingSeriesPersistenceInput,
  ): Promise<ActivateInvoiceNumberingSeriesPersistenceResult>;
}
