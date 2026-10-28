import type { DesktopBackendHandle, StartDesktopBackendOptions } from '../src/runtime/backendProcess.js';

// Observation only. The production starter retains migration, reservation and
// process ownership; the existing fixture owns the enclosing Electron tree.
export function observeSelectorTestBackend(start: (options: StartDesktopBackendOptions) => Promise<DesktopBackendHandle>) {
  let starts = 0;
  let active: DesktopBackendHandle | undefined;
  return {
    snapshot: () => ({ starts, running: active !== undefined, port: active?.port }),
    async startBackend(options: StartDesktopBackendOptions): Promise<DesktopBackendHandle> {
      starts++;
      const handle = await start(options);
      active = handle;
      const release = () => { if (active === handle) active = undefined; };
      return {
        port: handle.port,
        onUnexpectedExit(callback) { handle.onUnexpectedExit(() => { release(); callback(); }); },
        async stop() { const result = await handle.stop(); release(); return result; },
        async stopForUpdate(id) { await handle.stopForUpdate(id); release(); },
        async stopForRestore(id) { await handle.stopForRestore(id); release(); },
        async stopForDelete(id) { await handle.stopForDelete(id); release(); },
      };
    },
  };
}
