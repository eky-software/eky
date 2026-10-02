import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { captureContractOutput } from './supervisorContractPrivateEvidence.mjs';
import { createTestRunContext, startSupervisor } from './supervisorContractTestSupport.mjs';

const [rootReceipt, mode] = process.argv.slice(2);

async function multipleContextFixture(t) {
  const contexts = [];
  for (let index = 0; index < 3; index++) {
    const context = await createTestRunContext(t, `private-evidence-context-${index + 1}`);
    contexts.push(context);
    await writeFile(context.resultPath, JSON.stringify({ syntheticResult: index + 1 }), { flag: 'wx' });
  }
  await writeFile(rootReceipt, JSON.stringify(contexts.map(context => context.testRoot)), { flag: 'wx' });
  for (const [index, context] of contexts.entries()) {
    const output = captureContractOutput(context, 'observed');
    const child = Object.assign(new EventEmitter(), { exitCode: null, signalCode: null });
    child.kill = () => {
      output.append('stdout', `cleanup-${index + 1}`);
      output.append('stderr', `bodyPassed=${t.passed}`);
      output.end('stdout');
      output.end('stderr');
      child.exitCode = 0;
      queueMicrotask(() => { output.close(); child.emit('close'); });
      assert.ok(contexts.every(item => existsSync(item.resultPath)),
        'All context results must survive until every owned cleanup has finished');
      assert.ok(contexts.every(item => !existsSync(join(item.testRoot, 'supervisor-output.private.json'))),
        'Private output writes must follow every owned cleanup');
      if (index === 0 && mode === 'multi-first-cleanup-failure') throw new Error('synthetic first cleanup failure');
      if (index === 1 && mode !== 'multi-success') throw new Error('synthetic second cleanup failure');
      return true;
    };
    context.fixtureProcesses.add(child);
  }
  if (mode === 'multi-body-failure') assert.fail('synthetic contract assertion');
}

test('synthetic contract evidence boundary', async (t) => {
  if (mode.startsWith('multi-')) {
    await multipleContextFixture(t);
    return;
  }
  const context = await createTestRunContext(t, 'private-evidence-boundary');
  await writeFile(rootReceipt, context.testRoot, { flag: 'wx' });
  await writeFile(context.resultPath, '{"syntheticResult":true}', { flag: 'wx' });
  await writeFile(join(context.testRoot, 'ci-step.stdout.private'), 'synthetic ci stdout', { flag: 'wx' });
  await writeFile(join(context.testRoot, 'ci-step.stderr.private'), 'synthetic ci stderr', { flag: 'wx' });
  const evidence = { schemaVersion: 1, operation: 'windowsAcceptanceSupervisor',
    phase: 'hostExited', status: 'failed', durationMs: 1, elapsedMs: 1 };
  const source = `console.log(${JSON.stringify(JSON.stringify(evidence))});`
    + (mode === 'stderr' ? "console.error('synthetic native failure');" : '');
  // The support helper still owns this real child; no native build or MSI is used.
  const execution = startSupervisor(context, {
    captureOutput: mode !== 'observer' && mode !== 'unread' && mode !== 'ignored',
    unreadOutput: mode === 'unread',
    observeEvidence: mode === 'observer' ? () => {} : undefined,
    dotnetAssembly: '-e', dotnetArguments: [source],
  });
  if (mode === 'unread') {
    assert.equal(execution.child.stdout.listenerCount('data'), 0);
    assert.equal(execution.child.stderr.listenerCount('data'), 0);
    assert.equal(execution.child.stdout.readableFlowing, null);
    assert.equal(execution.child.stderr.readableFlowing, null);
    await once(execution.child, 'exit');
    assert.equal(execution.child.stdout.listenerCount('data'), 0);
    assert.equal(execution.child.stderr.listenerCount('data'), 0);
    execution.child.stdout.destroy();
    execution.child.stderr.destroy();
  }
  if (mode === 'ignored') {
    assert.equal(execution.child.stdout, null);
    assert.equal(execution.child.stderr, null);
  }
  await execution.completion;
  if (mode !== 'success') assert.fail('synthetic contract assertion');
});
