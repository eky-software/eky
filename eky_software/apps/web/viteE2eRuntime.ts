import { lstatSync, realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';

import type { ProxyOptions } from 'vite';

import { developmentBackendProxyPaths } from './src/app/developmentBackendProxy.js';

const e2eRootDirectoryName = 'eky-e2e';
const localRuntimeSessionHeaderName = 'x-eky-local-session';
const loopbackHost = '127.0.0.1';
const sessionSecretPattern = /^[A-Za-z0-9_-]{43}$/;

export interface E2eViteRuntimeConfig {
  backendOrigin: string;
  cacheDirectory: string;
  environmentDirectory: string;
  sessionSecret: string;
}

export function readE2eViteRuntimeConfig(
  environment: Readonly<Record<string, string | undefined>>,
): E2eViteRuntimeConfig | null {
  const hasE2eConfiguration = [
    environment.EKY_E2E_BACKEND_ORIGIN,
    environment.EKY_E2E_ENV_ROOT,
    environment.EKY_E2E_RUNTIME_SESSION,
  ].some((value) => value !== undefined);

  if (environment.EKY_E2E !== '1') {
    if (hasE2eConfiguration) {
      throw new Error('E2E Vite runtime marker is missing.');
    }
    return null;
  }

  const backendOrigin = requireLoopbackOrigin(
    environment.EKY_E2E_BACKEND_ORIGIN,
  );
  const environmentDirectory = requireE2eEnvironmentDirectory(
    environment.EKY_E2E_ENV_ROOT,
  );
  const sessionSecret = environment.EKY_E2E_RUNTIME_SESSION;
  if (
    sessionSecret === undefined ||
    !sessionSecretPattern.test(sessionSecret)
  ) {
    throw new Error('E2E Vite runtime session is invalid.');
  }

  return {
    backendOrigin,
    cacheDirectory: resolve(environmentDirectory, 'vite-cache'),
    environmentDirectory,
    sessionSecret,
  };
}

export function createE2eViteBackendProxy(
  config: E2eViteRuntimeConfig,
): Record<string, ProxyOptions> {
  return Object.fromEntries(
    developmentBackendProxyPaths.map((path) => [
      path,
      {
        changeOrigin: true,
        headers: {
          [localRuntimeSessionHeaderName]: config.sessionSecret,
        },
        target: config.backendOrigin,
      },
    ]),
  );
}

function requireLoopbackOrigin(value: string | undefined): string {
  if (value === undefined) {
    throw new Error('E2E Vite backend origin is missing.');
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('E2E Vite backend origin is invalid.');
  }

  if (
    url.protocol !== 'http:' ||
    url.hostname !== loopbackHost ||
    url.pathname !== '/' ||
    url.search !== '' ||
    url.hash !== '' ||
    url.port === ''
  ) {
    throw new Error('E2E Vite backend origin must use loopback HTTP.');
  }

  return url.origin;
}

function requireE2eEnvironmentDirectory(value: string | undefined): string {
  if (value === undefined || !isAbsolute(value)) {
    throw new Error('E2E Vite environment root is invalid.');
  }

  const allowedRoot = realpathSync(resolve(tmpdir(), e2eRootDirectoryName));
  const stats = lstatSync(value);
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new Error('E2E Vite environment root must be a regular directory.');
  }

  const environmentDirectory = realpathSync(value);
  const relativePath = relative(allowedRoot, environmentDirectory);
  if (
    relativePath === '' ||
    relativePath === '..' ||
    relativePath.startsWith(`..${sep}`)
  ) {
    throw new Error('E2E Vite environment root escapes its allowed root.');
  }

  return environmentDirectory;
}
