import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { setImmediate } from 'node:timers/promises';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import {
  consumerCasesForScope, runLinuxConsumerLossCli, serializeConsumerCaseResult, writeConsumerLine,
} from './runLinuxConsumerLoss.mjs';
import { consumerCaseStages } from './runLinuxConsumerLossCase.mjs';
import { linuxConsumerPhases } from './linuxConsumerLossContract.mjs';

const cases = Object.freeze({
  system: ['backend-owner', 'backend-control'],
  web: ['vite-owner', 'vite-control', 'chromium-owner', 'chromium-control', 'caller'],
});
const binding = Object.freeze({ consumer: 'system-api', checkoutSha: 'c'.repeat(40), runId: '123', runAttempt: '1' });
const prefix = 'EKY_LINUX_CONSUMER_RESULT ';
const rejected = 'EKY_LINUX_CONSUMER_REJECTED\n';
const invalid = { message: 'E2E_LINUX_CONSUMER_LOSS_UNVERIFIED' };
const stateKeys = ['caseId', 'stage', 'outcome', 'registered', 'passive', 'callerClosed', 'commandsClosed',
  'sentinelPreserved', 'retentionVerified', 'takeover', 'forcedCaller', 'callerFailurePhase'];

function complete(caseId) {
  return { caseId, stage: 'complete', outcome: 'complete',
    registered: caseId.startsWith('backend-') ? 1 : 3, passive: caseId === 'caller' ? 3 : 1,
    callerClosed: true, commandsClosed: true, sentinelPreserved: true, retentionVerified: true,
    takeover: caseId === 'caller' ? 'completed' : 'notAttempted', forcedCaller: false, callerFailurePhase: null };
}

function fixture(scope = 'system') {
  const consumer = scope === 'system' ? 'system-api' : 'web-chromium';
  const calls = [];
  const lines = [];
  const build = Object.freeze({ repositoryRoot: '/synthetic/repository',
    actorEntry: '/synthetic/repository/apps/e2e/.artifacts/linux-consumer-loss/experiments/processOwnership/linuxConsumerLossActor.mjs',
    config: Object.freeze({ timeout: 60000, globalTimeout: 1800000, workers: 1 }),
    createRunRoot() { assert.fail('A CLI contract test must not create a runtime root'); },
  });
  const input = {
    argv: [`--scope=${scope}`, `--consumer=${consumer}`, `--checkout-sha=${binding.checkoutSha}`],
    runtime: { platform: 'linux', env: { EKY_E2E: '1', CI: 'true', GITHUB_ACTIONS: 'true',
      GITHUB_RUN_ID: binding.runId, GITHUB_RUN_ATTEMPT: binding.runAttempt,
      SYNTHETIC_SECRET: 'PRIVATE_VALUE', NODE_OPTIONS: '--synthetic-hook' },
    getuid: () => 1001, geteuid: () => 1001, getgid: () => 1002, getegid: () => 1002 },
    async load() { calls.push('load'); return build; },
    async executeCase(value) { calls.push(value); return complete(value.caseId); },
    writeLine(line) { lines.push(line); },
  };
  return { input, calls, lines, build, run: () => runLinuxConsumerLossCli(input) };
}

function record(line) {
  assert.ok(line.startsWith(prefix));
  assert.equal(line.split('\n').length, 2);
  const value = JSON.parse(line.slice(prefix.length));
  assert.equal(line, prefix + JSON.stringify(value) + '\n');
  assert.deepEqual(Object.keys(value), ['schemaVersion', 'operation', ...Object.keys(binding), ...stateKeys]);
  assert.ok(Buffer.byteLength(line) < 4096);
  return value;
}

test('two system and five web cases form the exact seven-case first-attempt manifest', () => {
  for (const [scope, ids] of Object.entries(cases)) {
    assert.deepEqual(consumerCasesForScope(scope).map(value => value.id), ids);
  }
  assert.equal(new Set([...cases.system, ...cases.web]).size, 7);
  for (const scope of ['', 'all', 'system-api', 'web-chromium', 'SYSTEM', 'web\n', null, undefined, 0]) {
    assert.throws(() => consumerCasesForScope(scope), invalid);
  }
});

