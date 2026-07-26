import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';

import type { BackendEnvironment } from '../../../http/runtimeTrust.js';
import { createActivityRoutes } from './activityRoutes.js';

describe('activity routes', () => {
  it('uses the backend actor context and returns the safe projection', async () => {
    const listActivity = vi.fn().mockResolvedValue([
      {
        id: 'customers:event-1',
        module: 'customers',
        occurredAt: '2026-07-27T10:00:00.000Z',
        reference: { kind: 'customerNumber', value: '1001' },
        type: 'customer.updated',
      },
    ]);
    const app = createTestApp(listActivity);

    const response = await app.request('/activity?limit=20');

    expect(response.status).toBe(200);
    expect(listActivity).toHaveBeenCalledWith({
      actorContext: expect.objectContaining({ companyId: 'trusted-company' }),
      limit: 20,
    });
    await expect(response.json()).resolves.toEqual({
      activityItems: [
        {
          id: 'customers:event-1',
          module: 'customers',
          occurredAt: '2026-07-27T10:00:00.000Z',
          reference: { kind: 'customerNumber', value: '1001' },
          type: 'customer.updated',
        },
      ],
    });
  });

  it('rejects companyId and malformed limits from the query', async () => {
    const listActivity = vi.fn();
    const app = createTestApp(listActivity);

    expect((await app.request('/activity?companyId=other')).status).toBe(400);
    expect((await app.request('/activity?limit=1.5')).status).toBe(400);
    expect((await app.request('/activity?limit=101')).status).toBe(400);
    expect(listActivity).not.toHaveBeenCalled();
  });
});

function createTestApp(listActivity: ReturnType<typeof vi.fn>) {
  const app = new Hono<BackendEnvironment>();
  app.use('*', async (context, next) => {
    context.set('actorContext', {
      actorId: 'actor-1',
      authenticationMode: 'local',
      companyId: 'trusted-company',
      permissions: ['viewActivity'],
    });
    context.set('correlationId', 'correlation-1');
    await next();
  });
  app.route('/', createActivityRoutes({ listActivity }));
  return app;
}
