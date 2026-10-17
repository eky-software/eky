import type { Page } from '@playwright/test';

import type { EkyApiClient } from '../../../../packages/api-client/src/index.js';
import { expect } from '../../src/fixtures/isolatedWebTest.js';

// Browser-component coverage uses the fixture's existing Vite and React modules.
// No server endpoint, application hook, additional browser or test runtime is added.
export async function mountCompanySettingsLoadingProbe(page: Page) {
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
      default: {
        createRoot(container: HTMLElement): {
          render(element: unknown): void;
          unmount(): void;
        };
      };
    };
    const componentPath = '/src/features/companySettings/CompanySettingsPageView.tsx';
    const compositionPath = '/src/app/createWebAppComposition.ts';
    const { CompanySettingsPage } = await import(componentPath);
    const { createWebAppComposition } = await import(compositionPath) as {
      createWebAppComposition(): { apiClient: EkyApiClient };
    };
    const baseClient = createWebAppComposition().apiClient;
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
    const container = document.createElement('section');
    container.setAttribute('aria-label', 'Company settings loading probe');
    document.body.append(container);
    const root = reactDom.createRoot(container);
    const calls: Array<{
      ready: boolean;
      resolve(): void;
      reject(error: Error): void;
      settled: Promise<void>;
    }> = [];
    let client = baseClient;
    const render = () => root.render(react.createElement(CompanySettingsPage, {
      apiClient: client,
      isEmailSecretManagementAvailable: false,
      onOpenActivity() {},
      onOpenDiagnostics() {},
    }));
    async function startSession(unmount: boolean): Promise<void> {
      if (unmount) await flush(() => root.render(null));
      // Navigation remounts with the same client; replacement keeps the component mounted.
      if (!unmount) client = {
        ...baseClient,
        getCompanySettings() {
          let resolve!: () => void;
          let reject!: (error: Error) => void;
          const gate = new Promise<void>((accept, fail) => { resolve = accept; reject = fail; });
          // Observe failures immediately, even if cleanup releases an unfinished GET.
          void gate.catch(() => undefined);
          const call = { ready: false, resolve, reject, settled: Promise.resolve() };
          calls.push(call);
          const result = baseClient.getCompanySettings().then(async (settings) => {
            call.ready = true;
            await gate;
            return settings;
          });
          call.settled = result.then(() => undefined, () => undefined);
          return result;
        },
      };
      await flush(render);
    }
    await startSession(false);
    return {
      startSession,
      readCalls: () => calls.map((call) => call.ready),
      async release(index: number, outcome: 'success' | 'failure') {
        const call = calls[index];
        if (!call?.ready) throw new Error('Company settings GET is not ready for release.');
        // act waits for the real component's success/catch/finally updates to flush.
        await flush(async () => {
          if (outcome === 'success') call.resolve();
          else call.reject(new Error('Synthetic stale company settings failure.'));
          await call.settled;
        });
      },
      async close() {
        try { await flush(() => root.unmount()); }
        finally {
          for (const call of calls) call.resolve();
          try { await Promise.all(calls.map((call) => call.settled)); }
          finally { container.remove(); }
        }
      },
    };
  });
  return {
    view: page.getByRole('region', { name: 'Company settings loading probe' }),
    async waitForReads(count: number) {
      await expect.poll(() => handle.evaluate((probe) => probe.readCalls()))
        .toEqual(Array.from({ length: count }, () => true));
    },
    async startSession(unmount: boolean) {
      await handle.evaluate((probe, shouldUnmount) => probe.startSession(shouldUnmount), unmount);
    },
    async release(index: number, outcome: 'success' | 'failure' = 'success') {
      await handle.evaluate((probe, input) => probe.release(input.index, input.outcome), { index, outcome });
    },
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
