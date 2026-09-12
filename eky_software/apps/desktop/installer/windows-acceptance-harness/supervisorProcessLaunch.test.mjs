import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { runBoundedWindowsAdapterProcess } from './boundedWindowsAdapterProcess.mjs';
import { spawnSupervisorProcess } from './supervisorProcessLaunch.mjs';

for (const mode of ['normal', 'lateWithinCleanup', 'lateAfterCleanup']) {
  test(`exact supervisor launch handle and admission: ${mode}`, { timeout: 10_000 }, async (t) => {
    const root = await mkdtemp(join(tmpdir(), 'eky-supervisor-admission-'));
    const marker = join(root, 'admitted.json');
    const script = join(root, 'permit-fixture.mjs');
    await writeFile(script, `import { writeFileSync } from 'node:fs';
process.stdin.once('data', value => { if (value.length === 1 && value[0] === 1) writeFileSync(process.argv[2], '{}'); });
process.stdin.resume();`);
    let child;
    let close;
    let verified = false;
    t.after(async () => {
      if (child && !verified) { child.kill(); await close; }
      if (verified) await rm(root, { recursive: true, force: true });
    });
    const dll = fileURLToPath(new URL('../bin/windows-process-supervisor-contract-fixture/Release/net10.0/Eky.WindowsProcessSupervisor.ContractFixture.dll', import.meta.url));
    const result = await runBoundedWindowsAdapterProcess({
      command: process.platform === 'win32' ? process.env.EKY_DOTNET_EXE || 'dotnet' : process.execPath,
      arguments: process.platform === 'win32' ? [dll, '--mode', 'callerAdmission', '--request', marker] : [script, marker], cwd: root,
      timeoutMilliseconds: mode === 'normal' ? 3_000 : 100,
      terminationTimeoutMilliseconds: mode === 'lateAfterCleanup' ? 100 : 2_000,
      spawnProcess(command, args, options) {
        child = spawnSupervisorProcess(command, args, options, mode === 'normal' ? {} : {
          createWorker(_, input) { return new Worker(new URL('./fixtures/supervisorLateLaunchWorkerFixture.mjs', import.meta.url),
            { ...input, workerData: { ...input.workerData, delayMilliseconds: 800 } }); },
        });
        close = new Promise((resolve) => child.once('close', resolve));
        return child;
      },
    });
    if (mode === 'normal') {
      assert.equal(result.status, 'completed');
      assert.equal(result.exitCode, 0);
      assert.equal(await readFile(marker, 'utf8'), '{}');
    } else {
      assert.equal(result.resultCode, mode === 'lateAfterCleanup' ? 'terminationUnconfirmed' : 'timedOut');
      assert.equal(result.directProcessAbsent, mode !== 'lateAfterCleanup');
      // Observe late completion without altering the already returned failed result.
      await close;
      await assert.rejects(readFile(marker), { code: 'ENOENT' });
      assert.equal(result.status, 'failed');
      assert.equal(result.directProcessAbsent, mode !== 'lateAfterCleanup');
    }
    verified = true;
  });
}

test('a launch thread failure without a child close cannot prove process absence', { timeout: 5_000 }, async () => {
  let threadExit;
  const result = await runBoundedWindowsAdapterProcess({
    command: process.execPath, arguments: [], cwd: process.cwd(), timeoutMilliseconds: 1_000,
    terminationTimeoutMilliseconds: 100,
    spawnProcess(command, args, options) {
      return spawnSupervisorProcess(command, args, options, {
        createWorker() {
          const worker = new Worker('process.exit(1)', { eval: true });
          threadExit = once(worker, 'exit');
          return worker;
        },
      });
    },
  });
  assert.deepEqual(await threadExit, [1]);
  assert.equal(result.status, 'failed');
  assert.equal(result.directProcessAbsent, false);
  assert.equal(result.resultCode, 'terminationUnconfirmed');
});