for (const scope of Object.keys(cases)) {
  test(`${scope} loads once and executes each bound case once with no inherited runtime environment`, async () => {
    const f = fixture(scope);
    assert.equal(await f.run(), 0);
    assert.equal(f.calls[0], 'load');
    assert.equal(f.calls.length, cases[scope].length + 1);
    assert.deepEqual(f.calls.slice(1).map(value => value.caseId), cases[scope]);
    assert.equal(f.lines.length, cases[scope].length);
    for (const [index, value] of f.calls.slice(1).entries()) {
      assert.deepEqual(Object.keys(value), [...Object.keys(f.build), 'caseId']);
      for (const key of Object.keys(f.build)) assert.equal(value[key], f.build[key]);
      assert.deepEqual(record(f.lines[index]), { schemaVersion: 1, operation: 'consumerLoss',
        ...binding, consumer: scope === 'system' ? 'system-api' : 'web-chromium', ...complete(value.caseId) });
    }
    assert.ok(f.lines.every(line => !line.includes('PRIVATE_VALUE') && !line.includes('synthetic/repository')));
  });
}

test('the next case cannot start while the current execution is pending', async () => {
  const f = fixture();
  let release;
  f.input.executeCase = value => {
    f.calls.push(value);
    if (value.caseId === cases.system[0]) return new Promise(resolve => { release = () => resolve(complete(value.caseId)); });
    return complete(value.caseId);
  };
  const running = f.run();
  await setImmediate();
  assert.deepEqual(f.calls.slice(1).map(value => value.caseId), [cases.system[0]]);
  assert.deepEqual(f.lines, []);
  release();
  assert.equal(await running, 0);
  assert.deepEqual(f.calls.slice(1).map(value => value.caseId), cases.system);
});

const invalidContexts = [
  ['non-Linux', f => { f.input.runtime.platform = 'win32'; }],
  ...['EKY_E2E', 'CI', 'GITHUB_ACTIONS', 'GITHUB_RUN_ID', 'GITHUB_RUN_ATTEMPT'].map(key =>
    [`missing ${key}`, f => { delete f.input.runtime.env[key]; }]),
  ['wrong E2E flag', f => { f.input.runtime.env.EKY_E2E = 'true'; }],
  ['wrong CI flag', f => { f.input.runtime.env.CI = '1'; }],
  ['wrong Actions flag', f => { f.input.runtime.env.GITHUB_ACTIONS = 'false'; }],
  ['root identity', f => { f.input.runtime.getuid = () => 0; }],
  ['changed effective uid', f => { f.input.runtime.geteuid = () => 1003; }],
  ['changed effective gid', f => { f.input.runtime.getegid = () => 1003; }],
  ['invalid run ID', f => { f.input.runtime.env.GITHUB_RUN_ID = 'private\nvalue'; }],
  ['invalid attempt', f => { f.input.runtime.env.GITHUB_RUN_ATTEMPT = '01'; }],
  ['unknown scope', f => { f.input.argv[0] = '--scope=all'; }],
  ['scope/consumer mismatch', f => { f.input.argv[1] = '--consumer=web-chromium'; }],
  ['unbound checkout', f => { f.input.argv[2] = '--checkout-sha=HEAD'; }],
  ['noncanonical checkout', f => { f.input.argv[2] = `--checkout-sha=${'C'.repeat(40)}`; }],
  ['extra argument', f => { f.input.argv.push('--retry=1'); }],
  ['missing argument', f => { f.input.argv.pop(); }],
  ['duplicate argument', f => { f.input.argv[2] = f.input.argv[1]; }],
  ['unknown argument', f => { f.input.argv[2] = '--secret=PRIVATE_VALUE'; }],
  ['non-string argument', f => { f.input.argv[0] = {}; }],
  ['missing arguments', f => { f.input.argv = undefined; }],
];
for (const [name, alter] of invalidContexts) {
  test(`${name} is rejected before loading or executing any case`, async () => {
    const f = fixture();
    alter(f);
    assert.equal(await f.run(), 1);
    assert.deepEqual(f.calls, []);
    assert.deepEqual(f.lines, [rejected]);
  });
}

