import { mkdirSync, mkdtempSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const e2eRootDirectoryName = 'eky-e2e';

export function createE2eRunRoot(): string {
  const baseRoot = resolve(tmpdir(), e2eRootDirectoryName);
  mkdirSync(baseRoot, { mode: 0o700, recursive: true });

  const runRoot = mkdtempSync(join(realpathSync.native(baseRoot), 'run-'));
  return realpathSync.native(runRoot);
}
