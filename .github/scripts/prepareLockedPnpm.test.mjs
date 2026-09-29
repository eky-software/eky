import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { bundledNpmPath, isolatedNpmEnvironment, safeCommandFailure, validateBootstrap } from './lockedPnpmContract.mjs';
import { prepareLockedPnpm, runNodeCommand } from './prepareLockedPnpm.mjs';

const read = url => JSON.parse(readFileSync(new URL(url, import.meta.url), 'utf8'));
const manifest = read('../bootstrap/pnpm/package.json');
const lock = read('../bootstrap/pnpm/package-lock.json');
const project = read('../../eky_software/package.json');
const expected = validateBootstrap(project, manifest, lock);
const writeJson = (file, value) => writeFileSync(file, JSON.stringify(value));

test('the committed isolated lock follows the root exact package manager pin', () => {
  assert.equal(expected.version, project.packageManager.slice('pnpm@'.length));
});

for (const [name, mutate] of [
  ['version range', value => { value.project.packageManager = 'pnpm@^11.1.3'; }],
  ['different root pin', value => { value.project.packageManager = 'pnpm@11.1.4'; }],
  ['manifest script', value => { value.manifest.scripts = { install: 'example' }; }],
  ['extra dependency', value => { value.manifest.dependencies.other = '1.0.0'; }],
  ['extra locked package', value => { value.lock.packages['node_modules/other'] = {}; }],
  ['HTTP tarball', value => { value.lock.packages['node_modules/pnpm'].resolved = 'http://registry.npmjs.org/pnpm/-/pnpm-11.1.3.tgz'; }],
  ['missing digest', value => { delete value.lock.packages['node_modules/pnpm'].integrity; }],
  ['dependency link', value => { value.lock.packages['node_modules/pnpm'].link = true; }],
  ['unexpected bin', value => { value.lock.packages['node_modules/pnpm'].bin.pnpm = '../other.mjs'; }],
]) {
  test(`rejects ${name} before installing`, () => {
    const value = structuredClone({ project, manifest, lock });
    mutate(value);
    assert.throws(() => validateBootstrap(value.project, value.manifest, value.lock), /CI_PNPM_/);
  });
}

test('npm comes from the selected Node distribution, not PATH', () => {
  assert.equal(bundledNpmPath('C:\\Node\\node.exe', 'win32'), 'C:\\Node\\node_modules\\npm\\bin\\npm-cli.js');
  assert.equal(bundledNpmPath('/opt/node/bin/node', 'linux'), '/opt/node/lib/node_modules/npm/bin/npm-cli.js');
});

test('caller package manager and Node configuration cannot weaken verification or inject code', () => {
  assert.deepEqual(isolatedNpmEnvironment({
    PATH: 'trusted', HOME: 'home', npm_config_registry: 'http://example.invalid',
    NPM_CONFIG_STRICT_SSL: 'false', npm_config_omit: 'prod', NODE_OPTIONS: '--require=example',
    NODE_TLS_REJECT_UNAUTHORIZED: '0', NODE_EXTRA_CA_CERTS: 'example',
    NPM_TOKEN: 'secret', PNPM_HOME: 'other', COREPACK_INTEGRITY_KEYS: '0',
  }), { PATH: 'trusted', HOME: 'home' });
});

function fixture(t, failure) {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'eky-pnpm-contract-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const root = path.join(directory, 'repository');
  const bootstrap = path.join(root, '.github/bootstrap/pnpm');
  const runnerTemp = path.join(directory, 'runner');
  const githubPath = path.join(directory, 'github-path');
  mkdirSync(bootstrap, { recursive: true });
  mkdirSync(path.join(root, 'eky_software'));
  mkdirSync(runnerTemp);
  writeJson(path.join(root, 'eky_software/package.json'), project);
  writeJson(path.join(bootstrap, 'package.json'), manifest);
  copyFileSync(new URL('../bootstrap/pnpm/package-lock.json', import.meta.url), path.join(bootstrap, 'package-lock.json'));
  writeFileSync(githubPath, '');
  const commands = [];
  const phases = [];
  const run = (args, options) => {
    commands.push(args);
    assert.equal(readFileSync(githubPath, 'utf8'), '');
    assert.equal(options.env.NODE_OPTIONS, undefined);
    const command = args[1];
    if (command === failure) throw new Error('CI_PNPM_COMMAND_FAILED');
    if (command === 'ci') {
      const modules = path.join(options.cwd, 'node_modules');
      mkdirSync(path.join(modules, 'pnpm'), { recursive: true });
      mkdirSync(path.join(modules, '.bin'));
      writeJson(path.join(modules, 'pnpm/package.json'), {
        name: 'pnpm', version: failure === 'installed-version' ? '0.0.1' : expected.version,
        bin: { pnpm: 'bin/pnpm.mjs' },
      });
      const installed = { lockfileVersion: 3, packages: { 'node_modules/pnpm': structuredClone(lock.packages['node_modules/pnpm']) } };
      if (failure === 'installed-integrity') installed.packages['node_modules/pnpm'].integrity = 'other';
      if (failure === 'extra-installed-package') installed.packages['node_modules/other'] = {};
      writeJson(path.join(modules, '.package-lock.json'), installed);
      if (failure === 'lock-mutation') writeFileSync(path.join(options.cwd, 'package-lock.json'), '{}');
      return '';
    }
    if (command === 'audit') {
      if (failure === 'malformed-audit') return '{}';
      if (failure === 'invalid-signature') return '{"invalid":[{}],"missing":[]}';
      if (failure === 'missing-signature') return '{"invalid":[],"missing":[{}]}';
      return '{"invalid":[],"missing":[]}';
    }
    if (command === 'view') {
      const metadata = { name: 'pnpm', version: expected.version, dist: {
        integrity: expected.integrity, tarball: expected.tarball,
        signatures: [{ keyid: 'test-key', sig: 'test-signature' }],
      } };
      if (failure === 'cached-identity') metadata.name = 'other';
      if (failure === 'cached-integrity') metadata.dist.integrity = 'other';
      if (failure === 'cached-tarball') metadata.dist.tarball = 'https://example.invalid/tool';
      if (failure === 'cached-signature') metadata.dist.signatures = [];
      if (failure === 'truncated-metadata') return '{';
      return JSON.stringify(metadata);
    }
    assert.equal(command, '--version');
    assert.ok(args[0].endsWith(path.join('pnpm', 'bin', 'pnpm.mjs')));
    return failure === 'executed-version' ? '0.0.1\n' : `${expected.version}\n`;
  };
  return {
    options: { root, runnerTemp, githubPath, environment: { ...process.env, NODE_OPTIONS: 'untrusted' }, run, report: phase => phases.push(phase) },
    commands, phases, githubPath,
  };
}

