export type CompanyEmailSecretEffect = 'noEffect' | 'unknown';

// Only the adapter that owns the effect can prove that no change began.
export class CompanyEmailSecretStoreError extends Error {
  constructor(readonly effect: CompanyEmailSecretEffect = 'unknown') {
    super('Email secret storage could not be completed safely.');
    this.name = 'CompanyEmailSecretStoreError';
  }
}
