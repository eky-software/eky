import type { Page } from '@playwright/test';

import type {
  ProfileProtectionCapability,
  ProfileProtectionStatus,
} from '../../../web/src/app/desktopBridge.js';
import { expect } from '../../src/fixtures/isolatedWebTest.js';

// The real panel runs in the fixture's Vite/React context; only native replies are held.
export async function mountProfileBackupFeedbackProbe(page: Page) {
  await expect(page.getByRole('heading', { name: 'Asiakkaat', exact: true })).toBeVisible();
  const handle = await page.evaluateHandle(async () => {
    function loadedModule(fileName: string): string {
      const resource = performance.getEntriesByType('resource').find((entry) =>
        new URL(entry.name).origin === location.origin &&
        new URL(entry.name).pathname.endsWith(`/${fileName}`));
      if (!resource) throw new Error(`Missing loaded Vite module: ${fileName}`);
      return resource.name;
    }
    const { default: react } = await import(loadedModule('react.js')) as {
      default: {
        createElement(component: unknown, props: unknown): unknown;
        act(callback: () => void | Promise<void>): Promise<void>;
      };
    };
    const { default: reactDom } = await import(loadedModule('react-dom_client.js')) as {
      default: { createRoot(container: HTMLElement): {
        render(element: unknown): void;
        unmount(): void;
      } };
    };
    const componentPath = '/src/features/companySettings/ProfileBackupPanel.tsx';
    const { ProfileBackupPanel } = await import(componentPath);
    const environment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
    async function flush(callback: () => void | Promise<void>): Promise<void> {
      const previous = environment.IS_REACT_ACT_ENVIRONMENT;
      environment.IS_REACT_ACT_ENVIRONMENT = true;
      try { await react.act(callback); }
      finally {
        if (previous === undefined) delete environment.IS_REACT_ACT_ENVIRONMENT;
        else environment.IS_REACT_ACT_ENVIRONMENT = previous;
      }
    }
    const status: ProfileProtectionStatus = {
      portableBackup: { latestSuccessfulPortableBackupAt: null, operationState: 'idle' },
      recoveryPoints: {
        availability: 'available', budgetState: 'withinBudget',
        latestValidatedGoodAt: null, nextAutomaticCheckAt: null,
        operationState: 'idle', pointCount: 0,
      },
    };
    type Kind = 'status' | 'backup' | 'inspection' | 'recoveryPoint';
    type Outcome = 'success' | 'cancelled' | 'failure';
    const calls: Array<{
      kind: Kind;
      release(outcome: Outcome): void;
      settled: Promise<void>;
    }> = [];
    function hold<T>(kind: Kind, success: T, cancelled: T): Promise<T> {
      let release!: (outcome: Outcome) => void;
      const result = new Promise<T>((resolve, reject) => {
        release = (outcome) => {
          if (outcome === 'failure') reject(new Error('Synthetic private backup failure.'));
          else resolve(outcome === 'cancelled' ? cancelled : success);
        };
      });
      calls.push({ kind, release, settled: result.then(() => undefined, () => undefined) });
      return result;
    }
    const capability: ProfileProtectionCapability = {
      getStatus: () => hold('status', status, status),
      createBackup: () => hold('backup', 'created' as const, 'cancelled' as const),
      createRecoveryPoint: () => hold('recoveryPoint', status, status),
      inspectBackup: () => hold<Awaited<ReturnType<ProfileProtectionCapability['inspectBackup']>>>('inspection', {
        status: 'inspected' as const,
        summary: {
          appVersion: '0.1.0', compatibilityStatus: 'compatible' as const,
          createdAt: '2026-08-04T18:00:00.000Z', databaseHealth: 'healthy' as const,
          documentCount: 4, formatVersion: 1 as const, profileMatchStatus: 'same' as const,
          totalBusinessByteSize: 1024,
        },
      }, { status: 'cancelled' as const }),
    };
    const container = document.createElement('section');
    container.setAttribute('aria-label', 'Backup feedback probe');
    document.body.append(container);
    const root = reactDom.createRoot(container);
    const render = () => root.render(react.createElement(ProfileBackupPanel, { capability }));
    await flush(render);
    return {
      calls: () => calls.map((call) => call.kind),
      async release(index: number, outcome: Outcome) {
        const call = calls[index];
        if (!call) throw new Error('Missing held backup reply.');
        await flush(async () => { call.release(outcome); await call.settled; });
      },
      async remount() {
        await flush(() => root.render(null));
        await flush(render);
      },
      async close() {
        try { await flush(() => root.unmount()); }
        finally {
          for (const call of calls) call.release('cancelled');
          try { await Promise.all(calls.map((call) => call.settled)); }
          finally { container.remove(); }
        }
      },
    };
  });
  return {
    view: page.getByRole('region', { name: 'Backup feedback probe' }),
    async expectCalls(kinds: string[]) {
      await expect.poll(() => handle.evaluate((probe) => probe.calls())).toEqual(kinds);
    },
    async release(index: number, outcome: 'success' | 'cancelled' | 'failure' = 'success') {
      await handle.evaluate((probe, input) => probe.release(input.index, input.outcome), { index, outcome });
    },
    async remount() { await handle.evaluate((probe) => probe.remount()); },
    async close() {
      let failure: { error: unknown } | undefined;
      try { await handle.evaluate((probe) => probe.close()); }
      catch (error) { failure = { error }; }
      try { await handle.dispose(); }
      catch (error) { failure ??= { error }; }
      if (failure) throw failure.error;
    },
  };
}
