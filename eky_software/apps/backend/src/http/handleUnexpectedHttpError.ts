import type { Context } from 'hono';

import type { BackendEnvironment } from './runtimeTrust.js';

export interface HttpRequestFailureObserver {
  captureOriginalException(error: unknown): void;
}

export function handleUnexpectedHttpError(
  error: unknown,
  context: Context<BackendEnvironment>,
  observer?: HttpRequestFailureObserver,
): Response {
  context.set('httpHandlerFailed', true);
  try {
    // Only synthetic tests inject this observer; production keeps safe codes.
    observer?.captureOriginalException(error);
  } catch {
    // Optional evidence must not replace the HTTP response or recurse.
  }
  return context.json({ error: 'Internal server error.' }, 500);
}
