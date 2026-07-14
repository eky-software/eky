// This backend-only port is reserved for an approved email delivery provider.
// Company Settings HTTP and UI code must never expose the returned secret.
export interface CompanyEmailSecretReader {
  getSecret(companyId: string): Promise<string | null>;
}
