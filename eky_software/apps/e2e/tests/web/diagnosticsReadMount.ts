import type { Page } from '@playwright/test';

import type { EkyApiClient } from '../../../../packages/api-client/src/index.js';

// Uses the existing fixture's Vite/React component-test route, not a new runtime.
export async function mountDiagnosticsReadProbe(page: Page) {
  const handle = await page.evaluateHandle(async () => {
    function loadedModule(name: string): string {
      const resource = performance.getEntriesByType('resource').find(entry =>
        new URL(entry.name).origin === location.origin &&
        new URL(entry.name).pathname.endsWith(`/${name}`));
      if (!resource) throw new Error(`Missing loaded Vite module: ${name}`);
      return resource.name;
    }
    const { default: react } = await import(loadedModule('react.js')) as {
      default: { createElement(component: unknown, props: unknown): unknown;
        act(callback: () => void | Promise<void>): Promise<void> };
    };
    const { default: reactDom } = await import(loadedModule('react-dom_client.js')) as {
      default: { createRoot(container: HTMLElement): {
        render(element: unknown): void; unmount(): void;
      } };
    };
    const componentPath = '/src/features/diagnostics/components/DiagnosticsPage.tsx';
    const compositionPath = '/src/app/createWebAppComposition.ts';
    const { DiagnosticsPage } = await import(componentPath);
    const { createWebAppComposition } = await import(compositionPath) as {
      createWebAppComposition(): { apiClient: EkyApiClient };
    };
    const client = createWebAppComposition().apiClient;
    const [summary, events] = await Promise.all([
      client.getDiagnosticSummary(), client.listDiagnosticEvents(),
    ]);
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
    container.setAttribute('aria-label', 'Diagnostics read probe');
    document.body.append(container);
    const root = reactDom.createRoot(container);
    const calls: Array<{
      resolve(): void; reject(error: Error): void; settled: Promise<void>;
    }> = [];
    function hold<T>(value: T): Promise<T> {
      let resolve!: () => void;
      let reject!: (error: Error) => void;
      const gate = new Promise<void>((accept, fail) => { resolve = accept; reject = fail; });
      const result = gate.then(() => value);
      calls.push({ resolve, reject, settled: result.then(() => undefined, () => undefined) });
      return result;
    }
    async function startSession(unmount: boolean): Promise<void> {
      if (unmount) await flush(() => root.render(null));
      await flush(() => root.render(react.createElement(DiagnosticsPage, { apiClient: {
        getDiagnosticSummary: () => hold(summary),
        listDiagnosticEvents: () => hold(events),
      } })));
    }
    await startSession(false);
    return {
      startSession,
      callCount: () => calls.length,
      async release(index: number, failure: boolean): Promise<void> {
        const call = calls[index];
        if (!call) throw new Error('Diagnostic read is not ready for release.');
        await flush(async () => {
          if (failure) call.reject(new Error('Synthetic stale diagnostic failure.'));
          else call.resolve();
          await call.settled;
        });
      },
      async close(): Promise<void> {
        try { await flush(() => root.unmount()); }
        finally {
          for (const call of calls) call.resolve();
          try { await Promise.all(calls.map(call => call.settled)); }
          finally { container.remove(); }
        }
      },
    };
  });
  return {
    view: page.getByRole('region', { name: 'Diagnostics read probe' }),
    callCount: () => handle.evaluate(probe => probe.callCount()),
    startSession: (unmount: boolean) => handle.evaluate((probe, value) => probe.startSession(value), unmount),
    release: (index: number, failure = false) =>
      handle.evaluate((probe, value) => probe.release(value.index, value.failure), { index, failure }),
    async close(): Promise<void> {
      let failure: { error: unknown } | undefined;
      try { await handle.evaluate(probe => probe.close()); }
      catch (error) { failure = { error }; }
      try { await handle.dispose(); }
      catch (error) { failure ??= { error }; }
      if (failure) throw failure.error;
    },
  };
}
