import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

import {
  captureLinuxConsumerLossBuildInputs, linuxConsumerLossBuildPaths, verifyLinuxConsumerLossBuild,
} from './linuxConsumerLossBuild.mjs';

const rootRequire = createRequire(new URL('../../../../package.json', import.meta.url));
const ts = rootRequire('typescript');
const config = JSON.parse(readFileSync(new URL('./tsconfig.linux-consumer-loss.json', import.meta.url)));
const rejected = /^Error: E2E_LINUX_CONSUMER_BUILD_REJECTED$/u;

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'eky-consumer-build-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const paths = linuxConsumerLossBuildPaths(root);
  const write = (name, contents) => {
    mkdirSync(dirname(join(root, name)), { recursive: true });
    writeFileSync(join(root, name), contents);
  };
  const project = structuredClone(config);
  project.files = ['../../src/consumer.ts', './dependency.mjs'];
  const saveConfig = () => write('apps/e2e/experiments/processOwnership/tsconfig.linux-consumer-loss.json',
    JSON.stringify(project));
  write('apps/e2e/package.json', '{"type":"module"}');
  write('tsconfig.base.json', JSON.stringify({ compilerOptions: {
    target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler', strict: true,
  } }));
  write('apps/e2e/tsconfig.json', JSON.stringify({ extends: '../../tsconfig.base.json',
    compilerOptions: { noEmit: true, types: ['@playwright/test'] }, include: ['src', 'tests'] }));
  write('apps/e2e/src/consumer.ts', [
    "import type { Secret } from '../../../backend/secret.js';",
    "import { identity } from '../experiments/processOwnership/dependency.mjs';",
    'export const value: number = identity(42);',
  ].join('\n'));
  write('apps/e2e/experiments/processOwnership/dependency.mjs', 'export const identity = value => value;');
  write('apps/e2e/tests/unlisted.ts', 'export const notAnEntry = true;');
  write('apps/backend/secret.ts', 'export type Secret = string;');
  saveConfig();
  const emit = () => {
    const raw = ts.readConfigFile(paths.config, ts.sys.readFile).config;
    const parsed = ts.parseJsonConfigFileContent(raw, ts.sys, dirname(paths.config));
    assert.deepEqual(parsed.errors, []);
    const program = ts.createProgram(parsed.fileNames, parsed.options);
    const emitted = program.emit();
    assert.deepEqual(ts.getPreEmitDiagnostics(program), []);
    assert.equal(emitted.emitSkipped, false);
    assert.deepEqual(emitted.diagnostics, []);
  };
  const build = () => {
    const before = captureLinuxConsumerLossBuildInputs(root);
    emit();
    return { before, receipt: verifyLinuxConsumerLossBuild(root, before) };
  };
  return { root, paths, project, saveConfig, write, emit, build };
}

test('explicit tsc emission preserves JS specifiers and excludes type-only and inherited inputs', t => {
  const f = fixture(t);
  const { before, receipt } = f.build();
  assert.equal(receipt.fileCount, 2);
  assert.equal(receipt.sourceIdentity, before.sourceIdentity);
  assert.match(receipt.outputIdentity, /^[a-f0-9]{64}$/u);
  assert.ok(Object.isFrozen(before) && Object.isFrozen(receipt));
  assert.deepEqual(verifyLinuxConsumerLossBuild(f.root, receipt), receipt);
  const emitted = readFileSync(join(f.paths.output, 'src/consumer.js'), 'utf8');
  assert.ok(emitted.includes('../experiments/processOwnership/dependency.mjs'));
  assert.ok(!emitted.includes('Secret') && !emitted.includes('backend'));
  assert.ok(!JSON.stringify(receipt).includes(f.root));
});

test('capture rejects earlier output without deleting it', t => {
  const f = fixture(t);
  f.build();
  assert.throws(() => captureLinuxConsumerLossBuildInputs(f.root), rejected);
  assert.ok(readFileSync(join(f.paths.output, 'src/consumer.js')).length > 0);
});

