import type { DatabaseConnection } from '../../../database/connection/createDatabaseConnection.js';
import { validateInvoiceRevisionIdentifiers } from './validateInvoiceRevisionIdentifiers.js';
import { validateInvoiceRevisionPairs } from './validateInvoiceRevisionPairs.js';
import { validateInvoiceRevisionCurrentSourceGuards, validateInvoiceRevisionRelations } from './validateInvoiceRevisionRelations.js';
import { validateInvoiceRevisionScalars } from './validateInvoiceRevisionScalars.js';

// The owner attests schema/encoding and holds one read snapshot through the
// complete catalog. Each stage exposes bounded facts, never full history rows.
export function validateInvoiceRevisionCatalog(database: DatabaseConnection): void {
  validateInvoiceRevisionIdentifiers(database);
  validateInvoiceRevisionScalars(database);
  validateInvoiceRevisionRelations(database);
  validateInvoiceRevisionPairs(database);
  validateInvoiceRevisionCurrentSourceGuards(database);
}
