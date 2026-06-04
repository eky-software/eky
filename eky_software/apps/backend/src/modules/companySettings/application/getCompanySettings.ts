import {
  createEmptyCompanySettings,
  type CompanySettings,
} from '../domain/companySettings.js';
import type { CompanySettingsRepository } from '../ports/companySettingsRepository.js';

export interface GetCompanySettingsInput {
  companyId: string;
}

export async function getCompanySettings(
  input: GetCompanySettingsInput,
  companySettingsRepository: CompanySettingsRepository,
): Promise<CompanySettings> {
  const settings = await companySettingsRepository.findByCompanyId(input.companyId);

  return settings ?? createEmptyCompanySettings(input.companyId);
}