test('a build-load failure is redacted and starts no case', async () => {
  const f = fixture();
  f.input.load = async () => { f.calls.push('load'); throw Error('PRIVATE_BUILD_PATH'); };
  assert.equal(await f.run(), 1);
  assert.deepEqual(f.calls, ['load']);
  assert.deepEqual(f.lines, [rejected]);
});

for (const scope of Object.keys(cases)) {
  for (const failureKind of ['incomplete', 'throw', 'malformed']) {
    test(`${scope} stops at the first ${failureKind} case without retrying`, async () => {
      for (let failed = 0; failed < cases[scope].length; failed++) {
        const f = fixture(scope);
        f.input.executeCase = async value => {
          f.calls.push(value);
          if (value.caseId !== cases[scope][failed]) return complete(value.caseId);
          if (failureKind === 'throw') throw Error('PRIVATE_CASE_FAILURE');
          if (failureKind === 'malformed') return { ...complete(value.caseId), secret: 'PRIVATE_VALUE' };
          return { ...complete(value.caseId), stage: 'passive', outcome: 'incomplete', passive: 0 };
        };
        assert.equal(await f.run(), 1);
        assert.deepEqual(f.calls.slice(1).map(value => value.caseId), cases[scope].slice(0, failed + 1));
        assert.equal(f.lines.length, failed + 1);
        if (failureKind === 'incomplete') assert.equal(record(f.lines.at(-1)).outcome, 'incomplete');
        else assert.equal(f.lines.at(-1), rejected);
        assert.ok(f.lines.every(line => !line.includes('PRIVATE_')));
      }
    });
  }
}

test('a valid result for another case in the same scope cannot replace the requested case', async () => {
  const f = fixture();
  f.input.executeCase = async value => { f.calls.push(value); return complete('backend-control'); };
  assert.equal(await f.run(), 1);
  assert.deepEqual(f.calls.slice(1).map(value => value.caseId), ['backend-owner']);
  assert.deepEqual(f.lines, [rejected]);
});

test('report write failure stops case execution without publishing raw failure data', async () => {
  const f = fixture();
  f.input.writeLine = line => {
    if (line !== rejected) throw Error('PRIVATE_WRITE_FAILURE');
    f.lines.push(line);
  };
  assert.equal(await f.run(), 1);
  assert.equal(f.calls.length, 2);
  assert.deepEqual(f.lines, [rejected]);
});

test('an unavailable output sink still returns failure instead of escaping a raw exception', async () => {
  const f = fixture();
  f.input.writeLine = () => { throw Error('PRIVATE_WRITE_FAILURE'); };
  assert.equal(await f.run(), 1);
  assert.equal(f.calls.length, 2);
});

test('pending result writes prevent both the next case and final CLI return', async () => {
  const f = fixture();
  const acknowledge = [];
  f.input.writeLine = line => {
    f.lines.push(line);
    return new Promise(resolve => acknowledge.push(resolve));
  };
  let settled = false;
  const running = f.run().then(code => { settled = true; return code; });
  for (let index = 0; index < cases.system.length; index++) {
    await setImmediate();
    assert.equal(settled, false);
    assert.equal(f.lines.length, index + 1);
    assert.deepEqual(f.calls.slice(1).map(value => value.caseId), cases.system.slice(0, index + 1));
    acknowledge[index]();
  }
  assert.equal(await running, 0);
  assert.equal(settled, true);
});

test('an incomplete case also awaits its report acknowledgement before returning failure', async () => {
  const f = fixture();
  let acknowledge;
  f.input.executeCase = async value => {
    f.calls.push(value);
    return { ...complete(value.caseId), outcome: 'incomplete', stage: 'passive', passive: 0 };
  };
  f.input.writeLine = line => {
    f.lines.push(line);
    return new Promise(resolve => { acknowledge = resolve; });
  };
  let settled = false;
  const running = f.run().then(code => { settled = true; return code; });
  await setImmediate();
  assert.equal(settled, false);
  assert.equal(f.calls.length, 2);
  assert.equal(record(f.lines[0]).outcome, 'incomplete');
  acknowledge();
  assert.equal(await running, 1);
  assert.equal(f.calls.length, 2);
});

