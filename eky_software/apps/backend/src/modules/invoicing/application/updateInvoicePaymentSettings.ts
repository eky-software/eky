import type { ActorContext } from '@eky/auth';
import { requirePermission } from '@eky/permissions';

import {
  validateInvoicePaymentSettings,
  type InvoicePaymentSettings,
  type StoredInvoicePaymentSettings,
} from '../domain/invoicePaymentSettings.js';
import { createInvoiceSettingsAuditEvent } from '../domain/invoiceSettingsAuditEvent.js';
import type {
  InvoicePaymentSettingsRepository,
} from '../ports/invoicePaymentSettingsRepository.js';
import { InvoicePaymentSettingsApplicationError } from './invoicePaymentSettingsError.js';
import {
  toInvoicePaymentSettingsView,
  type InvoicePaymentSettingsView,
} from './invoicePaymentSettingsView.js';

export interface UpdateInvoicePaymentSettingsInput {
  actorContext: ActorContext;
  defaultLatePaymentInterestBasisPoints: number;
  defaultReminderPeriodDays: number;
  now: string;
}

function requireNonEmptyValue(value: string, fieldName: string): string {
  const normalizedValue = value.trim();

  if (normalizedValue.length === 0) {
    throw new InvoicePaymentSettingsApplicationError(`${fieldName} is required.`);
  }

  return normalizedValue;
}

function toPaymentSettings(
  input: UpdateInvoicePaymentSettingsInput,
): InvoicePaymentSettings {
  return {
    defaultLatePaymentInterestBasisPoints:
      input.defaultLatePaymentInterestBasisPoints,
    defaultReminderPeriodDays: input.defaultReminderPeriodDays,
  };
}

function createStoredSettings(
  input: UpdateInvoicePaymentSettingsInput,
  companyId: string,
  currentSettings: StoredInvoicePaymentSettings | undefined,
): StoredInvoicePaymentSettings {
  return {
    companyId,
    ...toPaymentSettings(input),
    createdAt: currentSettings?.createdAt ?? requireNonEmptyValue(input.now, 'Timestamp'),
    updatedAt: requireNonEmptyValue(input.now, 'Timestamp'),
  };
}

export async function updateInvoicePaymentSettings(
  input: UpdateInvoicePaymentSettingsInput,
  invoicePaymentSettingsRepository: InvoicePaymentSettingsRepository,
): Promise<InvoicePaymentSettingsView> {
  requirePermission(input.actorContext, 'manageInvoiceSettings');
  const companyId = requireNonEmptyValue(
    input.actorContext.companyId,
    'Company id',
  );
  const now = requireNonEmptyValue(input.now, 'Timestamp');
  const nextSettings = toPaymentSettings(input);

  validateInvoicePaymentSettings(nextSettings);

  const currentSettings = await invoicePaymentSettingsRepository.getSettings(companyId);

  if (currentSettings !== undefined) {
    validateInvoicePaymentSettings(currentSettings);
  }

  const savedSettings = await invoicePaymentSettingsRepository.saveSettings(
    createStoredSettings(input, companyId, currentSettings),
    createInvoiceSettingsAuditEvent({
      action: 'invoicePaymentSettings.updated',
      actorUserId: input.actorContext.actorId,
      companyId,
      occurredAt: now,
    }),
  );

  validateInvoicePaymentSettings(savedSettings);

  return toInvoicePaymentSettingsView(savedSettings);
}
