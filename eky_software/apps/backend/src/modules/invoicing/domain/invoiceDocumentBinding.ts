export type RevisionInvoiceDocumentBinding = Readonly<{
  kind: 'revision';
  revisionId: string;
  sourceDocumentId?: never;
}>;

export type PreservedLegacyInvoiceDocumentBinding = Readonly<{
  kind: 'preservedLegacy';
  sourceDocumentId: string;
  revisionId?: never;
}>;

export type InvoiceDocumentBinding =
  | RevisionInvoiceDocumentBinding
  | PreservedLegacyInvoiceDocumentBinding;

export type LegacyOriginalInvoiceDocumentBinding = Readonly<{
  kind: 'legacyOriginal';
  revisionId?: never;
  sourceDocumentId?: never;
}>;
