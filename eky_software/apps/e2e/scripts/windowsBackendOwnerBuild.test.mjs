import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

import {
  assertWindowsBackendOwnerBuild, prepareWindowsBackendOwner, windowsBackendOwnerBuildPaths,
} from './windowsBackendOwnerBuild.mjs';

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'eky-owner-build-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const write = (path, text) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  };
  for (const name of ['Program.cs', 'Eky.ProcessOwnershipAdapter.csproj', 'Directory.Build.props', 'NuGet.Config']) {
    write(`apps/e2e/experiments/processOwnership/adapterNative/${name}`, 'synthetic build source');
  }
  for (const name of ['NativeMethods.cs', 'WindowsJob.cs', 'WindowsCommandLine.cs', 'SupervisorContracts.cs']) {
    write(`apps/desktop/installer/windows-process-supervisor/${name}`, 'synthetic linked source');
  }
  for (const name of ['windowsBackendOwnerBuild.mjs', 'prepare-windows-backend-owner.mjs']) {
    write(`apps/e2e/scripts/${name}`, 'synthetic build instruction');
  }
  const paths = windowsBackendOwnerBuildPaths(root);
  const calls = [];
  const run = (command, args, options) => {
    calls.push({ command, args, options });
    if (args[0] === 'build') {
      mkdirSync(paths.output, { recursive: true });
      for (const suffix of ['.exe', '.dll', '.deps.json', '.runtimeconfig.json']) {
        writeFileSync(join(paths.output, `Eky.ProcessOwnershipAdapter${suffix}`), 'synthetic artifact');
      }
    }
    return { status: 0, signal: null };
  };
  const prepare = override => prepareWindowsBackendOwner(
    { repositoryRoot: root, environment: { EKY_DOTNET_EXE: 'synthetic-dotnet' } },
    { platform: 'win32', run: override ?? run },
  );
  return { root, paths, write, calls, run, prepare };
}

test('clean preparation binds the exact source and executable closure after both self-tests', t => {
  const f = fixture(t);
  f.write('apps/e2e/.artifacts/t3c-adapter/retained-first-failure.log', 'retain');
  assert.equal(f.prepare(), 'prepared');
  assert.equal(assertWindowsBackendOwnerBuild(f.root), f.paths.executable);
  assert.equal(f.calls.length, 3);
  assert.equal(f.calls[0].command, 'synthetic-dotnet');
  assert.deepEqual(f.calls[0].args, ['build', f.paths.project, '--configuration', 'Release', '--nologo']);
  assert.equal(f.calls[1].args[1], '--self-test');
  assert.equal(f.calls[2].args[1], '--backend-self-test');
  assert.equal(f.calls[0].options.env.EKY_E2E, undefined);
  assert.equal(f.calls[1].options.env.EKY_E2E, '1');
  assert.equal(f.calls[2].options.env.EKY_E2E, '1');
  for (const call of f.calls) assert.equal(call.options.shell, false);
  assert.equal(readFileSync(join(f.paths.artifacts, 'retained-first-failure.log'), 'utf8'), 'retain');
  const marker = readFileSync(f.paths.marker, 'utf8');
  assert.ok(!marker.includes(f.root));
});

for (const [name, mutate] of [
  ['native source changed', f => f.write('apps/e2e/experiments/processOwnership/adapterNative/Program.cs', 'changed')],
  ['new native source', f => f.write('apps/e2e/experiments/processOwnership/adapterNative/New.cs', 'new')],
  ['nested native source added', f => f.write('apps/e2e/experiments/processOwnership/adapterNative/nested/New.cs', 'new')],
  ['linked Job implementation changed', f => f.write('apps/desktop/installer/windows-process-supervisor/WindowsJob.cs', 'changed')],
  ['build instruction changed', f => f.write('apps/e2e/scripts/windowsBackendOwnerBuild.mjs', 'changed')],
  ['exe changed', f => writeFileSync(f.paths.executable, 'changed')],
  ['dll changed', f => writeFileSync(join(f.paths.output, 'Eky.ProcessOwnershipAdapter.dll'), 'changed')],
  ['runtimeconfig removed', f => rmSync(join(f.paths.output, 'Eky.ProcessOwnershipAdapter.runtimeconfig.json'))],
  ['extra marker property', f => writeFileSync(f.paths.marker, JSON.stringify({ ...JSON.parse(readFileSync(f.paths.marker)), ignored: true }))],
  ['missing marker', f => rmSync(f.paths.marker)],
]) {
  test(`startup rejects stale preparation: ${name}`, t => {
    const f = fixture(t);
    f.prepare();
    mutate(f);
    assert.throws(() => assertWindowsBackendOwnerBuild(f.root), /^Error: E2E_BACKEND_OWNER_BUILD_REQUIRED$/u);
  });
}

test('nested source edits invalidate the exact source receipt', t => {
  const f = fixture(t);
  const nested = 'apps/e2e/experiments/processOwnership/adapterNative/nested/Owner.cs';
  f.write(nested, 'original');
  f.prepare();
  assert.equal(assertWindowsBackendOwnerBuild(f.root), f.paths.executable);
  f.write(nested, 'changed');
  assert.throws(() => assertWindowsBackendOwnerBuild(f.root), /E2E_BACKEND_OWNER_BUILD_REQUIRED/u);
});

for (const failedStep of [0, 1, 2]) {
  test(`failure at preparation step ${failedStep} invalidates an earlier success and stops the chain`, t => {
    const f = fixture(t);
    f.prepare();
    let calls = 0;
    assert.throws(() => f.prepare((...args) => {
      if (calls++ === failedStep) return { status: 1, signal: null };
      return f.run(...args);
    }), /E2E_BACKEND_OWNER_PREPARATION_FAILED/u);
    assert.equal(calls, failedStep + 1);
    assert.throws(() => assertWindowsBackendOwnerBuild(f.root), /E2E_BACKEND_OWNER_BUILD_REQUIRED/u);
  });
}

test('source mutation during preparation refuses a receipt', t => {
  const f = fixture(t);
  assert.throws(() => f.prepare((...args) => {
    const result = f.run(...args);
    f.write('apps/e2e/experiments/processOwnership/adapterNative/Program.cs', 'changed during build');
    return result;
  }), /E2E_BACKEND_OWNER_SOURCE_CHANGED/u);
  assert.throws(() => assertWindowsBackendOwnerBuild(f.root), /E2E_BACKEND_OWNER_BUILD_REQUIRED/u);
});

test('a failed subprocess or interrupted self-test cannot produce a build receipt', t => {
  const f = fixture(t);
  for (const result of [{ status: null, signal: 'SIGTERM' }, { status: 0, signal: null, error: new Error('spawn') }]) {
    assert.throws(() => f.prepare(() => result), /E2E_BACKEND_OWNER_PREPARATION_FAILED/u);
    assert.throws(() => assertWindowsBackendOwnerBuild(f.root), /E2E_BACKEND_OWNER_BUILD_REQUIRED/u);
  }
});

test('Linux preparation does not invoke Windows tools or claim containment', () => {
  assert.equal(prepareWindowsBackendOwner({ repositoryRoot: 'unused' }, {
    platform: 'linux', run: () => { throw new Error('UNEXPECTED_BUILD'); },
  }), 'notApplicable');
});
