import {
  lstatSync,
  readFileSync,
  realpathSync,
} from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';

export type E2eSmtpOutcome =
  | 'connectionFailed'
  | 'tlsFailed'
  | 'authenticationFailed'
  | 'deliveryFailed'
  | 'outcomeUnknown';

export type E2eFaultPlan =
  | { kind: 'none' }
  | { kind: 'smtp'; outcome: E2eSmtpOutcome }
  | { kind: 'pdfStorageWriteFailed' }
  | { kind: 'operationalLogWriteFailed' }
  | {
      failOnCall: number;
      kind: 'databaseWriteFailed';
      operation:
        | 'approveInvoice'
        | 'markInvoicePaidEvent'
        | 'updateCompanySettings'
        | 'updateCustomer';
    };

export interface E2eBackendConfig {
  backend: {
    host: '127.0.0.1';
    port: number;
    sessionSecret: string;
  };
  faultPlan: E2eFaultPlan;
  formatVersion: 1;
  marker: 'EKY_E2E';
  paths: {
    artifactsRoot: string;
    databaseFilePath: string;
    documentsRoot: string;
    incidentsRoot: string;
    logsRoot: string;
    supportBundlesRoot: string;
    tempRoot: string;
  };
  runtimeRoot: string;
  scenarioId: string;
  smtpAdapter: 'fake';
}

const configSizeLimitBytes = 32 * 1024;
const scenarioIdPattern = /^[A-Z][A-Z0-9-]{2,63}$/;
const sessionSecretPattern = /^[A-Za-z0-9_-]{43}$/;

export function readE2eBackendConfig(
  configPath: string,
  environment: Readonly<Record<string, string | undefined>> = process.env,
): E2eBackendConfig {
  if (environment.EKY_E2E !== '1') {
    throw new Error('E2E backend marker is missing.');
  }
  if (!isAbsolute(configPath)) {
    throw new Error('E2E backend config path must be absolute.');
  }
  const configStats = lstatSync(configPath);
  if (!configStats.isFile() || configStats.isSymbolicLink()) {
    throw new Error('E2E backend config must be a regular file.');
  }
  if (configStats.size > configSizeLimitBytes) {
    throw new Error('E2E backend config is too large.');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(configPath, 'utf8'));
  } catch {
    throw new Error('E2E backend config is invalid.');
  }
  const config = parseE2eBackendConfig(parsed);
  assertRuntimePaths(config, configPath, environment);

  return config;
}

function parseE2eBackendConfig(value: unknown): E2eBackendConfig {
  const root = requireRecord(value, 'config');
  requireExactKeys(root, [
    'backend',
    'faultPlan',
    'formatVersion',
    'marker',
    'paths',
    'runtimeRoot',
    'scenarioId',
    'smtpAdapter',
  ]);
  if (root.formatVersion !== 1 || root.marker !== 'EKY_E2E') {
    throw new Error('E2E backend config identity is invalid.');
  }
  if (
    typeof root.scenarioId !== 'string' ||
    !scenarioIdPattern.test(root.scenarioId)
  ) {
    throw new Error('E2E backend scenario id is invalid.');
  }
  if (root.smtpAdapter !== 'fake') {
    throw new Error('E2E backend requires the fake SMTP adapter.');
  }

  const backend = requireRecord(root.backend, 'backend');
  requireExactKeys(backend, ['host', 'port', 'sessionSecret']);
  if (backend.host !== '127.0.0.1') {
    throw new Error('E2E backend host must use IPv4 loopback.');
  }
  if (
    typeof backend.port !== 'number' ||
    !Number.isSafeInteger(backend.port) ||
    backend.port < 1 ||
    backend.port > 65_535
  ) {
    throw new Error('E2E backend port is invalid.');
  }
  if (
    typeof backend.sessionSecret !== 'string' ||
    !sessionSecretPattern.test(backend.sessionSecret)
  ) {
    throw new Error('E2E backend session is invalid.');
  }

  const paths = requireRecord(root.paths, 'paths');
  const pathKeys = [
    'artifactsRoot',
    'databaseFilePath',
    'documentsRoot',
    'incidentsRoot',
    'logsRoot',
    'supportBundlesRoot',
    'tempRoot',
  ] as const;
  requireExactKeys(paths, pathKeys);
  const parsedPaths = {
    artifactsRoot: requireAbsolutePath(paths.artifactsRoot, 'artifactsRoot'),
    databaseFilePath: requireAbsolutePath(
      paths.databaseFilePath,
      'databaseFilePath',
    ),
    documentsRoot: requireAbsolutePath(paths.documentsRoot, 'documentsRoot'),
    incidentsRoot: requireAbsolutePath(paths.incidentsRoot, 'incidentsRoot'),
    logsRoot: requireAbsolutePath(paths.logsRoot, 'logsRoot'),
    supportBundlesRoot: requireAbsolutePath(
      paths.supportBundlesRoot,
      'supportBundlesRoot',
    ),
    tempRoot: requireAbsolutePath(paths.tempRoot, 'tempRoot'),
  };
  const runtimeRoot = requireAbsolutePath(root.runtimeRoot, 'runtime root');

  return {
    backend: {
      host: backend.host,
      port: backend.port,
      sessionSecret: backend.sessionSecret,
    },
    faultPlan: parseFaultPlan(root.faultPlan),
    formatVersion: 1,
    marker: 'EKY_E2E',
    paths: parsedPaths,
    runtimeRoot,
    scenarioId: root.scenarioId,
    smtpAdapter: 'fake',
  };
}

