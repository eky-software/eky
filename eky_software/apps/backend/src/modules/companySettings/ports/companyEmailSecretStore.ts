export interface SetCompanyEmailSecretInput {
  companyId: string;
  secret: string;
}

// Company Settings only manages the secret lifecycle and cannot read it back.
export interface CompanyEmailSecretStore {
  hasSecret(companyId: string): Promise<boolean>;
  removeSecret(companyId: string): Promise<void>;
  setSecret(input: SetCompanyEmailSecretInput): Promise<void>;
}
