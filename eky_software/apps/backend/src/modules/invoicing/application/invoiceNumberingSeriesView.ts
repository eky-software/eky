import type { InvoiceNumberingMode } from '../domain/invoiceNumbering.js';
import {
  activateInvoiceNumberingSeriesConfirmation,
  type InvoiceNumberingSeriesOverview,
} from '../domain/invoiceNumberingSeries.js';

export interface InvoiceNumberingSeriesSettingsView {
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
  activationConfirmationText: string;
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
    activationConfirmationText: activateInvoiceNumberingSeriesConfirmation,
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
    mode: settings.mode,
    fiscalYearStartMonth: settings.fiscalYearStartMonth,
    sequencePadding: settings.sequencePadding,
    firstSequenceNumber: settings.firstSequenceNumber,
    createdAt: settings.createdAt,
  };
}
