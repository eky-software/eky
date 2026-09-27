import { lstatSync, readFileSync, readlinkSync, realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

import { createWindowsServicePathChecks, sameWindowsServicePath as samePath } from './windowsServicePaths.js';

const invalid = () => new Error('E2E_ELECTRON_OWNER_CONFIGURATION_INVALID');
export const { requirePath: requireWindowsElectronPath, requireDescendant: requireWindowsElectronDescendant } =
  createWindowsServicePathChecks('E2E_ELECTRON_OWNER_CONFIGURATION_INVALID');

function readManifest(path: string): Record<string, unknown> {
  requireWindowsElectronPath(path, false);
  if (lstatSync(path).size > 65_536) throw invalid();
  const value: unknown = JSON.parse(readFileSync(path, 'utf8'));
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw invalid();
  return value as Record<string, unknown>;
}

export function resolveWindowsElectronServiceExecutable(repositoryRoot: string): string {
  const repository = requireWindowsElectronPath(repositoryRoot, true);
  const desktop = requireWindowsElectronPath(join(repository, 'apps', 'desktop'), true);
  const metadata = readManifest(join(desktop, 'package.json'));
  const dependencies = metadata.devDependencies;
  if (dependencies === null || typeof dependencies !== 'object' || Array.isArray(dependencies)) throw invalid();
  const version = (dependencies as Record<string, unknown>).electron;
  if (typeof version !== 'string' || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version) || version.length > 64) throw invalid();
  const selector = join(requireWindowsElectronPath(join(desktop, 'node_modules'), true), 'electron');
  if (!lstatSync(selector).isSymbolicLink()) throw invalid();
  const target = requireWindowsElectronPath(resolve(dirname(selector), readlinkSync(selector)), true);
  if (!samePath(target, realpathSync.native(selector))) throw invalid();
  const store = requireWindowsElectronPath(join(repository, 'node_modules', '.pnpm'), true);
  requireWindowsElectronDescendant(target, store);
  const segments = relative(store, target).split(sep);
  if (segments.length !== 3 || segments[0] !== `electron@${version}` ||
    segments[1] !== 'node_modules' || segments[2] !== 'electron') throw invalid();
  const manifest = readManifest(join(target, 'package.json'));
  if (manifest.name !== 'electron' || manifest.version !== version) throw invalid();
  const selectorPath = requireWindowsElectronPath(join(target, 'path.txt'), false);
  if (lstatSync(selectorPath).size > 128 || readFileSync(selectorPath, 'utf8').trim() !== 'electron.exe') throw invalid();
  const application = requireWindowsElectronPath(join(desktop, 'e2e-dist'), true);
  const applicationManifest = readManifest(join(application, 'package.json'));
  if (applicationManifest.name !== 'eky-desktop-e2e' || applicationManifest.type !== 'module' ||
    applicationManifest.main !== 'e2e/electronE2eEntrypoint.js') throw invalid();
  requireWindowsElectronPath(join(application, 'e2e', 'electronE2eEntrypoint.js'), false);
  return requireWindowsElectronPath(join(target, 'dist', 'electron.exe'), false);
}

export function validateWindowsElectronServiceInput(input: {
  repositoryRoot: string; runRoot: string; runtimeRoot: string; runtimeConfigPath: string;
  environment: Readonly<Record<string, string>>;
}, osTempRoot: string): void {
  const temp = requireWindowsElectronPath(osTempRoot, true);
  const run = requireWindowsElectronPath(input.runRoot, true);
  const repository = requireWindowsElectronPath(input.repositoryRoot, true);
  if (!samePath(dirname(run), join(temp, 'eky-e2e')) || !basename(run).startsWith('run-')) throw invalid();
  // A valid run cannot be the repository or a parent/child of it.
  const overlaps = (parent: string, child: string) => {
    const path = relative(parent, child);
    return !isAbsolute(path) && path !== '..' && !path.startsWith(`..${sep}`);
  };
  if (overlaps(repository, run) || overlaps(run, repository)) throw invalid();
  const runtime = requireWindowsElectronPath(input.runtimeRoot, true);
  requireWindowsElectronDescendant(runtime, run);
  if (!samePath(input.runtimeConfigPath, join(runtime, 'electron-config.json'))) throw invalid();
  requireWindowsElectronPath(input.runtimeConfigPath, false);
  const profile = join(runtime, 'windows-profile');
  const expected = {
    EKY_E2E: '1', NODE_ENV: 'test', EKY_ELECTRON_E2E_CONFIG: input.runtimeConfigPath,
    EKY_ELECTRON_E2E_RUN_ROOT: runtime, HOME: profile, USERPROFILE: profile,
    TEMP: join(profile, 'Temp'), TMP: join(profile, 'Temp'),
    APPDATA: join(profile, 'AppData', 'Roaming'), LOCALAPPDATA: join(profile, 'AppData', 'Local'),
  };
  const allowed = [...Object.keys(expected), 'SystemRoot', 'WINDIR', 'PATH'];
  if (Object.keys(input.environment).some(key => !allowed.includes(key))) throw invalid();
  for (const [key, value] of Object.entries(expected)) {
    if (input.environment[key] !== value) throw invalid();
    if (key !== 'EKY_E2E' && key !== 'NODE_ENV') requireWindowsElectronPath(value, key !== 'EKY_ELECTRON_E2E_CONFIG');
  }
  for (const key of ['SystemRoot', 'WINDIR']) requireWindowsElectronPath(input.environment[key]!, true);
  for (const value of Object.values(input.environment)) {
    if (typeof value !== 'string' || value.length > 2048 || value.includes('\0')) {
      throw new Error('E2E_ELECTRON_OWNER_ENVIRONMENT_VALUE_INVALID');
    }
  }
  resolveWindowsElectronServiceExecutable(repository);
}
