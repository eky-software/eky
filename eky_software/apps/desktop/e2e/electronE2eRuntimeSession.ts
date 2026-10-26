import { createDesktopRuntimeSession } from '../src/runtime/runtimeSession.js';

export function createElectronE2eRuntimeSessionFactory(primary: string): () => string {
  let first = true;
  return () => {
    if (!first) return createDesktopRuntimeSession();
    first = false;
    return primary;
  };
}