test('only publishes the isolated bin after locked install, audit, offline binding and exact version', t => {
  const f = fixture(t);
  const result = prepareLockedPnpm(f.options);
  assert.deepEqual(f.commands.map(args => args[1]), ['ci', 'audit', 'view', '--version']);
  const npmCommands = f.commands.slice(0, 3);
  for (const command of npmCommands) {
    for (const option of ['--ignore-scripts', '--no-audit', '--fetch-retries=0', '--strict-ssl=true',
      '--registry=https://registry.npmjs.org/']) {
      assert.ok(command.includes(option));
    }
    // This standalone manifest has no workspaces. npm's --workspaces=false
    // signature filter can exclude the root dependency edge entirely.
    assert.ok(command.every(value => !/^--(?:workspace|workspaces|omit)(?:=|$)/.test(value)));
  }
  assert.ok(f.commands[0].includes(`--cache=${path.join(result.stage, 'install-cache')}`));
  for (const command of f.commands.slice(1, 3)) {
    assert.ok(command.includes(`--cache=${path.join(result.stage, 'verification-cache')}`));
  }
  assert.ok(f.commands[1].includes('--prefer-online'));
  assert.ok(!f.commands[1].includes('--offline'));
  assert.ok(f.commands[2].includes('--offline'));
  assert.equal(readFileSync(f.githubPath, 'utf8'), `${result.bin}\n`);
  assert.equal(f.phases.at(-1), 'ready');
});

for (const failure of ['ci', 'audit', 'view', 'malformed-audit', 'invalid-signature',
  'missing-signature', 'cached-identity', 'cached-integrity', 'cached-tarball',
  'cached-signature', 'truncated-metadata', 'installed-version', 'installed-integrity',
  'extra-installed-package', 'lock-mutation', 'executed-version']) {
  test(`${failure} fails closed with no publication, fallback or retry`, t => {
    const f = fixture(t, failure);
    assert.throws(() => prepareLockedPnpm(f.options));
    assert.equal(readFileSync(f.githubPath, 'utf8'), '');
    assert.ok(!f.phases.includes('ready'));
    assert.equal(new Set(f.commands.map(args => args[1])).size, f.commands.length);
    assert.equal(f.commands.some(args => args[1] === '--version'), failure === 'executed-version');
  });
}

test('refuses a staging directory inside the checkout', t => {
  const f = fixture(t);
  assert.throws(() => prepareLockedPnpm({ ...f.options, runnerTemp: f.options.root }), /TEMP_INSIDE_CHECKOUT/);
  assert.equal(f.commands.length, 0);
});

test('real command adapter rejects nonzero exit without forwarding raw diagnostic data', () => {
  assert.throws(() => runNodeCommand(['-e', 'console.error("private-example"); process.exit(23)'], {}),
    { message: 'CI_PNPM_COMMAND_FAILED' });
});

test('command diagnostics expose only a numeric status and an allowlisted failure code', () => {
  assert.deepEqual(safeCommandFailure({ status: 1, stdout: JSON.stringify({
    error: { code: 'EINTEGRITY', summary: 'private-example', detail: 'private-example' },
  }) }), { exitCode: 1, npmCode: 'EINTEGRITY' });
  for (const stdout of ['private-example', '{', '{"error":{"code":"PRIVATE_EXAMPLE"}}', '{}']) {
    assert.deepEqual(safeCommandFailure({ status: null, stdout }), { exitCode: null, npmCode: 'unclassified' });
  }
});
