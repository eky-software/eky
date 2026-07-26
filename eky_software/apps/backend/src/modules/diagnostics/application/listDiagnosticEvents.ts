import type { ActorContext } from '@eky/auth';
import { requirePermission } from '@eky/permissions';

import type { DiagnosticEventItem } from '../domain/diagnosticEventItem.js';
import type { DiagnosticEventReader } from '../ports/diagnosticEventReader.js';

export const defaultDiagnosticEventLimit = 100;
export const maximumDiagnosticEventLimit = 200;

export interface ListDiagnosticEventsInput {
  actorContext: ActorContext;
  limit?: number;
}

export class DiagnosticEventValidationError extends Error {
  readonly code = 'diagnostic_event_validation_error';

  constructor(message: string) {
    super(message);
    this.name = 'DiagnosticEventValidationError';
  }
}

export async function listDiagnosticEvents(
  input: ListDiagnosticEventsInput,
  reader: DiagnosticEventReader,
): Promise<DiagnosticEventItem[]> {
  requirePermission(input.actorContext, 'viewDiagnostics');
  const limit = validateLimit(input.limit);
  return reader.listRecentDiagnosticEvents(limit);
}

function validateLimit(limit: number | undefined): number {
  if (limit === undefined) {
    return defaultDiagnosticEventLimit;
  }
  if (
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > maximumDiagnosticEventLimit
  ) {
    throw new DiagnosticEventValidationError(
      `Diagnostic event limit must be an integer between 1 and ${maximumDiagnosticEventLimit}.`,
    );
  }
  return limit;
}

