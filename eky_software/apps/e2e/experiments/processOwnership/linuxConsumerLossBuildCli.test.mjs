import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import fs from 'node:fs';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  buildLinuxConsumerLoss, linuxConsumerLossBuildReceiptPath, runLinuxConsumerLossBuildCli,
} from './linuxConsumerLossBuildCli.mjs';
import { linuxConsumerLossBuildPaths, verifyLinuxConsumerLossBuild } from './linuxConsumerLossBuild.mjs';

const rootRequire = createRequire(new URL('../../../../package.json', import.meta.url));
const ts = rootRequire('typescript');
const configuration = JSON.parse(fs.readFileSync(new URL('./tsconfig.linux-consumer-loss.json', import.meta.url)));
const rejected = { message: 'E2E_LINUX_CONSUMER_BUILD_FAILED' };

function fixture(t) {
  const root = fs.mkdtempSync(join(fs.realpathSync(tmpdir()), 'eky-consumer-build-cli-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const paths = linuxConsumerLossBuildPaths(root);
  const marker = linuxConsumerLossBuildReceiptPath(root);
  const write = (name, value) => {
    fs.mkdirSync(dirname(join(root, name)), { recursive: true });
    fs.writeFileSync(join(root, name), value);
  };
  const project = structuredClone(configuration);
  project.files = ['../../playwright.config.ts', '../../src/consumer.ts'];
  write('package.json', '{"type":"module"}');
  write('apps/e2e/package.json', '{"type":"module"}');
  write('tsconfig.base.json', JSON.stringify({ compilerOptions: {
    target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler', strict: true,
  } }));
  write('apps/e2e/tsconfig.json', JSON.stringify({ extends: '../../tsconfig.base.json',
    compilerOptions: { noEmit: true }, include: ['src', 'tests'] }));
  write('apps/e2e/experiments/processOwnership/tsconfig.linux-consumer-loss.json', JSON.stringify(project));
  write('apps/e2e/playwright.config.ts',
    'const defineConfig = (value: object) => value; export default defineConfig({ timeout: 60_000 });');
  write('apps/e2e/src/consumer.ts', 'export const value: number = 42;');
  write('apps/e2e/.artifacts/linux-consumer-loss/stale/nested.js', 'old output');
  write('apps/e2e/.artifacts/other-build/keep.txt', 'unrelated output');
  const calls = [];
  let milliseconds = 0;
  const run = (command, args, options) => {
    calls.push({ command, args, options });
    assert.equal(fs.existsSync(join(paths.output, 'stale/nested.js')), false);
    assert.equal(fs.existsSync(marker), false);
    const raw = ts.readConfigFile(paths.config, ts.sys.readFile).config;
    const parsed = ts.parseJsonConfigFileContent(raw, ts.sys, dirname(paths.config));
    assert.deepEqual(parsed.errors, []);
    const program = ts.createProgram(parsed.fileNames, parsed.options);
    const result = program.emit();
    assert.deepEqual(ts.getPreEmitDiagnostics(program), []);
    assert.equal(result.emitSkipped, false);
    return { status: 0, signal: null };
  };
  const build = overrides => buildLinuxConsumerLoss(root, {
    run, now: () => milliseconds, environment: { PATH: 'inherited', NODE_OPTIONS: '--require PRIVATE',
      node_path: 'PRIVATE', SAFE_VALUE: 'kept' }, ...overrides,
  });
  return { root, paths, marker, write, run, build, calls, setTime(value) { milliseconds = value; } };
}

test('one fixed existing compiler emits the exact closure and publishes a path-free sibling receipt', t => {
  const f = fixture(t);
  const writes = [];
  const receipt = f.build({ fs: { ...fs, openSync(path, flags, mode) {
    writes.push({ path, flags, mode });
    return fs.openSync(path, flags, mode);
  } } });
  assert.deepEqual(Object.keys(receipt).sort(), ['fileCount', 'outputIdentity', 'sourceIdentity']);
  assert.equal(receipt.fileCount, 2);
  assert.ok(Object.isFrozen(receipt));
  assert.deepEqual(JSON.parse(fs.readFileSync(f.marker)), receipt);
  assert.equal(f.marker, join(dirname(f.paths.output), 'linux-consumer-loss.build.json'));
  assert.deepEqual(writes, [{ path: f.marker, flags: 'wx', mode: 0o600 }]);
  assert.equal(fs.readFileSync(join(f.root, 'apps/e2e/.artifacts/other-build/keep.txt'), 'utf8'), 'unrelated output');
  assert.equal(f.calls.length, 1);
  const { command, args, options } = f.calls[0];
  assert.equal(command, process.execPath);
  assert.deepEqual(args, [rootRequire.resolve('typescript/lib/tsc.js'), '-p', f.paths.config]);
  assert.equal(options.cwd, f.root);
  assert.equal(options.shell, false);
  assert.equal(options.windowsHide, true);
  assert.equal(options.stdio, 'ignore');
  assert.equal(options.timeout, 60_000);
  assert.equal(options.killSignal, 'SIGKILL');
  assert.deepEqual(options.env, { PATH: 'inherited', SAFE_VALUE: 'kept' });
  assert.ok(!fs.readFileSync(f.marker, 'utf8').includes(f.root));
  assert.equal(verifyLinuxConsumerLossBuild(f.root, receipt).sourceIdentity, receipt.sourceIdentity);
});

test('native Node and the existing tsc CLI also build the synthetic explicit project', t => {
  const f = fixture(t);
  const receipt = f.build({ run: childProcess.spawnSync, environment: process.env });
  assert.equal(receipt.fileCount, 2);
  assert.deepEqual(JSON.parse(fs.readFileSync(f.marker)), receipt);
});

test('a fresh artifacts parent is created without touching other directories', t => {
  const f = fixture(t);
  fs.rmSync(dirname(f.paths.output), { recursive: true });
  assert.equal(f.build().fileCount, 2);
});

test('an existing receipt refuses before cleanup and is never replaced', t => {
  const f = fixture(t);
  fs.writeFileSync(f.marker, 'earlier receipt');
  assert.throws(() => f.build(), rejected);
  assert.equal(fs.readFileSync(f.marker, 'utf8'), 'earlier receipt');
  assert.equal(fs.readFileSync(join(f.paths.output, 'stale/nested.js'), 'utf8'), 'old output');
  assert.equal(f.calls.length, 0);
});

test('publication cannot overwrite a receipt that appeared during compilation', t => {
  const f = fixture(t);
  assert.throws(() => f.build({ run(...args) {
    const result = f.run(...args);
    fs.writeFileSync(f.marker, 'other publisher');
    return result;
  } }), rejected);
  assert.equal(fs.readFileSync(f.marker, 'utf8'), 'other publisher');
  assert.equal(f.calls.length, 1);
});

for (const [name, result] of [
  ['nonzero exit', { status: 1, signal: null }],
  ['signal', { status: null, signal: 'SIGTERM' }],
  ['timeout', { status: null, signal: 'SIGKILL', error: Object.assign(new Error('PRIVATE'), { code: 'ETIMEDOUT' }) }],
  ['launch error', { status: null, signal: null, error: new Error('PRIVATE') }],
  ['empty result', undefined],
]) {
  test(`${name} refuses a receipt and never retries`, t => {
    const f = fixture(t);
    let calls = 0;
    assert.throws(() => f.build({ run() { calls++; return result; } }), rejected);
    assert.equal(calls, 1);
    assert.equal(fs.existsSync(f.marker), false);
  });
}

test('a thrown compiler error cannot leak through the build API', t => {
  const f = fixture(t);
  assert.throws(() => f.build({ run() { throw new Error('PRIVATE_PATH'); } }), rejected);
  assert.equal(fs.existsSync(f.marker), false);
});

test('success without emitted files and source changes during compilation cannot publish', t => {
  for (const changed of [false, true]) {
    const f = fixture(t);
    assert.throws(() => f.build({ run(...args) {
      if (changed) {
        f.run(...args);
        f.write('apps/e2e/src/consumer.ts', 'export const value = 43;');
      }
      return { status: 0, signal: null };
    } }), rejected);
    assert.equal(fs.existsSync(f.marker), false);
  }
});

test('compiler time remaining comes from the canonical top-level project budget', t => {
  const f = fixture(t);
  f.write('apps/e2e/playwright.config.ts',
    'const defineConfig = (value: object) => value; export default defineConfig({ timeout: 17_000, expect: { timeout: 1 } });');
  let nowCalls = 0;
  f.build({ now: () => nowCalls++ === 0 ? 100 : 350 });
  assert.equal(f.calls[0].options.timeout, 16_750);
});

for (const timeout of ['0', '-1', 'NaN', 'Infinity', '2147483648', '1.5', '60 * 1000', 'budget', '"60000"']) {
  test(`unsupported canonical timeout ${timeout} fails before cleanup instead of guessing`, t => {
    const f = fixture(t);
    f.write('apps/e2e/playwright.config.ts',
      `const defineConfig = (value: object) => value; export default defineConfig({ timeout: ${timeout} });`);
    assert.throws(() => f.build(), rejected);
    assert.equal(f.calls.length, 0);
    assert.equal(fs.existsSync(join(f.paths.output, 'stale/nested.js')), true);
  });
}

test('duplicate or computed timeout definitions and spreads are not silently interpreted', t => {
  for (const properties of ['timeout: 60000, timeout: 1000', '["timeout"]: 60000',
    '...settings, timeout: 60000', 'get timeout() { return 60000; }', 'expect: { timeout: 60000 }']) {
    const f = fixture(t);
    f.write('apps/e2e/playwright.config.ts',
      `const defineConfig = (value: object) => value; export default defineConfig({ ${properties} });`);
    assert.throws(() => f.build(), rejected);
    assert.equal(f.calls.length, 0);
  }
});

test('expiry after compiler completion cannot create a new publication budget', t => {
  const f = fixture(t);
  assert.throws(() => f.build({ run(...args) {
    const result = f.run(...args);
    f.setTime(60_000);
    return result;
  } }), rejected);
  assert.equal(fs.existsSync(f.marker), false);
  assert.equal(f.calls.length, 1);
});

test('a backward clock refuses the build instead of extending its cap', t => {
  const f = fixture(t);
  let calls = 0;
  assert.throws(() => f.build({ now: () => calls++ === 0 ? 100 : 99 }), rejected);
  assert.equal(f.calls.length, 0);
  assert.equal(fs.existsSync(f.marker), false);
});

for (const target of ['apps', 'apps/e2e', 'apps/e2e/.artifacts', 'apps/e2e/.artifacts/linux-consumer-loss']) {
  test(`a junction at ${target} prevents cleanup or compiler execution`, t => {
    const f = fixture(t);
    const path = join(f.root, target);
    const relocated = join(f.root, 'relocated');
    fs.renameSync(path, relocated);
    fs.symlinkSync(relocated, path, 'junction');
    assert.throws(() => f.build(), rejected);
    assert.equal(f.calls.length, 0);
    assert.equal(fs.existsSync(relocated), true);
  });
}

test('nested output junctions are refused without deleting their targets', t => {
  const f = fixture(t);
  f.write('outside/keep.txt', 'untouched');
  fs.symlinkSync(join(f.root, 'outside'), join(f.paths.output, 'linked'), 'junction');
  assert.throws(() => f.build(), rejected);
  assert.equal(fs.readFileSync(join(f.root, 'outside/keep.txt'), 'utf8'), 'untouched');
  assert.equal(f.calls.length, 0);
});

test('relative roots and file-shaped output roots are refused', t => {
  const f = fixture(t);
  assert.throws(() => buildLinuxConsumerLoss('relative'), rejected);
  fs.rmSync(f.paths.output, { recursive: true });
  fs.writeFileSync(f.paths.output, 'not a directory');
  assert.throws(() => f.build(), rejected);
  assert.equal(fs.readFileSync(f.paths.output, 'utf8'), 'not a directory');
  assert.equal(f.calls.length, 0);
});

test('ancestor identity changes during compilation prevent publication', t => {
  const f = fixture(t);
  assert.throws(() => f.build({ run(...args) {
    const result = f.run(...args);
    const parent = dirname(f.paths.output);
    fs.renameSync(parent, parent + '-retained');
    fs.mkdirSync(parent);
    return result;
  } }), rejected);
  assert.equal(fs.existsSync(f.marker), false);
});

test('failed or late receipt writes remove only the receipt owned by this attempt', t => {
  for (const late of [false, true]) {
    const f = fixture(t);
    assert.throws(() => f.build({ fs: { ...fs, writeFileSync(fd, bytes) {
      fs.writeFileSync(fd, bytes);
      if (late) f.setTime(60_000);
      else throw new Error('PRIVATE_DISK_FAILURE');
    } } }), rejected);
    assert.equal(fs.existsSync(f.marker), false);
    assert.equal(fs.existsSync(join(f.paths.output, 'src/consumer.js')), true);
  }
});

test('receipt or output mutation during publication cannot leave a usable receipt', t => {
  for (const mutate of ['receipt', 'output']) {
    const f = fixture(t);
    assert.throws(() => f.build({ fs: { ...fs, writeFileSync(fd, bytes) {
      fs.writeFileSync(fd, mutate === 'receipt' ? 'corrupted' : bytes);
      if (mutate === 'output') fs.writeFileSync(join(f.paths.output, 'src/consumer.js'), 'export const value = 0;');
    } } }), rejected);
    assert.equal(fs.existsSync(f.marker), false);
  }
});

test('CLI rejects arguments and reports only one fixed line, never private compiler errors', () => {
  const errors = [];
  let builds = 0;
  assert.equal(runLinuxConsumerLossBuildCli(['--output=PRIVATE'], {
    build() { builds++; }, writeError: text => errors.push(text),
  }), 1);
  assert.equal(builds, 0);
  assert.equal(runLinuxConsumerLossBuildCli([], {
    build() { throw new Error('PRIVATE_PATH\nPRIVATE_DIAGNOSTIC'); }, writeError: text => errors.push(text),
  }), 1);
  assert.deepEqual(errors, Array(2).fill('E2E_LINUX_CONSUMER_BUILD_FAILED\n'));
  assert.equal(runLinuxConsumerLossBuildCli([], { build() {}, writeError() { assert.fail('successful build reported an error'); } }), 0);
  assert.equal(runLinuxConsumerLossBuildCli(['invalid'], { writeError() { throw new Error('PRIVATE'); } }), 1);
});

test('native CLI invalid arguments exit nonzero with bounded safe stderr and empty stdout', () => {
  const script = fileURLToPath(new URL('./linuxConsumerLossBuildCli.mjs', import.meta.url));
  const result = childProcess.spawnSync(process.execPath, [script, '--invalid'], {
    encoding: 'utf8', shell: false, windowsHide: true, timeout: 60_000, maxBuffer: 4096,
  });
  assert.equal(result.status, 1);
  assert.equal(result.signal, null);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, 'E2E_LINUX_CONSUMER_BUILD_FAILED\n');
});

test('importing the CLI is inert and does not invoke the compiler or mutate files', async t => {
  const deny = () => assert.fail('side effect during import');
  t.mock.method(childProcess, 'spawnSync', deny);
  for (const name of ['mkdirSync', 'rmSync', 'writeFileSync', 'unlinkSync']) t.mock.method(fs, name, deny);
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  const imported = await import(new URL('./linuxConsumerLossBuildCli.mjs?inert', import.meta.url));
  assert.equal(typeof imported.buildLinuxConsumerLoss, 'function');
  assert.equal(typeof imported.runLinuxConsumerLossBuildCli, 'function');
});

test('normal E2E typechecking remains separate from the noCheck emission config', () => {
  const normal = JSON.parse(fs.readFileSync(new URL('../../tsconfig.json', import.meta.url)));
  assert.equal(normal.compilerOptions.noEmit, true);
  assert.equal(normal.compilerOptions.noCheck, undefined);
  assert.equal(configuration.compilerOptions.noCheck, true);
  assert.deepEqual(configuration.include, []);
  assert.equal(resolve(linuxConsumerLossBuildReceiptPath()),
    fileURLToPath(new URL('../../.artifacts/linux-consumer-loss.build.json', import.meta.url)));
});
