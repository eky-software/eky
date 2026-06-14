import type { InvoiceDraftStatus } from '@eky/api-client';

import { uiText } from '../../i18n/fi.js';

const euroFormatter = new Intl.NumberFormat('fi-FI', {
  currency: 'EUR',
  style: 'currency',
});

export function formatInvoiceDraftCurrency(cents: number): string {
  return euroFormatter.format(cents / 100);
}

export function formatInvoiceDraftDate(date: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);

  if (!match) {
    return date;
  }

  return `${match[3]}.${match[2]}.${match[1]}`;
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
