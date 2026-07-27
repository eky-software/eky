import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';

import type { BackendEnvironment } from '../../../http/runtimeTrust.js';
import type { ListActivityInput } from '../application/listActivity.js';
import type { ActivityPage } from '../domain/activityItem.js';
import { createActivityRoutes } from './activityRoutes.js';

type ListActivity = (input: ListActivityInput) => Promise<ActivityPage>;

describe('activity routes', () => {
  it('uses backend context and passes validated monthly filters', async () => {
    const listActivity = vi.fn<ListActivity>().mockResolvedValue({
      activityItems: [
        {
          id: 'customers:event-1',
          module: 'customers',
          occurredAt: '2026-07-27T10:00:00.000Z',
          outcome: 'success',
          reference: { kind: 'customerNumber', value: '1001' },
          type: 'customer.updated',
        },
      ],
      hasNextPage: false,
      hasPreviousPage: false,
      month: '2026-07',
      page: 1,
      pageSize: 20,
    });
    const app = createTestApp(listActivity);

    const response = await app.request(
      '/activity?month=2026-07&category=customers&outcome=success&page=1&pageSize=20',
    );

    expect(response.status).toBe(200);
    expect(listActivity).toHaveBeenCalledWith({
      actorContext: expect.objectContaining({ companyId: 'trusted-company' }),
      category: 'customers',
      month: '2026-07',
      outcome: 'success',
      page: 1,
      pageSize: 20,
    });
    await expect(response.json()).resolves.toEqual(
      expect.objectContaining({ month: '2026-07', page: 1 }),
    );
  });

  it('rejects companyId and malformed filters from the query', async () => {
    const listActivity = vi.fn<ListActivity>();
    const app = createTestApp(listActivity);

    expect((await app.request('/activity?companyId=other')).status).toBe(400);
    expect((await app.request('/activity?month=2026-13')).status).toBe(400);
    expect((await app.request('/activity?category=other')).status).toBe(400);
    expect((await app.request('/activity?outcome=other')).status).toBe(400);
    expect((await app.request('/activity?page=1.5')).status).toBe(400);
    expect((await app.request('/activity?pageSize=25')).status).toBe(400);
    expect(listActivity).not.toHaveBeenCalled();
  });
});

function createTestApp(listActivity: ListActivity) {
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
