import { InvoiceDocumentIntegrityError } from '../application/invoiceDocumentIntegrityError.js';
import type { StoredInvoiceDocumentMetadata } from '../domain/approvedInvoiceDocument.js';

export interface InvoiceEventReferenceFacts {
  legacyOriginal: boolean;
  legacyFieldsValid: boolean;
  documentAbsent: boolean;
}

export function validateInvoiceEventReference(facts: InvoiceEventReferenceFacts): 'document' | 'legacyMissingDocument' {
  if (facts.legacyOriginal) {
    if (!facts.legacyFieldsValid) fail();
    if (facts.documentAbsent) return 'legacyMissingDocument';
  }
  if (facts.documentAbsent) fail();
  return 'document';
}

export interface InvoiceEventDocumentBindingFacts {
  documentKind: StoredInvoiceDocumentMetadata['binding']['kind'] | undefined;
  kindMatches: boolean;
  revisionMatches: boolean;
  revisionModeAllowed: boolean;
  preservedLegacyFieldsValid: boolean;
  evidenceMatches: boolean;
}

export function validateInvoiceEventDocumentBinding(facts: InvoiceEventDocumentBindingFacts): void {
  if (facts.documentKind === undefined || !facts.kindMatches) fail();
  if (facts.documentKind === 'revision' && (!facts.revisionMatches || !facts.revisionModeAllowed)) fail();
  if (facts.documentKind === 'preservedLegacy' && !facts.preservedLegacyFieldsValid) fail();
  if (facts.documentKind !== 'legacyOriginal' && !facts.evidenceMatches) fail();
}

function fail(): never { throw new InvoiceDocumentIntegrityError(); }
