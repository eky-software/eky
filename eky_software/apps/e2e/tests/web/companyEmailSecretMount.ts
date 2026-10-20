import type { Page } from '@playwright/test';

import type { CompanyEmailSecretStatus, EkyApiClient } from '../../../../packages/api-client/src/index.js';
import { expect } from '../../src/fixtures/isolatedWebTest.js';

type Operation = 'load' | 'save' | 'remove';
type Outcome = 'configured' | 'empty' | 'noEffect' | 'unknown' | 'auditIncomplete' | 'failure';
type SecretClient = Pick<EkyApiClient,
  'getCompanyEmailSecretStatus' | 'setCompanyEmailSecret' | 'removeCompanyEmailSecret'>;

// Browser-component coverage only: no desktop generation, broker or persistence.
// The adapter ignores all request arguments; only status and operation counts leave it.
export async function mountCompanyEmailSecretProbe(page: Page) {
  await expect(page.getByRole('heading', { name: 'Asiakkaat', exact: true })).toBeVisible();
  const handle = await page.evaluateHandle(async () => {
    function loadedModule(suffix: string): string {
      const resource = performance.getEntriesByType('resource').find((entry) =>
        new URL(entry.name).origin === location.origin &&
        new URL(entry.name).pathname.endsWith(`/${suffix}`));
      if (!resource) throw new Error('Missing loaded company email probe module.');
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
    const componentPath = '/src/features/companySettings/CompanyEmailSecretPanel.tsx';
    const { CompanyEmailSecretPanel } = await import(componentPath);
    // Reuse the hook's actual module instance: its contract uses instanceof EkyApiError.
    const { EkyApiError } = await import(loadedModule('packages/api-client/src/index.ts')) as
      typeof import('../../../../packages/api-client/src/index.js');
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
    const calls: Array<{
      operation: Operation;
      released: boolean;
      resolve(status: CompanyEmailSecretStatus): void;
      reject(error: Error): void;
      settled: Promise<void>;
    }> = [];
    function request(operation: Operation): Promise<CompanyEmailSecretStatus> {
      let resolve!: (status: CompanyEmailSecretStatus) => void;
      let reject!: (error: Error) => void;
      const result = new Promise<CompanyEmailSecretStatus>((accept, fail) => {
        resolve = accept;
        reject = fail;
      });
      calls.push({ operation, released: false, resolve, reject,
        settled: result.then(() => undefined, () => undefined) });
      return result;
    }
    function createClient(): SecretClient {
      return {
        getCompanyEmailSecretStatus: () => request('load'),
        setCompanyEmailSecret: () => request('save'),
        removeCompanyEmailSecret: () => request('remove'),
      };
    }
    const clients = [createClient(), createClient()] as const;
    const container = document.createElement('section');
    container.setAttribute('aria-label', 'Company email secret probe');
    const root = reactDom.createRoot(container);
    document.body.append(container);
    async function close(): Promise<void> {
      try { await flush(() => root.unmount()); }
      finally {
        for (const call of calls) call.resolve({ configured: false });
        // Every local gate is settled, including ones abandoned by a failed assertion.
        try { await Promise.all(calls.map((call) => call.settled)); }
        finally { container.remove(); }
      }
    }
    async function selectClient(index: 0 | 1, remount: boolean): Promise<void> {
      if (remount) await flush(() => root.render(null));
      await flush(() => root.render(react.createElement(CompanyEmailSecretPanel, {
        apiClient: clients[index],
      })));
    }
    try { await selectClient(0, false); }
    catch (error) {
      try { await close(); }
      catch { /* Preserve the original mount error; the fixture owns the context. */ }
      throw error;
    }
    return {
      close,
      selectClient,
      operations: () => calls.map((call) => call.operation),
      async release(index: number, outcome: Outcome) {
        const call = calls[index];
        if (!call || call.released) throw new Error('Company email probe call is not pending.');
        call.released = true;
        await flush(async () => {
          if (outcome === 'configured' || outcome === 'empty') {
            call.resolve({ configured: outcome === 'configured' });
          } else if (outcome === 'failure') {
            call.reject(new Error('Synthetic company email status failure.'));
          } else {
            const code = {
              noEffect: 'COMPANY_EMAIL_SECRET_OPERATION_FAILED',
              unknown: 'COMPANY_EMAIL_SECRET_OUTCOME_UNKNOWN',
              auditIncomplete: 'COMPANY_EMAIL_SECRET_AUDIT_INCOMPLETE',
            }[outcome];
            const message = 'Synthetic company email operation failure.';
            call.reject(new EkyApiError(message, {
              status: 503, responseBody: { error: message, code },
            }));
          }
          await call.settled;
        });
      },
    };
  });
  return {
    view: page.getByRole('region', { name: 'Company email secret probe', exact: true }),
    async expectCalls(operations: Operation[]) {
      expect(await handle.evaluate((probe) => probe.operations())).toEqual(operations);
    },
    async selectClient(index: 0 | 1, remount = false) {
      await handle.evaluate((probe, input) => probe.selectClient(input.index, input.remount), { index, remount });
    },
    async release(index: number, outcome: Outcome) {
      await handle.evaluate((probe, input) => probe.release(input.index, input.outcome), { index, outcome });
    },
    async close() {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const cleanup = async () => {
        let failure: { error: unknown } | undefined;
        try { await handle.evaluate((probe) => probe.close()); }
        catch (error) { failure = { error }; }
        try { await handle.dispose(); }
        catch (error) { failure ??= { error }; }
        if (failure) throw failure.error;
      };
      try {
        await Promise.race([
          cleanup(),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error('Company email probe cleanup timed out.')), 3_000);
          }),
        ]);
      } finally { clearTimeout(timer); }
    },
  };
}