function requireAbsolutePath(value: unknown, name: string): string {
  if (typeof value !== 'string' || !isAbsolute(value)) {
    throw new Error(`E2E backend ${name} is invalid.`);
  }
  return value;
}

function parseFaultPlan(value: unknown): E2eFaultPlan {
  const fault = requireRecord(value, 'faultPlan');
  if (fault.kind === 'none') {
    requireExactKeys(fault, ['kind']);
    return { kind: 'none' };
  }
  if (fault.kind === 'smtp') {
    requireExactKeys(fault, ['kind', 'outcome']);
    if (
      fault.outcome !== 'connectionFailed' &&
      fault.outcome !== 'tlsFailed' &&
      fault.outcome !== 'authenticationFailed' &&
      fault.outcome !== 'deliveryFailed' &&
      fault.outcome !== 'outcomeUnknown'
    ) {
      throw new Error('E2E SMTP fault outcome is invalid.');
    }
    return { kind: 'smtp', outcome: fault.outcome };
  }
  if (
    fault.kind === 'pdfStorageWriteFailed' ||
    fault.kind === 'operationalLogWriteFailed'
  ) {
    requireExactKeys(fault, ['kind']);
    return { kind: fault.kind };
  }
  if (fault.kind === 'databaseWriteFailed') {
    requireExactKeys(fault, ['failOnCall', 'kind', 'operation']);
    if (
      fault.operation !== 'approveInvoice' &&
      fault.operation !== 'markInvoicePaidEvent' &&
      fault.operation !== 'updateCompanySettings' &&
      fault.operation !== 'updateCustomer'
    ) {
      throw new Error('E2E database fault operation is invalid.');
    }
    if (
      typeof fault.failOnCall !== 'number' ||
      !Number.isSafeInteger(fault.failOnCall) ||
      fault.failOnCall < 1 ||
      fault.failOnCall > 100
    ) {
      throw new Error('E2E database fault call number is invalid.');
    }
    return {
      failOnCall: fault.failOnCall,
      kind: 'databaseWriteFailed',
      operation: fault.operation,
    };
  }

  throw new Error('E2E fault plan is invalid.');
}

function assertRuntimePaths(
  config: E2eBackendConfig,
  configPath: string,
  environment: Readonly<Record<string, string | undefined>>,
): void {
  const runtimeRoot = requireRealDirectory(config.runtimeRoot);
  const electronRuntimeRoot = environment.EKY_ELECTRON_E2E_RUN_ROOT;
  if (electronRuntimeRoot === undefined) {
    const allowedTempRoot = realpathSync(resolve(tmpdir(), 'eky-e2e'));
    assertDescendant(runtimeRoot, allowedTempRoot, false);
  } else if (
    !isAbsolute(electronRuntimeRoot) ||
    requireRealDirectory(electronRuntimeRoot) !== runtimeRoot
  ) {
    throw new Error('E2E backend runtime root is invalid.');
  }
  assertDescendant(realpathSync(configPath), runtimeRoot, true);

  for (const path of [
    config.paths.artifactsRoot,
    dirname(config.paths.databaseFilePath),
    config.paths.documentsRoot,
    config.paths.incidentsRoot,
    config.paths.logsRoot,
    config.paths.supportBundlesRoot,
    config.paths.tempRoot,
  ]) {
    const realPath = requireRealDirectory(path);
    assertDescendant(realPath, runtimeRoot, false);
    assertNoSymbolicLinkSegments(runtimeRoot, realPath);
  }
}

function requireRealDirectory(path: string): string {
  const stats = lstatSync(path);
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new Error('E2E runtime path must be a regular directory.');
  }
  return realpathSync(path);
}

function assertDescendant(
  candidate: string,
  root: string,
  allowSame: boolean,
): void {
  const relativePath = relative(root, candidate);
  if (
    (allowSame && relativePath === '') ||
    (relativePath !== '' &&
      relativePath !== '..' &&
      !relativePath.startsWith(`..${sep}`))
  ) {
    return;
  }
  throw new Error('E2E runtime path escapes its allowed root.');
}

function assertNoSymbolicLinkSegments(root: string, candidate: string): void {
  let current = root;
  for (const segment of relative(root, candidate).split(sep).filter(Boolean)) {
    current = resolve(current, segment);
    if (lstatSync(current).isSymbolicLink()) {
      throw new Error('E2E runtime path must not contain symbolic links.');
    }
  }
}

function requireRecord(
  value: unknown,
  name: string,
): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`E2E backend ${name} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function requireExactKeys(
  value: Record<string, unknown>,
  allowedKeys: readonly string[],
): void {
  const allowed = new Set(allowedKeys);
  if (
    Object.keys(value).length !== allowed.size ||
    Object.keys(value).some((key) => !allowed.has(key))
  ) {
    throw new Error('E2E backend config contains unknown or missing fields.');
  }
}
