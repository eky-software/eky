import type { MiddlewareHandler } from 'hono';

import type { BackendEnvironment } from './runtimeTrust.js';
import type { ProfileMaintenanceState } from '../runtime/profileMaintenance/profileMaintenanceState.js';

const businessWriteMethods = new Set(['DELETE', 'PATCH', 'POST', 'PUT']);

export function createProfileMaintenanceMiddleware(
  state: ProfileMaintenanceState,
): MiddlewareHandler<BackendEnvironment> {
  return async (context, next) => {
    if (!businessWriteMethods.has(context.req.method.toUpperCase())) {
      await next();
      return;
    }

    const release = state.tryBeginBusinessWrite();

    if (release === undefined) {
      return context.json(
        {
          code: 'PROFILE_MAINTENANCE_ACTIVE',
          error: 'Service is temporarily unavailable.',
        },
        503,
      );
    }

    try {
      await next();
    } finally {
      release();
    }
  };
}
