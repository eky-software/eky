import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import { createProfileMaintenanceMiddleware } from './profileMaintenance.js';
import type { BackendEnvironment } from './runtimeTrust.js';
import { ProfileMaintenanceState } from '../runtime/profileMaintenance/profileMaintenanceState.js';

describe('profile maintenance HTTP middleware', () => {
  it('keeps reads and health available while writes are blocked', async () => {
    const state = new ProfileMaintenanceState();
    const app = createTestApp(state);

    await state.begin('operation-1', 1_000);

    expect((await app.request('/health')).status).toBe(200);
    expect((await app.request('/business-data')).status).toBe(200);
    const writeResponse = await app.request('/business-data', {
      method: 'POST',
    });

    expect(writeResponse.status).toBe(503);
    await expect(writeResponse.json()).resolves.toEqual({
      code: 'PROFILE_MAINTENANCE_ACTIVE',
      error: 'Service is temporarily unavailable.',
    });
    state.end('operation-1');
    expect(
      (await app.request('/business-data', { method: 'POST' })).status,
    ).toBe(200);
  });

  it('tracks a write until its asynchronous handler completes', async () => {
    const state = new ProfileMaintenanceState();
    let finishWrite: (() => void) | undefined;
    const writeCompleted = new Promise<void>((resolve) => {
      finishWrite = resolve;
    });
    const app = new Hono<BackendEnvironment>();
    app.use('*', createProfileMaintenanceMiddleware(state));
    app.post('/business-data', async (context) => {
      await writeCompleted;
      return context.json({ ok: true });
    });

    const request = app.request('/business-data', { method: 'POST' });
    await Promise.resolve();
    const maintenance = state.begin('operation-1', 1_000);
    let maintenanceStarted = false;
    void maintenance.then(() => {
      maintenanceStarted = true;
    });

    await Promise.resolve();
    expect(maintenanceStarted).toBe(false);
    finishWrite?.();
    await expect(request).resolves.toMatchObject({ status: 200 });
    await maintenance;
    expect(maintenanceStarted).toBe(true);
    state.end('operation-1');
  });
});

function createTestApp(state: ProfileMaintenanceState) {
  const app = new Hono<BackendEnvironment>();
  app.use('*', createProfileMaintenanceMiddleware(state));
  app.get('/health', (context) => context.json({ status: 'ok' }));
  app.get('/business-data', (context) => context.json({ ok: true }));
  app.post('/business-data', (context) => context.json({ ok: true }));
  return app;
}
