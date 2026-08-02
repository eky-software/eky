import type { InvoiceNumberingMode } from '../domain/invoiceNumbering.js';
import type { InvoiceNumberingSeriesOverview } from '../domain/invoiceNumberingSeries.js';

export interface InvoiceNumberingSeriesSettingsView {
  seriesKey: string;
  mode: InvoiceNumberingMode;
  fiscalYearStartMonth: number;
  sequencePadding: number;
  firstSequenceNumber: number;
  createdAt: string;
}

export interface InvoiceNumberingSeriesHistoryView {
  previousSeries: InvoiceNumberingSeriesSettingsView;
  replacedAt: string;
}

export interface InvoiceNumberingSeriesOverviewView {
  activeSeries: InvoiceNumberingSeriesSettingsView & {
    activatedAt: string;
  };
  history: InvoiceNumberingSeriesHistoryView[];
  revision: number;
}

export function toInvoiceNumberingSeriesOverviewView(
  overview: InvoiceNumberingSeriesOverview,
): InvoiceNumberingSeriesOverviewView {
  return {
    activeSeries: {
      ...toSettingsView(overview.activeSettings),
      activatedAt: overview.activeSeries.updatedAt,
    },
    history: overview.history.map((entry) => ({
      previousSeries: toSettingsView(entry.settings),
      replacedAt: entry.event.occurredAt,
    })),
    revision: overview.activeSeries.revision,
  };
}

function toSettingsView(
  settings: InvoiceNumberingSeriesOverview['activeSettings'],
): InvoiceNumberingSeriesSettingsView {
  return {
    seriesKey: settings.seriesKey,
    mode: settings.mode,
    fiscalYearStartMonth: settings.fiscalYearStartMonth,
    sequencePadding: settings.sequencePadding,
    firstSequenceNumber: settings.firstSequenceNumber,
    createdAt: settings.createdAt,
  };
}
