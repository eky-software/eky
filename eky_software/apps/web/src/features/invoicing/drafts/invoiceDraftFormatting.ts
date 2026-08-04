import type { InvoiceDraftStatus } from '@eky/api-client';

import { uiText } from '../../../i18n/fi.js';
import { formatFinnishCalendarDate } from '../../../shared/date/formatFinnishCalendarDate.js';
import { formatEuroCents } from '../../../shared/money/formatEuroCents.js';

export function formatInvoiceDraftCurrency(cents: number): string {
  return formatEuroCents(cents);
}

export function formatInvoiceDraftDate(date: string): string {
  return formatFinnishCalendarDate(date) ?? date;
}

export function getInvoiceDraftSubject(subject: string): string {
  return subject.trim() || uiText.invoicing.subjectFallback;
}

export function getInvoiceDraftStatusLabel(status: InvoiceDraftStatus): string {
  switch (status) {
    case 'draft':
      return uiText.invoicing.statusDraft;
  }
}
