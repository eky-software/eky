export const companyEmailSecretAuditActionValues = Object.freeze([
  'set',
  'remove',
] as const);

export type CompanyEmailSecretAuditAction =
  (typeof companyEmailSecretAuditActionValues)[number];

export interface CompanyEmailSecretAuditOperation {
  action: CompanyEmailSecretAuditAction;
  actorId: string;
  companyId: string;
  completedAt: null;
  failureCode: null;
  operationId: string;
  startedAt: string;
  status: 'pending';
}

export interface CompanyEmailSecretAuditCompletion {
  completedAt: string;
  failureCode: string | null;
  operationId: string;
  status: 'failed' | 'succeeded';
}

export interface CompanyEmailSecretAuditWriter {
  completeCompanyEmailSecretAuditOperation(
    completion: CompanyEmailSecretAuditCompletion,
  ): Promise<void>;
  startCompanyEmailSecretAuditOperation(
    operation: CompanyEmailSecretAuditOperation,
  ): Promise<void>;
}