for (const scope of Object.keys(cases)) {
  test(`${scope} async report rejection at any case halts the sequence and returns failure`, async () => {
    for (let failed = 0; failed < cases[scope].length; failed++) {
      const f = fixture(scope);
      f.input.writeLine = async line => {
        f.lines.push(line);
        await setImmediate();
        if (line !== rejected && record(line).caseId === cases[scope][failed]) throw Error('PRIVATE_ASYNC_WRITE');
      };
      assert.equal(await f.run(), 1);
      assert.deepEqual(f.calls.slice(1).map(value => value.caseId), cases[scope].slice(0, failed + 1));
      assert.equal(f.lines.length, failed + 2);
      assert.equal(f.lines.at(-1), rejected);
      assert.ok(f.lines.every(line => !line.includes('PRIVATE_ASYNC_WRITE')));
    }
  });
}

test('async fallback rejection is awaited and swallowed after a failed result write', async () => {
  const f = fixture();
  const rejectWrite = [];
  f.input.writeLine = line => {
    f.lines.push(line);
    return new Promise((_resolve, reject) => rejectWrite.push(reject));
  };
  let settled = false;
  const running = f.run().then(code => { settled = true; return code; });
  await setImmediate();
  assert.equal(settled, false);
  assert.equal(f.lines.length, 1);
  rejectWrite[0](Error('PRIVATE_ASYNC_RESULT'));
  await setImmediate();
  assert.equal(settled, false);
  assert.equal(f.calls.length, 2);
  assert.equal(f.lines.length, 2);
  assert.equal(f.lines[1], rejected);
  rejectWrite[1](Error('PRIVATE_ASYNC_FALLBACK'));
  assert.equal(await running, 1);
  assert.equal(f.calls.length, 2);
  assert.equal(f.lines.length, 2);
});

test('invalid context still has no case side effects when async rejection output fails', async () => {
  const f = fixture();
  f.input.argv = [];
  f.input.writeLine = async line => {
    f.lines.push(line);
    await setImmediate();
    throw Error('PRIVATE_ASYNC_FALLBACK');
  };
  assert.equal(await f.run(), 1);
  assert.deepEqual(f.calls, []);
  assert.deepEqual(f.lines, [rejected]);
});

for (const accepted of [true, false]) {
  test(`callback writer waits for acknowledgement when write returns ${accepted}`, async () => {
    const line = serializeConsumerCaseResult(binding, complete('backend-owner'));
    let acknowledge;
    let writes = 0;
    const writing = writeConsumerLine(line, {
      write(value, callback) { writes++; assert.equal(value, line); acknowledge = callback; return accepted; },
    });
    let settled = false;
    const result = writing.then(value => { settled = true; return value; });
    await setImmediate();
    assert.equal(settled, false);
    assert.equal(writes, 1);
    acknowledge();
    assert.equal(await result, undefined);
    assert.equal(settled, true);
    assert.equal(writes, 1);
  });
}

test('callback writer rejects with the original asynchronous callback error', async () => {
  const failure = Error('PRIVATE_CALLBACK_ERROR');
  let acknowledge;
  const writing = writeConsumerLine(rejected, { write(_line, callback) { acknowledge = callback; return true; } });
  const failed = assert.rejects(writing, error => error === failure);
  await setImmediate();
  acknowledge(failure);
  await failed;
});

test('callback writer converts a synchronous write throw to a rejected promise', async () => {
  const failure = Error('PRIVATE_WRITE_THROW');
  let writing;
  assert.doesNotThrow(() => {
    writing = writeConsumerLine(rejected, { write() { throw failure; } });
  });
  await assert.rejects(writing, error => error === failure);
});

test('callback writer also handles synchronous acknowledgement and callback rejection', async () => {
  await writeConsumerLine(rejected, { write(_line, callback) { callback(); return true; } });
  const failure = Error('PRIVATE_SYNC_CALLBACK');
  await assert.rejects(writeConsumerLine(rejected, {
    write(_line, callback) { callback(failure); return false; },
  }), error => error === failure);
});

