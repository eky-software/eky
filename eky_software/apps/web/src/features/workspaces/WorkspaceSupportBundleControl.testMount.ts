import { StrictMode, createElement, useLayoutEffect } from 'react';
import { createRoot } from 'react-dom/client';

import { WorkspaceSupportBundleControl } from './WorkspaceSupportBundleControl.js';
import { useWorkspaceSupportBundle, type WorkspaceSupportBundleController } from './useWorkspaceSupportBundle.js';

// Loaded only by the isolated browser-component fixture, never by the app entry.
export async function mountWorkspaceSupportBundleProbe(startInLayoutEffect = false) {
  if (import.meta.env.MODE !== 'eky-e2e') throw new Error('Support probe requires the E2E runtime.');
  const { act } = await import('react');
  const environment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
  async function flush(callback: () => void | Promise<void>) {
    const previous = environment.IS_REACT_ACT_ENVIRONMENT;
    environment.IS_REACT_ACT_ENVIRONMENT = true;
    try { await act(callback); }
    finally {
      if (previous === undefined) delete environment.IS_REACT_ACT_ENVIRONMENT;
      else environment.IS_REACT_ACT_ENVIRONMENT = previous;
    }
  }
  const requests: Array<{ creator: number; resolve(value: 'created' | 'cancelled'): void;
    reject(error: Error): void; settled: Promise<void> }> = [];
  const creators = [0, 1].map(creator => () => {
    let resolve!: (value: 'created' | 'cancelled') => void, reject!: (error: Error) => void;
    const result = new Promise<'created' | 'cancelled'>((yes, no) => { resolve = yes; reject = no; });
    requests.push({ creator, resolve, reject, settled: result.then(() => undefined, () => undefined) });
    return result;
  });
  let creator = 0, disabled = false, mounted = true;
  let latest: WorkspaceSupportBundleController;
  let retained: (() => void) | undefined;
  const container = document.createElement('section');
  container.setAttribute('aria-label', 'Workspace support export probe');
  container.style.cssText = 'max-width:680px;margin:20px auto;padding:16px;';
  document.body.append(container);
  const root = createRoot(container);
  function Probe() {
    const controller = useWorkspaceSupportBundle(creators[creator], disabled);
    latest = controller;
    useLayoutEffect(() => {
      if (startInLayoutEffect) controller.create();
    }, []);
    return createElement(WorkspaceSupportBundleControl, { controller });
  }
  const render = () => root.render(createElement(StrictMode, {}, mounted ? createElement(Probe) : null));
  async function close() {
    try {
      await flush(async () => {
        let failure: { error: unknown } | undefined;
        try { root.unmount(); } catch (error) { failure = { error }; }
        for (const request of requests) request.resolve('cancelled');
        await Promise.all(requests.map(request => request.settled));
        if (failure !== undefined) throw failure.error;
      });
    } finally { container.remove(); }
  }
  try { await flush(render); }
  catch (error) {
    try { await close(); }
    catch (cleanupError) { throw new AggregateError([error, cleanupError], 'Support probe initialization and cleanup failed.'); }
    throw error;
  }
  return {
    read() { return requests.map(request => request.creator); },
    rememberHandler() { retained = latest.create; },
    async invokeRetained(twice = false) {
      await flush(() => { retained?.(); if (twice) retained?.(); });
    },
    async configure(next: { creator?: number; disabled?: boolean; mounted?: boolean }) {
      if (next.creator !== undefined) creator = next.creator;
      if (next.disabled !== undefined) disabled = next.disabled;
      if (next.mounted !== undefined) mounted = next.mounted;
      await flush(render);
    },
    async release(index: number, outcome: 'created' | 'cancelled' | 'reject') {
      const request = requests[index];
      if (request === undefined) throw new Error('Missing held support export.');
      await flush(async () => {
        if (outcome === 'reject') request.reject(new Error('SYNTHETIC_PRIVATE_SUPPORT_ERROR'));
        else request.resolve(outcome);
        await request.settled;
      });
    },
    close,
  };
}
