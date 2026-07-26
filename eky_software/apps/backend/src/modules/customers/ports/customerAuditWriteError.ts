export class CustomerAuditWriteError extends Error {
  constructor() {
    super('Customer audit event could not be written.');
    this.name = 'CustomerAuditWriteError';
  }
}
