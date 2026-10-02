import { spawnSync } from 'node:child_process';
import { appendFile, mkdtemp, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Fixed synthetic failure only: no package installation, profile or user data.
async function probe() {
  if (process.env.GITHUB_ACTIONS !== 'true' || process.env.RUNNER_ENVIRONMENT !== 'github-hosted'
    || process.env.GITHUB_EVENT_NAME !== 'workflow_dispatch') throw new Error('PROBE_CONTEXT_REJECTED');
  const root = await mkdtemp(join(await realpath(tmpdir()), 'eky supervisor '));
  const child = spawnSync(process.execPath, ['-e',
    'process.stderr.write("SYNTHETIC_FIRST_FAILURE_PRIVATE\\n"); process.exitCode = 19'],
  { encoding: 'buffer', timeout: 5000, maxBuffer: 4096, windowsHide: true });
  if (child.error || child.status !== 19 || child.signal || child.stdout.length !== 0
    || !child.stderr.equals(Buffer.from('SYNTHETIC_FIRST_FAILURE_PRIVATE\n'))) throw new Error('PROBE_CHILD_UNVERIFIED');
  await writeFile(join(root, 'ci-step.stderr.private'), child.stderr, { flag: 'wx', mode: 0o600 });
  await writeFile(join(root, 'result.json'), JSON.stringify({
    schemaVersion: 1, probe: 'syntheticFirstFailure', originalExit: child.status,
    cleanup: 'directChildExited', note: 'Not an application or process-tree acceptance result',
  }), { flag: 'wx', mode: 0o600 });
  await appendFile(process.env.GITHUB_OUTPUT, 'probe_verified=true\n');
  console.log('CI_FAILURE_EVIDENCE_PROBE_EXPECTED_FAILURE');
  process.exitCode = 19;
}
probe().catch(() => { console.error('CI_FAILURE_EVIDENCE_PROBE_UNVERIFIED'); process.exitCode = 1; });
