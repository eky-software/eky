import { lstatSync, readFileSync, readlinkSync, realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

const invalid = () => new Error('E2E_VITE_OWNER_CONFIGURATION_INVALID');

export function requireWindowsVitePath(path: string, directory: boolean): string {
  if (typeof path !== 'string' || !isAbsolute(path) || path.includes('\0') ||
    (process.platform === 'win32' && (!/^[A-Za-z]:\\/.test(path) || path.includes('/') ||
      path.indexOf(':', 2) >= 0 || path.split('\\').slice(1).some(part => part.endsWith('.') || part.endsWith(' '))))) {
    throw invalid();
  }
  if (!samePath(path, resolve(path))) throw invalid();
  const stats = lstatSync(path);
  if (stats.isSymbolicLink() || (directory ? !stats.isDirectory() : !stats.isFile())) throw invalid();
  for (let cursor = directory ? path : dirname(path);;) {
    const parent = lstatSync(cursor);
    if (parent.isSymbolicLink() || !parent.isDirectory()) throw invalid();
    const next = dirname(cursor);
    if (next === cursor) break;
    cursor = next;
  }
  return realpathSync.native(path);
}

export function requireWindowsViteDescendant(path: string, root: string): void {
  const rel = relative(root, path);
  if (rel === '' || isAbsolute(rel) || rel === '..' || rel.startsWith(`..${sep}`)) throw invalid();
}

export function resolveWindowsViteEntrypoint(repositoryRoot: string): string {
  const repository = requireWindowsVitePath(repositoryRoot, true);
  const web = requireWindowsVitePath(join(repository, 'apps', 'web'), true);
  requireWindowsVitePath(join(web, 'vite.config.ts'), false);
  const selector = join(requireWindowsVitePath(join(web, 'node_modules'), true), 'vite');
  if (!lstatSync(selector).isSymbolicLink()) throw invalid();
  // Only the named package selector may be a link. Inspect its original target
  // before realpath so a second link cannot disappear during canonicalization.
  const target = requireWindowsVitePath(resolve(dirname(selector), readlinkSync(selector)), true);
  if (!samePath(target, realpathSync.native(selector))) throw invalid();
  const store = requireWindowsVitePath(join(repository, 'node_modules', '.pnpm'), true);
  requireWindowsViteDescendant(target, store);
  const segments = relative(store, target).split(sep);
  if (segments.length !== 3 || !segments[0]!.startsWith('vite@') ||
    segments[1] !== 'node_modules' || segments[2] !== 'vite') throw invalid();
  const manifestPath = requireWindowsVitePath(join(target, 'package.json'), false);
  if (lstatSync(manifestPath).size > 65_536) throw invalid();
  const manifest: unknown = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (manifest === null || typeof manifest !== 'object' || Array.isArray(manifest)) throw invalid();
  const { name, version, bin } = manifest as Record<string, unknown>;
  if (name !== 'vite' || typeof version !== 'string' || version.length > 64 || !/^[A-Za-z0-9.+-]+$/.test(version) ||
    (segments[0] !== `vite@${version}` && !segments[0]!.startsWith(`vite@${version}_`)) ||
    bin === null || typeof bin !== 'object' || Array.isArray(bin) ||
    Object.keys(bin).length !== 1 || (bin as Record<string, unknown>).vite !== 'bin/vite.js') throw invalid();
  return requireWindowsVitePath(join(target, 'bin', 'vite.js'), false);
}

export function validateWindowsViteServiceInput(input: {
  repositoryRoot: string; runRoot: string; environmentRoot: string; backendOrigin: string;
  sessionSecret: string; webPort: number;
}, osTempRoot: string): void {
  if (!Number.isSafeInteger(input.webPort) || input.webPort < 1 || input.webPort > 65_535 ||
    typeof input.sessionSecret !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(input.sessionSecret)) throw invalid();
  const origin = typeof input.backendOrigin === 'string' ? /^http:\/\/127\.0\.0\.1:([1-9][0-9]{0,4})$/.exec(input.backendOrigin) : null;
  if (origin === null || Number(origin[1]) === 80 || Number(origin[1]) > 65_535) throw invalid();
  const temp = requireWindowsVitePath(osTempRoot, true);
  const run = requireWindowsVitePath(input.runRoot, true);
  const repository = requireWindowsVitePath(input.repositoryRoot, true);
  if (!samePath(dirname(run), join(temp, 'eky-e2e')) || !basename(run).startsWith('run-')) throw invalid();
  const relRun = relative(repository, run);
  const relRepository = relative(run, repository);
  const inside = (rel: string) => !isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`);
  if (inside(relRun) || inside(relRepository)) throw invalid();
  const environment = requireWindowsVitePath(input.environmentRoot, true);
  requireWindowsViteDescendant(environment, run);
  resolveWindowsViteEntrypoint(repository);
}

function samePath(first: string, second: string): boolean {
  return process.platform === 'win32' ? first.toLowerCase() === second.toLowerCase() : first === second;
}
