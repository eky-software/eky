import { basename, dirname, join, relative, isAbsolute, sep } from 'node:path';
import { createWindowsServicePathChecks, sameWindowsServicePath } from './windowsServicePaths.js';
import { chromiumServerEntrypoint } from './chromiumWorkerContract.mjs';

const invalid = () => new Error('E2E_CHROMIUM_OWNER_CONFIGURATION_INVALID');
const { requirePath } = createWindowsServicePathChecks('E2E_CHROMIUM_OWNER_CONFIGURATION_INVALID');

export function validateWindowsChromiumServiceInput(input: {
  repositoryRoot: string; runRoot: string; browserExecutable: string;
}, osTempRoot: string): void {
  const temp = requirePath(osTempRoot, true);
  const run = requirePath(input.runRoot, true);
  const repository = requirePath(input.repositoryRoot, true);
  if (!sameWindowsServicePath(dirname(run), join(temp, 'eky-e2e')) || !basename(run).startsWith('run-')) throw invalid();
  const inside = (path: string, root: string) => {
    const rel = relative(root, path);
    return !isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`);
  };
  if (inside(run, repository) || inside(repository, run)) throw invalid();
  const browser = requirePath(input.browserExecutable, false);
  if (basename(browser).toLowerCase() !== 'chrome.exe' || basename(dirname(browser)) !== 'chrome-win64') throw invalid();
  requirePath(join(repository, chromiumServerEntrypoint), false);
}
