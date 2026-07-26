import { randomUUID } from 'node:crypto';

import type { CompanySettings } from './companySettings.js';

export type CompanySettingsChangedFieldCategory =
  | 'address'
  | 'banking'
  | 'contact'
  | 'emailConfiguration'
  | 'identity'
  | 'invoicingDefaults';

export interface CompanySettingsAuditEvent {
  action: 'companySettings.updated';
  actorUserId: string;
  changedFieldCategories: readonly CompanySettingsChangedFieldCategory[];
  companyId: string;
  id: string;
  occurredAt: string;
  outcome: 'success';
}

export function createCompanySettingsAuditEvent(input: {
  actorUserId: string;
  current: CompanySettings | null;
  updated: CompanySettings;
}): CompanySettingsAuditEvent {
  return Object.freeze({
    action: 'companySettings.updated',
    actorUserId: input.actorUserId,
    changedFieldCategories: Object.freeze(
      getChangedCategories(input.current, input.updated),
    ),
    companyId: input.updated.companyId,
    id: randomUUID(),
    occurredAt: input.updated.updatedAt,
    outcome: 'success',
  });
}

function getChangedCategories(
  current: CompanySettings | null,
  updated: CompanySettings,
): CompanySettingsChangedFieldCategory[] {
  if (current === null) {
    return [
      'identity',
      'address',
      'contact',
      'banking',
      'invoicingDefaults',
      'emailConfiguration',
    ];
  }

  const categories: CompanySettingsChangedFieldCategory[] = [];
  if (
    current.businessId !== updated.businessId ||
    current.companyName !== updated.companyName ||
    current.vatNumber !== updated.vatNumber
  ) {
    categories.push('identity');
  }
  if (
    current.city !== updated.city ||
    current.postalCode !== updated.postalCode ||
    current.streetAddress !== updated.streetAddress
  ) {
    categories.push('address');
  }
  if (
    current.email !== updated.email ||
    current.phone !== updated.phone ||
    current.website !== updated.website
  ) {
    categories.push('contact');
  }
  if (
    current.bankName !== updated.bankName ||
    current.bic !== updated.bic ||
    current.iban !== updated.iban
  ) {
    categories.push('banking');
  }
  if (
    current.defaultHourlyRateCents !== updated.defaultHourlyRateCents ||
    current.hourlyRateShortcut !== updated.hourlyRateShortcut
  ) {
    categories.push('invoicingDefaults');
  }
  if (
    current.emailDeliveryProvider !== updated.emailDeliveryProvider ||
    current.emailSenderAddress !== updated.emailSenderAddress ||
    current.emailSenderName !== updated.emailSenderName ||
    current.emailTestRecipientOverride !==
      updated.emailTestRecipientOverride ||
    current.emailUsername !== updated.emailUsername
  ) {
    categories.push('emailConfiguration');
  }

  return categories;
}
