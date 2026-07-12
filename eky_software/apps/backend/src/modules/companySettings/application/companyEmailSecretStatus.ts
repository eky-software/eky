export interface CompanyEmailSecretStatus {
  readonly configured: boolean;
}

export function createCompanyEmailSecretStatus(
  configured: boolean,
): CompanyEmailSecretStatus {
  return Object.freeze({ configured });
}
