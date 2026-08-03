export type InvoiceNumberingSeriesErrorCode =
  | 'confirmationInvalid'
  | 'conflict'
  | 'notFound'
  | 'unsafeFirstSequenceNumber';

export class InvoiceNumberingSeriesError extends Error {
  constructor(
    readonly code: InvoiceNumberingSeriesErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'InvoiceNumberingSeriesError';
  }
}
