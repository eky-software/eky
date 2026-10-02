import { spawnSync } from 'node:child_process';
import { appendFileSync, copyFileSync, existsSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  bundledNpmPath, isolatedNpmEnvironment, npmArguments, safeCommandFailure, validateBootstrap,
  validateInstalledPackage, validateSignatureResult, validateSignedMetadata,
} from './lockedPnpmContract.mjs';

const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url));
const readJson = file => JSON.parse(readFileSync(file, 'utf8'));

export function runNodeCommand(args, options) {
  const result = spawnSync(process.execPath, args, {
    ...options, shell: false, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024,
  });
  if (result.error || result.signal || result.status !== 0) {
    // Do not copy tool stderr, environment, cache paths or registry credentials
    // into public CI diagnostics. The owning phase remains visible on failure.
    const error = new Error('CI_PNPM_COMMAND_FAILED');
    error.commandFailure = safeCommandFailure(result);
    throw error;
  }
  return result.stdout;
}

export function prepareLockedPnpm({
  root = repositoryRoot,
  runnerTemp = process.env.RUNNER_TEMP,
  githubPath = process.env.GITHUB_PATH,
  environment = process.env,
  run = runNodeCommand,
  report = phase => console.log(JSON.stringify({ operation: 'prepareLockedPnpm', phase })),
} = {}) {
  if (!runnerTemp || !githubPath || /[\r\n]/.test(runnerTemp + githubPath) ||
      !path.isAbsolute(runnerTemp) || !path.isAbsolute(githubPath)) {
    throw new Error('CI_PNPM_RUN_PATHS_INVALID');
  }
  const relativeTemp = path.relative(realpathSync(root), realpathSync(runnerTemp));
  if (!relativeTemp || (!relativeTemp.startsWith(`..${path.sep}`) &&
      relativeTemp !== '..' && !path.isAbsolute(relativeTemp))) {
    throw new Error('CI_PNPM_TEMP_INSIDE_CHECKOUT');
  }
  if (!existsSync(githubPath)) throw new Error('CI_PNPM_PATH_FILE_MISSING');
  report('validate-lock');
  const bootstrap = path.join(root, '.github/bootstrap/pnpm');
  const manifest = readJson(path.join(bootstrap, 'package.json'));
  const lockPath = path.join(bootstrap, 'package-lock.json');
  const lockText = readFileSync(lockPath, 'utf8');
  const expected = validateBootstrap(readJson(path.join(root, 'eky_software/package.json')),
    manifest, JSON.parse(lockText));
  const npm = bundledNpmPath(process.execPath);
  if (!existsSync(npm)) throw new Error('CI_PNPM_BUNDLED_NPM_MISSING');

  const stage = mkdtempSync(path.join(runnerTemp, 'eky-pnpm-'));
  for (const name of ['package.json', 'package-lock.json']) {
    copyFileSync(path.join(bootstrap, name), path.join(stage, name));
  }
  for (const name of ['user.npmrc', 'global.npmrc', '.npmrc']) {
    writeFileSync(path.join(stage, name), '');
  }
  const options = { cwd: stage, env: isolatedNpmEnvironment(environment) };
  const npmRun = (args, verification = true) =>
    run([npm, ...args, ...npmArguments(stage, verification)], options);

  report('install-locked-tool');
  npmRun(['ci', '--json'], false);
  report('verify-registry-signatures');
  validateSignatureResult(JSON.parse(npmRun(['audit', 'signatures', '--json', '--prefer-online'])));
  report('bind-signed-integrity');
  // Audit fetched and verified the full packument in this private cache. Read
  // that same snapshot offline, never a second online metadata response. The
  // online audit also verifies any separately fetched registry attestations.
  validateSignedMetadata(JSON.parse(npmRun([
    'view', `pnpm@${expected.version}`, 'name', 'version', 'dist', '--json', '--offline',
  ])), expected);

  report('verify-installed-tool');
  validateInstalledPackage(readJson(path.join(stage, 'node_modules/pnpm/package.json')),
    readJson(path.join(stage, 'node_modules/.package-lock.json')), expected);
  if (readFileSync(path.join(stage, 'package-lock.json'), 'utf8') !== lockText) {
    throw new Error('CI_PNPM_LOCK_MUTATED');
  }
  const executable = path.join(stage, 'node_modules/pnpm/bin/pnpm.mjs');
  const actual = run([executable, '--version'], options).trim();
  if (actual !== expected.version) throw new Error('CI_PNPM_VERSION_MISMATCH');
  const bin = path.join(stage, 'node_modules/.bin');
  if (!existsSync(bin)) throw new Error('CI_PNPM_BIN_MISSING');
  appendFileSync(githubPath, `${bin}\n`, 'utf8');
  report('ready');
  return { stage, bin, version: actual };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    prepareLockedPnpm();
  } catch (error) {
    const code = /^CI_PNPM_[A-Z_]+$/.test(error?.message ?? '')
      ? error.message : 'CI_PNPM_PREPARATION_FAILED';
    console.error(JSON.stringify({ operation: 'prepareLockedPnpm', errorCode: code,
      ...(error?.commandFailure ?? {}) }));
    process.exitCode = 1;
  }
}
