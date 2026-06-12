export interface CustomerAccessReader {
  belongsToCompany(customerId: string, companyId: string): Promise<boolean>;
}
