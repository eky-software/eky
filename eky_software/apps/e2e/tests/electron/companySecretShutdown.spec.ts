import { existsSync, readFileSync } from 'node:fs';
import type { ElectronApplication } from '@playwright/test';

import { readElectronE2eActiveWorkspace } from '../../src/environment/readElectronE2eActiveWorkspace.js';
import { expect, test } from '../../src/fixtures/isolatedElectronTest.js';

for (const [scenario, method, operation, action] of [
  ['DESK-SECRET-DRAIN-001', 'PUT', 'setCompanyEmailSecret', 'companyEmailSecret.configured'],
  ['DESK-SECRET-DRAIN-002', 'DELETE', 'removeCompanyEmailSecret', 'companyEmailSecret.removed'],
] as const) {
  test(`${scenario} @critical @security @recovery waits for a delayed ${method} acknowledgment through shutdown`, async ({ e2eElectron }) => {
    const secret = 'Synthetic-D2-Only-Not-A-Credential';
    if (method === 'DELETE') {
      expect((await e2eElectron.api.put('/company-settings/email-secret', { data: { secret } })).status()).toBe(200);
    }
    const secretPath = readElectronE2eActiveWorkspace(e2eElectron.runtime.userDataPath).emailSecretFilePath;
    const activityPath = '/activity?category=companySettings&pageSize=100';
    await control(e2eElectron.electronApp, operation);
    // Use the real renderer protocol so main's HTTP quiescence owns this mutation.
    const mutation = e2eElectron.page.evaluate(async ({ method, secret }) => {
      const response = await fetch('/company-settings/email-secret', {
        method, headers: { 'content-type': 'application/json' },
        ...(method === 'PUT' ? { body: JSON.stringify({ secret }) } : {}),
      });
      return { status: response.status, body: await response.json() };
    }, { method, secret });
    void mutation.catch(() => undefined);
    try {
      await expect.poll(() => control(e2eElectron.electronApp, 'snapshot')).toMatchObject({ held: true });
      const before = await e2eElectron.api.get(activityPath);
      expect(before.status()).toBe(200);
      expect((await before.json()).activityItems.filter((entry: { type: string }) => entry.type === action)).toHaveLength(0);
      expect(existsSync(secretPath)).toBe(method === 'PUT');
      if (method === 'PUT') expect(readFileSync(secretPath).includes(Buffer.from(secret))).toBe(false);

      await control(e2eElectron.electronApp, 'beginShutdown');
      // Invalid input cannot mutate settings even if the fence has not run yet.
      await expect.poll(() => e2eElectron.page.evaluate(async () => (
        await fetch('/company-settings', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: '{}' })
      ).status)).toBe(503);
      expect(await control(e2eElectron.electronApp, 'snapshot')).toMatchObject({
        held: true, shutdown: 'pending', backendRunning: true,
      });
    } finally {
      // A separate soft failure retains cleanup evidence without replacing the
      // original proof error or skipping settlement of the outstanding request.
      await expect.soft(
        Promise.resolve().then(() => control(e2eElectron.electronApp, 'release')),
        'Delayed secret acknowledgment release failed.',
      ).resolves.toBeUndefined();
      await mutation.catch(() => undefined);
    }
    expect(await mutation).toEqual({ status: 200, body: { emailSecretStatus: { configured: method === 'PUT' } } });
    await control(e2eElectron.electronApp, 'waitForShutdown');
    expect(await control(e2eElectron.electronApp, 'snapshot')).toMatchObject({ shutdown: 'completed', backendRunning: false });

    const previous = await e2eElectron.restart();
    expect(e2eElectron.runtime.runtimeInstanceId).not.toBe(previous.previousRuntimeInstanceId);
    const status = await e2eElectron.api.get('/company-settings/email-secret');
    expect(status.status()).toBe(200);
    expect(await status.json()).toEqual({ emailSecretStatus: { configured: method === 'PUT' } });
    const activity = await e2eElectron.api.get(activityPath);
    expect(activity.status()).toBe(200);
    expect((await activity.json()).activityItems.filter((entry: { type: string }) => entry.type === action)).toEqual([
      expect.objectContaining({ type: action, outcome: 'success' }),
    ]);
    expect(existsSync(secretPath)).toBe(method === 'PUT');
  });
}

type Control = 'setCompanyEmailSecret' | 'removeCompanyEmailSecret' | 'snapshot' | 'release' | 'beginShutdown' | 'waitForShutdown';

function control(app: ElectronApplication, command: Control) {
  return app.evaluate(async (_, command) => {
    const proof = (globalThis as typeof globalThis & { __EKY_ELECTRON_E2E__?: {
      secretReplyProof: {
        arm(operation: 'setCompanyEmailSecret' | 'removeCompanyEmailSecret'): void;
        release(): void;
        beginShutdown(): void;
        waitForShutdown(): Promise<void>;
        snapshot(): { held: boolean; released: boolean; disposed: boolean; shutdown: string; backendRunning: boolean };
      };
    } }).__EKY_ELECTRON_E2E__?.secretReplyProof;
    if (proof === undefined) throw new Error('ELECTRON_SECRET_REPLY_PROOF_UNAVAILABLE');
    if (command === 'setCompanyEmailSecret' || command === 'removeCompanyEmailSecret') proof.arm(command);
    else if (command === 'snapshot') return proof.snapshot();
    else if (command === 'release') proof.release();
    else if (command === 'beginShutdown') proof.beginShutdown();
    else await proof.waitForShutdown();
    return undefined;
  }, command);
}
