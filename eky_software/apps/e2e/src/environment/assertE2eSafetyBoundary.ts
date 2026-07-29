import { lstatSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';

import type { E2eSafetyBoundaryInput } from './e2eEnvironmentTypes.js';

const loopbackHost = '127.0.0.1';

export function assertE2eSafetyBoundary(
  input: E2eSafetyBoundaryInput,
): void {
  if (input.environment.EKY_E2E !== '1') {
    throw new Error('E2E runtime marker is missing.');
  }
  if (input.backendHost !== loopbackHost || input.webHost !== loopbackHost) {
    throw new Error('E2E hosts must use the IPv4 loopback address.');
  }
  if (input.smtpAdapter !== 'fake') {
    throw new Error('E2E runtime requires the fake SMTP adapter.');
  }

  const runRoot = requireSafeRoot(input.runRoot);
  for (const path of listRuntimePaths(input.paths)) {
    assertPathUnderRoot(path, runRoot);
  }

  if (input.productionUserDataPath !== undefined) {
    const productionRoot = normalizePath(input.productionUserDataPath);
    for (const path of listRuntimePaths(input.paths)) {
      const candidate = normalizePath(path);
      if (
        candidate === productionRoot ||
        candidate.startsWith(`${productionRoot}${sep}`)
      ) {
        throw new Error('E2E path points to production user data.');
      }
    }
  }

  for (const rawUrl of input.urls) {
    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      throw new Error('E2E URL is invalid.');
    }
    if (
      (url.protocol !== 'http:' && url.protocol !== 'https:') ||
      url.hostname !== loopbackHost
    ) {
      throw new Error('E2E URL must use an allowed loopback origin.');
    }
  }
}

function listRuntimePaths(
  paths: E2eSafetyBoundaryInput['paths'],
): readonly string[] {
  return [
    paths.artifactsRoot,
    dirname(paths.databaseFilePath),
    paths.documentsRoot,
    paths.incidentsRoot,
    paths.logsRoot,
    dirname(paths.runtimeConfigPath),
    paths.supportBundlesRoot,
    paths.tempRoot,
    paths.workerRoot,
  ];
}

function requireSafeRoot(path: string): string {
  if (!isAbsolute(path)) {
    throw new Error('E2E run root must be absolute.');
  }
  const resolvedRoot = resolve(path);
  if (lstatSync(resolvedRoot).isSymbolicLink()) {
    throw new Error('E2E run root must not be a symbolic link.');
  }
  return realpathSync(resolvedRoot);
}

export function assertPathUnderRoot(path: string, root: string): void {
  if (!isAbsolute(path)) {
    throw new Error('E2E runtime path must be absolute.');
  }

  const candidate = realpathSync(path);
  const relativePath = relative(root, candidate);
  if (
    relativePath === '' ||
    (!relativePath.startsWith(`..${sep}`) && relativePath !== '..')
  ) {
    assertNoSymbolicLinks(root, candidate);
    return;
  }

  throw new Error('E2E runtime path escapes its run root.');
}

function assertNoSymbolicLinks(root: string, candidate: string): void {
  const relativePath = relative(root, candidate);
  let currentPath = root;
  for (const segment of relativePath.split(sep).filter(Boolean)) {
    currentPath = resolve(currentPath, segment);
    if (lstatSync(currentPath).isSymbolicLink()) {
      throw new Error('E2E runtime path must not contain symbolic links.');
    }
  }
}

function normalizePath(path: string): string {
  return resolve(path).toLocaleLowerCase('en-US');
}