for (const [name, mutate] of [
  ['missing emitted module', f => rmSync(join(f.paths.output, 'experiments/processOwnership/dependency.mjs'))],
  ['extra file', f => f.write('apps/e2e/.artifacts/linux-consumer-loss/stale.js', 'export {};')],
  ['extra directory', f => mkdirSync(join(f.paths.output, 'stale'))],
  ['changed output bytes', f => f.write('apps/e2e/.artifacts/linux-consumer-loss/src/consumer.js', 'export const changed = true;')],
  ['changed source', f => f.write('apps/e2e/src/consumer.ts', 'export const changed = true;')],
  ['changed base config', f => f.write('tsconfig.base.json', '{"compilerOptions":{"target":"ES2022","module":"ESNext"}}')],
  ['changed inherited config', f => f.write('apps/e2e/tsconfig.json', '{"extends":"../../tsconfig.base.json","compilerOptions":{"noEmit":true}}')],
  ['changed config bytes', f => writeFileSync(f.paths.config, readFileSync(f.paths.config, 'utf8') + '\n')],
]) {
  test(`receipt rejects ${name}`, t => {
    const f = fixture(t);
    const { receipt } = f.build();
    mutate(f);
    assert.throws(() => verifyLinuxConsumerLossBuild(f.root, receipt), rejected);
  });
}

test('source changes during compilation cannot receive a success receipt', t => {
  const f = fixture(t);
  const before = captureLinuxConsumerLossBuildInputs(f.root);
  f.emit();
  f.write('apps/e2e/src/consumer.ts', 'export const changed = true;');
  assert.throws(() => verifyLinuxConsumerLossBuild(f.root, before), rejected);
});

for (const [name, mutate] of [
  ['broad include', f => { f.project.include = ['../../src']; }],
  ['implicit input expansion', f => { f.project.compilerOptions.noResolve = false; }],
  ['relocated output', f => { f.project.compilerOptions.outDir = '../../other'; }],
  ['declaration output', f => { f.project.compilerOptions.declaration = true; }],
  ['source maps', f => { f.project.compilerOptions.sourceMap = true; }],
  ['duplicate entries', f => { f.project.files.push(f.project.files[0]); }],
  ['outside runtime source', f => { f.project.files.push('../../../backend/secret.ts'); }],
  ['missing source', f => { f.project.files.push('../../src/missing.ts'); }],
]) {
  test(`capture rejects ${name}`, t => {
    const f = fixture(t);
    mutate(f);
    f.saveConfig();
    assert.throws(() => captureLinuxConsumerLossBuildInputs(f.root), rejected);
  });
}

for (const [name, source] of [
  ['unlisted relative module', "import './unlisted.js';"],
  ['missing extension', "import '../experiments/processOwnership/dependency';"],
  ['outside relative module', "import '../../../../backend/secret.js';"],
  ['unapproved package', "import 'other-package';"],
  ['private Playwright entry', "import '@playwright/test/lib/test';"],
  ['nonexistent builtin', "import 'node:not-a-builtin';"],
  ['computed dynamic import', 'export const load = name => import(name);'],
  ['CommonJS require', "export const load = () => require('node:fs');"],
]) {
  test(`emitted closure rejects ${name}`, t => {
    const f = fixture(t);
    f.write('apps/e2e/src/consumer.ts', source);
    const before = captureLinuxConsumerLossBuildInputs(f.root);
    f.emit();
    assert.throws(() => verifyLinuxConsumerLossBuild(f.root, before), rejected);
  });
}

test('literal dynamic imports and re-exports must resolve within the explicit closure', t => {
  const f = fixture(t);
  f.write('apps/e2e/src/consumer.ts', [
    "export { identity } from '../experiments/processOwnership/dependency.mjs';",
    "export const load = () => import('../experiments/processOwnership/dependency.mjs');",
    "import 'node:fs';",
  ].join('\n'));
  assert.equal(f.build().receipt.fileCount, 2);
});

test('canonical manifest contains the actual consumers and canonical Playwright config without changing typecheck', () => {
  const selected = new Set(config.files);
  for (const name of ['isolatedBackendTest', 'isolatedWebTest', 'runOwnedChromiumWorker']) {
    assert.ok(selected.has(`../../src/fixtures/${name}.ts`));
  }
  for (const name of ['../../playwright.config.ts', '../../scripts/safeCiReporter.mjs',
    '../../scripts/safeCiOutputRelay.mjs', '../../src/fixtures/electronLaunchBudgets.ts',
    'linuxConsumerLossContract.mjs']) assert.ok(selected.has(name));
  assert.equal(selected.size, config.files.length);
  assert.deepEqual(config.include, []);
  const normal = JSON.parse(readFileSync(new URL('../../tsconfig.json', import.meta.url)));
  assert.equal(normal.compilerOptions.noEmit, true);
  assert.equal(normal.compilerOptions.noCheck, undefined);
  assert.deepEqual(normal.include, ['playwright.config.ts', 'playwright.first-start-diagnostic.config.ts', 'src', 'tests']);
});
