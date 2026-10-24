import type { ActorContext } from '@eky/auth';
import { requirePermission } from '@eky/permissions';

import type { DiagnosticEventPage } from '../domain/diagnosticEventPage.js';
import { DiagnosticBrowseError, isDiagnosticBrowseCursor, diagnosticBrowsePolicy } from '../domain/diagnosticBrowsePolicy.js';
import { unavailableDiagnosticReadState } from '../domain/diagnosticReadState.js';
import type { DiagnosticEventReader } from '../ports/diagnosticEventReader.js';
import type { DiagnosticReadFailureObserver } from '../ports/diagnosticReadFailureObserver.js';
import { observeDiagnosticReadFailure } from './observeDiagnosticReadFailure.js';

export const defaultDiagnosticEventLimit = diagnosticBrowsePolicy.defaultLimit;
export const maximumDiagnosticEventLimit = diagnosticBrowsePolicy.maximumLimit;

export interface ListDiagnosticEventsInput {
  actorContext: ActorContext;
  limit?: number;
  cursor?: string;
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
  failureObserver?: DiagnosticReadFailureObserver,
): Promise<DiagnosticEventPage> {
  requirePermission(input.actorContext, 'viewDiagnostics');
  if (input.cursor !== undefined && (input.limit !== undefined || !isDiagnosticBrowseCursor(input.cursor))) {
    throw new DiagnosticEventValidationError('Diagnostic cursor is invalid.');
  }
  const limit = validateLimit(input.limit);
  try {
    const actor = JSON.stringify([input.actorContext.authenticationMode, input.actorContext.actorId, input.actorContext.companyId]);
    return await reader.browseDiagnosticEvents(input.cursor === undefined ? { limit } : { cursor: input.cursor }, actor);
  } catch (error) {
    if (error instanceof DiagnosticBrowseError) throw error;
    observeDiagnosticReadFailure(failureObserver, error);
    return { state: 'unavailable', diagnosticEvents: [], readState: unavailableDiagnosticReadState };
  }
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

