import assert from 'node:assert/strict';
import path from 'node:path';

export const registry = 'https://registry.npmjs.org/';
const npmErrorCodes = new Set([
  'EAI_AGAIN', 'ENOTFOUND', 'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT',
  'EINTEGRITY', 'EINTEGRITYSIGNATURE', 'EEXPIREDSIGNATUREKEY',
  'EATTESTATIONVERIFY', 'ENOTCACHED', 'EUSAGE', 'E401', 'E403', 'E404',
]);

export function safeCommandFailure(result) {
  let npmCode = 'unclassified';
  try {
    const code = JSON.parse(result.stdout).error?.code;
    if (npmErrorCodes.has(code)) npmCode = code;
  } catch {}
  return {
    exitCode: Number.isInteger(result.status) ? result.status : null,
    npmCode,
  };
}

function requireValue(condition, code) {
  if (!condition) throw new Error(`CI_PNPM_${code}`);
}

export function validateBootstrap(project, manifest, lock) {
  const match = /^pnpm@(\d+\.\d+\.\d+)$/.exec(project.packageManager ?? '');
  requireValue(match, 'PROJECT_VERSION_INVALID');
  const version = match[1];
  const dependencies = { pnpm: version };
  try {
    assert.deepEqual(manifest, {
      name: 'eky-ci-pnpm-bootstrap', version: '1.0.0', private: true, dependencies,
    });
    assert.deepEqual(Object.keys(lock.packages).sort(), ['', 'node_modules/pnpm']);
    assert.deepEqual(lock.packages[''], {
      name: manifest.name, version: manifest.version, dependencies,
    });
  } catch {
    throw new Error('CI_PNPM_BOOTSTRAP_MANIFEST_INVALID');
  }
  requireValue(lock.lockfileVersion === 3 && lock.name === manifest.name &&
    lock.version === manifest.version, 'LOCK_INVALID');
  const entry = lock.packages['node_modules/pnpm'];
  const tarball = `${registry}pnpm/-/pnpm-${version}.tgz`;
  requireValue(entry.version === version && entry.resolved === tarball &&
    !entry.link && !entry.hasInstallScript &&
    Object.keys(entry.dependencies ?? {}).length === 0 &&
    Object.keys(entry.optionalDependencies ?? {}).length === 0 &&
    /^sha512-[A-Za-z0-9+/]{86}==$/.test(entry.integrity ?? ''), 'LOCK_INVALID');
  requireValue(entry.bin?.pnpm === 'bin/pnpm.mjs', 'BIN_INVALID');
  return { version, integrity: entry.integrity, tarball };
}

export function validateSignatureResult(result) {
  requireValue(result && !result.error && Array.isArray(result.invalid) &&
    Array.isArray(result.missing) && result.invalid.length === 0 &&
    result.missing.length === 0, 'SIGNATURES_INVALID');
}

export function validateVulnerabilityResult(result) {
  requireValue(result?.auditReportVersion === 2 && !Object.hasOwn(result, 'error'),
    'VULNERABILITY_AUDIT_INVALID');
  try {
    assert.deepEqual(result.vulnerabilities, {});
    assert.deepEqual(result.metadata.vulnerabilities, {
      info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: 0,
    });
    // npm counts the manifest root in prod, but not in the dependency total.
    // An empty or filtered report must not approve this single-package lock.
    assert.deepEqual(result.metadata.dependencies, {
      prod: 2, dev: 0, optional: 0, peer: 0, peerOptional: 0, total: 1,
    });
  } catch {
    throw new Error('CI_PNPM_VULNERABILITY_AUDIT_INVALID');
  }
}

// npm's signature verifier authenticates registry metadata, not the installed
// lockfile. Bind its cached full metadata to our immutable install digest too.
export function validateSignedMetadata(metadata, expected) {
  requireValue(metadata?.name === 'pnpm' && metadata.version === expected.version,
    'METADATA_IDENTITY_INVALID');
  const dist = metadata.dist;
  requireValue(dist?.integrity === expected.integrity && dist.tarball === expected.tarball,
    'METADATA_INTEGRITY_INVALID');
  requireValue(Array.isArray(dist.signatures) && dist.signatures.length > 0 &&
    dist.signatures.every(item => typeof item.keyid === 'string' && item.keyid.length > 0 &&
      typeof item.sig === 'string' && item.sig.length > 0), 'SIGNATURES_MISSING');
}

export function validateInstalledPackage(installed, installedLock, expected) {
  requireValue(installed.name === 'pnpm' && installed.version === expected.version &&
    installed.bin?.pnpm === 'bin/pnpm.mjs' &&
    Object.keys(installed.dependencies ?? {}).length === 0 &&
    Object.keys(installed.optionalDependencies ?? {}).length === 0, 'INSTALLED_PACKAGE_INVALID');
  const packages = installedLock.packages;
  requireValue(packages && Object.keys(packages).length === 1 &&
    packages['node_modules/pnpm']?.version === expected.version &&
    packages['node_modules/pnpm'].integrity === expected.integrity &&
    packages['node_modules/pnpm'].resolved === expected.tarball, 'INSTALLED_LOCK_INVALID');
}

export function bundledNpmPath(nodeExecutable, platform = process.platform) {
  const paths = platform === 'win32' ? path.win32 : path.posix;
  return platform === 'win32'
    ? paths.join(paths.dirname(nodeExecutable), 'node_modules/npm/bin/npm-cli.js')
    : paths.resolve(paths.dirname(nodeExecutable), '../lib/node_modules/npm/bin/npm-cli.js');
}

export function isolatedNpmEnvironment(environment) {
  return Object.fromEntries(Object.entries(environment).filter(([key]) =>
    !/^(npm_config_|npm_|node_|corepack_|pnpm_)/i.test(key)));
}

export function npmArguments(stageRoot, verification) {
  return [
    '--ignore-scripts', '--no-audit', '--no-fund', '--fetch-retries=0',
    `--registry=${registry}`, '--strict-ssl=true',
    '--update-notifier=false', '--color=false',
    `--cache=${path.join(stageRoot, verification ? 'verification-cache' : 'install-cache')}`,
    `--userconfig=${path.join(stageRoot, 'user.npmrc')}`,
    `--globalconfig=${path.join(stageRoot, 'global.npmrc')}`,
  ];
}
