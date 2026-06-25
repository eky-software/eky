import {
  defaultInvoiceNumberSeriesKey,
  validateInvoiceNumberingSettings,
} from '../domain/invoiceNumbering.js';
import type { InvoiceNumberingSettingsRepository } from '../ports/invoiceNumberingSettingsRepository.js';
import {
  toInvoiceNumberingSettingsView,
  type InvoiceNumberingSettingsView,
} from './invoiceNumberingSettingsView.js';
import { InvoiceNumberingSettingsError } from './invoiceNumberingSettingsError.js';

export interface GetInvoiceNumberingSettingsInput {
  companyId: string;
}

function requireCompanyId(companyId: string): string {
  const normalizedCompanyId = companyId.trim();

  if (normalizedCompanyId.length === 0) {
    throw new InvoiceNumberingSettingsError('Company id is required.');
  }

  return normalizedCompanyId;
}

export async function getInvoiceNumberingSettings(
  input: GetInvoiceNumberingSettingsInput,
  invoiceNumberingSettingsRepository: InvoiceNumberingSettingsRepository,
): Promise<InvoiceNumberingSettingsView> {
  const companyId = requireCompanyId(input.companyId);
  const settings = await invoiceNumberingSettingsRepository.getSettings(
    companyId,
    defaultInvoiceNumberSeriesKey,
  );
  const hasUsedNumbering =
    settings === undefined
      ? false
      : await invoiceNumberingSettingsRepository.hasUsedNumbering(
        companyId,
        defaultInvoiceNumberSeriesKey,
      );

  if (settings !== undefined) {
    validateInvoiceNumberingSettings(settings);
  }

  return toInvoiceNumberingSettingsView(settings, hasUsedNumbering);
}
