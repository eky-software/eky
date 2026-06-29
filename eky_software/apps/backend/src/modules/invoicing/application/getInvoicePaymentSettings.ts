import {
  validateInvoicePaymentSettings,
} from '../domain/invoicePaymentSettings.js';
import type {
  InvoicePaymentSettingsRepository,
} from '../ports/invoicePaymentSettingsRepository.js';
import {
  toInvoicePaymentSettingsView,
  type InvoicePaymentSettingsView,
} from './invoicePaymentSettingsView.js';
import { InvoicePaymentSettingsApplicationError } from './invoicePaymentSettingsError.js';

export interface GetInvoicePaymentSettingsInput {
  companyId: string;
}

function requireCompanyId(companyId: string): string {
  const normalizedCompanyId = companyId.trim();

  if (normalizedCompanyId.length === 0) {
    throw new InvoicePaymentSettingsApplicationError('Company id is required.');
  }

  return normalizedCompanyId;
}

export async function getInvoicePaymentSettings(
  input: GetInvoicePaymentSettingsInput,
  invoicePaymentSettingsRepository: InvoicePaymentSettingsRepository,
): Promise<InvoicePaymentSettingsView> {
  const companyId = requireCompanyId(input.companyId);
  const settings = await invoicePaymentSettingsRepository.getSettings(companyId);

  if (settings !== undefined) {
    validateInvoicePaymentSettings(settings);
  }

  return toInvoicePaymentSettingsView(settings);
}
