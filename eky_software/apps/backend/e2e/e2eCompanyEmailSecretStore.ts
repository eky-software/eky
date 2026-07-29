import type { CompanyEmailSecretReader } from '../src/modules/companySettings/ports/companyEmailSecretReader.js';
import type {
  CompanyEmailSecretStore,
  SetCompanyEmailSecretInput,
} from '../src/modules/companySettings/ports/companyEmailSecretStore.js';

export class E2eCompanyEmailSecretStore
  implements CompanyEmailSecretReader, CompanyEmailSecretStore
{
  #configuredCompanies = new Set<string>();

  async getSecret(companyId: string): Promise<string | null> {
    return this.#configuredCompanies.has(companyId)
      ? 'e2e-synthetic-secret'
      : null;
  }

  async hasSecret(companyId: string): Promise<boolean> {
    return this.#configuredCompanies.has(companyId);
  }

  async removeSecret(companyId: string): Promise<void> {
    this.#configuredCompanies.delete(companyId);
  }

  async setSecret(input: SetCompanyEmailSecretInput): Promise<void> {
    this.#configuredCompanies.add(input.companyId);
  }
}
