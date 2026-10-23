import { readFile } from 'node:fs/promises';
import { Script } from 'node:vm';
import { ModuleKind, ScriptTarget, transpileModule } from 'typescript';
import { describe, expect, it, vi } from 'vitest';

import type { DesktopDiagnosticsApi } from './desktopDiagnosticsTypes.js';
import { getOperationalLogFailureStatusIpcChannel, operationalLogFailureObservedIpcChannel } from './desktopDiagnosticsTypes.js';

describe('operational log failure preload boundary', () => {
  it('exposes only the zero-argument snapshot and a removable value-free callback', async () => {
    let api!: DesktopDiagnosticsApi;
    const listeners = new Map<string, (event: unknown, ...args: unknown[]) => void>();
    const invoke = vi.fn(async () => ({ failureObserved: true }));
    const source = await readFile(new URL('../preload/index.cts', import.meta.url), 'utf8');
    const { outputText } = transpileModule(source, { compilerOptions: {
      module: ModuleKind.CommonJS, target: ScriptTarget.ES2022,
    }, fileName: 'index.cts' });
    new Script(outputText).runInNewContext({ exports: {}, require(specifier: string) {
      expect(specifier).toBe('electron');
      return { contextBridge: { exposeInMainWorld(name: string, value: DesktopDiagnosticsApi) {
        expect(name).toBe('ekyDesktop'); api = value;
      } }, ipcRenderer: { invoke,
        on: (channel: string, listener: (event: unknown, ...args: unknown[]) => void) => listeners.set(channel, listener),
        removeListener: (channel: string, listener: unknown) => {
          expect(listeners.get(channel)).toBe(listener); listeners.delete(channel);
        },
      } };
    } });
    expect(await api.getOperationalLogFailureStatus()).toEqual({ failureObserved: true });
    expect(invoke).toHaveBeenCalledExactlyOnceWith(getOperationalLogFailureStatusIpcChannel);
    const callback = vi.fn();
    const unsubscribe = api.onOperationalLogFailure(callback);
    const listener = listeners.get(operationalLogFailureObservedIpcChannel)!;
    listener({ syntheticPrivateEvent: true }, 'unexpected payload');
    expect(callback).not.toHaveBeenCalled();
    listener({ syntheticPrivateEvent: true });
    expect(callback).toHaveBeenCalledExactlyOnceWith();
    callback.mockImplementation(() => { throw new Error('synthetic callback failure'); });
    expect(() => listener({})).not.toThrow();
    unsubscribe();
    expect(listeners.size).toBe(0);
    expect(() => api.onOperationalLogFailure(undefined as never)).toThrow('OPERATIONAL_LOG_FAILURE_LISTENER_INVALID');
    expect(Object.isFrozen(api)).toBe(true);
    expect(api).not.toHaveProperty('ipcRenderer');
  });
});