test('entrypoint stdout failures remain sticky across pending and completed CLI results', async () => {
  // Execute only the actual entrypoint body with a fake process and CLI, never a Linux runtime.
  const ts = createRequire(import.meta.url)('typescript');
  const source = ts.createSourceFile('runLinuxConsumerLoss.mjs',
    readFileSync(new URL('./runLinuxConsumerLoss.mjs', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
  const entry = source.statements.filter(node => ts.isIfStatement(node));
  assert.equal(entry.length, 1);
  const body = entry[0].thenStatement.getText(source);
  for (const [code, errorAt] of [[0, 'none'], [1, 'none'], [0, 'pending'], [0, 'after']]) {
    const runtime = { argv: ['synthetic-node', 'synthetic-cli'], stdout: new EventEmitter() };
    let release;
    let called = 0;
    const running = runInNewContext(`(async () => ${body})()`, {
      process: runtime,
      runLinuxConsumerLossCli(input) {
        called++;
        assert.deepEqual(input.argv, []);
        return new Promise(resolve => { release = resolve; });
      },
    });
    assert.equal(called, 1);
    if (errorAt === 'pending') {
      runtime.stdout.emit('error', Error('PRIVATE_STDOUT_ERROR'));
      assert.equal(runtime.exitCode, 1);
    }
    release(code);
    await running;
    assert.equal(runtime.exitCode, errorAt === 'pending' ? 1 : code);
    if (errorAt === 'after') {
      runtime.stdout.emit('error', Error('PRIVATE_LATE_STDOUT_ERROR'));
      assert.equal(runtime.exitCode, 1);
    }
  }
});

test('the closed report accepts every complete case and incomplete stage with exact evidence binding', () => {
  for (const [scope, ids] of Object.entries(cases)) {
    const evidence = { ...binding, consumer: scope === 'system' ? 'system-api' : 'web-chromium' };
    for (const caseId of ids) {
      assert.deepEqual(record(serializeConsumerCaseResult(evidence, complete(caseId))),
        { schemaVersion: 1, operation: 'consumerLoss', ...evidence, ...complete(caseId) });
      for (const stage of consumerCaseStages.filter(value => value !== 'complete')) {
        const value = { ...complete(caseId), stage, outcome: 'incomplete', registered: 0, passive: 0,
          callerClosed: false, commandsClosed: false, sentinelPreserved: false, retentionVerified: false,
          takeover: 'notAttempted' };
        assert.equal(record(serializeConsumerCaseResult(evidence, value)).stage, stage);
      }
    }
  }
});

test('reports reject missing, extra, accessor and symbol properties without invoking getters', () => {
  for (const part of ['binding', 'state']) {
    const good = part === 'binding' ? binding : complete('backend-owner');
    const serialize = value => part === 'binding'
      ? serializeConsumerCaseResult(value, complete('backend-owner')) : serializeConsumerCaseResult(binding, value);
    for (const key of Object.keys(good)) {
      const missing = { ...good }; delete missing[key];
      assert.throws(() => serialize(missing), invalid);
      const accessor = { ...good };
      Object.defineProperty(accessor, key, { enumerable: true, get() { assert.fail('GETTER_EXECUTED'); } });
      assert.throws(() => serialize(accessor), invalid);
    }
    for (const bad of [null, [], Object.create(good), { ...good, secret: 'PRIVATE_VALUE' },
      { ...good, [Symbol('extra')]: true }, Object.defineProperty({ ...good }, 'hidden', { value: true })]) {
      assert.throws(() => serialize(bad), invalid);
    }
  }
});

test('reports reject invalid enums, counts, booleans, bindings and unjustified complete claims', () => {
  const good = complete('backend-owner');
  const badFields = [
    { caseId: 'unknown' }, { stage: 'secret' }, { outcome: 'passed' }, { takeover: 'stopped' },
    { stage: 'complete', outcome: 'incomplete' }, { stage: 'readiness' },
    { registered: 0 }, { passive: 0 }, { takeover: 'completed' }, { forcedCaller: true },
    ...['callerClosed', 'commandsClosed', 'sentinelPreserved', 'retentionVerified'].map(key => ({ [key]: false })),
    ...['callerClosed', 'commandsClosed', 'sentinelPreserved', 'retentionVerified', 'forcedCaller']
      .map(key => ({ [key]: 1 })),
    ...['registered', 'passive'].flatMap(key => [-1, 0.5, 2, NaN, Infinity, '1'].map(value => ({ [key]: value }))),
  ];
  for (const fields of badFields) assert.throws(() => serializeConsumerCaseResult(binding, { ...good, ...fields }), invalid);
  assert.throws(() => serializeConsumerCaseResult(binding,
    { ...good, stage: 'passive', outcome: 'incomplete', registered: 0, passive: 1 }), invalid);
  for (const fields of [{ consumer: 'web-chromium' }, { checkoutSha: 'HEAD' }, { checkoutSha: 'C'.repeat(40) },
    { runId: '1\n' }, { runAttempt: '0' }, { runAttempt: '01' }, { runId: '1'.repeat(33) }]) {
    assert.throws(() => serializeConsumerCaseResult({ ...binding, ...fields }, good), invalid);
  }
  const webBinding = { ...binding, consumer: 'web-chromium' };
  for (const fields of [{ registered: 2 }, { passive: 1 }, { takeover: 'notAttempted' }, { takeover: 'unverified' }]) {
    assert.throws(() => serializeConsumerCaseResult(webBinding, { ...complete('caller'), ...fields }), invalid);
  }
});

test('caller failure diagnostics allow only a closed phase on incomplete reports and null on complete', async () => {
  for (const callerFailurePhase of [null, ...linuxConsumerPhases]) {
    const f = fixture();
    f.input.executeCase = async value => {
      f.calls.push(value);
      return { ...complete(value.caseId), stage: 'callerClose', outcome: 'incomplete', callerFailurePhase };
    };
    assert.equal(await f.run(), 1);
    assert.equal(f.calls.length, 2);
    assert.equal(record(f.lines[0]).callerFailurePhase, callerFailurePhase);
    if (callerFailurePhase !== null) {
      assert.throws(() => serializeConsumerCaseResult(binding,
        { ...complete('backend-owner'), callerFailurePhase }), invalid);
    }
  }
  for (const callerFailurePhase of [undefined, '', 'PRIVATE_ERROR_TEXT', 'readiness\n', 0, false,
    { phase: 'readiness' }, ['readiness']]) {
    assert.throws(() => serializeConsumerCaseResult(binding,
      { ...complete('backend-owner'), stage: 'callerClose', outcome: 'incomplete', callerFailurePhase }), invalid);
  }
});

test('default loader wiring fixes the receipt path and exact schema before importing emitted code', () => {
  // The CLI injects the whole loader; inspect its wiring without importing emitted runtimes.
  const ts = createRequire(import.meta.url)('typescript');
  const source = ts.createSourceFile('runLinuxConsumerLoss.mjs',
    readFileSync(new URL('./runLinuxConsumerLoss.mjs', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
  const loader = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'loadBuild');
  assert.ok(loader?.body);
  const declarations = [];
  const calls = [];
  const visit = node => {
    if (ts.isVariableDeclaration(node)) declarations.push(node);
    if (ts.isCallExpression(node)) calls.push(node);
    ts.forEachChild(node, visit);
  };
  visit(loader.body);
  const path = declarations.find(node => node.name.getText(source) === 'receiptPath')?.initializer;
  assert.ok(path && ts.isBinaryExpression(path) && path.operatorToken.kind === ts.SyntaxKind.PlusToken);
  assert.equal(path.left.getText(source), 'paths.output');
  assert.ok(ts.isStringLiteral(path.right));
  assert.equal(path.right.text, '.build.json');
  const exact = calls.find(node => node.expression.getText(source) === 'exactKeys' && node.arguments[0]?.getText(source) === 'receipt');
  assert.ok(exact && ts.isArrayLiteralExpression(exact.arguments[1]));
  assert.deepEqual(exact.arguments[1].elements.map(node => node.text), ['sourceIdentity', 'outputIdentity', 'fileCount']);
  const verified = calls.find(node => node.expression.getText(source) === 'verifyLinuxConsumerLossBuild');
  assert.deepEqual(verified.arguments.map(node => node.getText(source)), ['repositoryRoot', 'receipt']);
  const imports = calls.filter(node => node.expression.kind === ts.SyntaxKind.ImportKeyword);
  assert.equal(imports.length, 2);
  assert.ok(imports.every(node => node.pos > verified.end));
  assert.equal(calls.filter(node => node.expression.getText(source) === 'readFileSync').length, 1);
});
