import { randomUUID } from 'node:crypto';
import { constants, lstatSync, realpathSync } from 'node:fs';
import { lstat, mkdir, mkdtemp, open, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { guardLinuxService } from '../../../e2e/experiments/processOwnership/linuxServiceContract.mjs';
import { inspectServicePath, resolveLinuxInspectionElectron } from '../../../e2e/experiments/processOwnership/linuxServiceConfiguration.mjs';
import { startLinuxService } from '../../../e2e/experiments/processOwnership/linuxServiceSession.mjs';
import { createE2eFixtureLifetime } from '../../../e2e/src/environment/e2eFixtureLifetime.ts';
import { E2E_BACKEND_STARTUP_SAFETY_TIMEOUT_MILLISECONDS } from '../../../e2e/src/environment/e2eServiceStartupBudgets.ts';
import { removeE2eRunRoot } from '../../../e2e/src/environment/removeE2eRunRoot.ts';
import { inspectionPreparationFailure, inspectionProofMaximumBytes, requireInspectionProof } from './linuxProfileInspectionContract.mjs';
import { prepareLinuxInspectionProof } from './prepareLinuxInspectionProof.mjs';
import { runLinuxInspectionOwner } from './runLinuxInspectionOwner.mjs';

const repository = fileURLToPath(new URL('../../../../', import.meta.url));

async function readResult(path) {
  inspectServicePath(path, false);
  const before = await lstat(path);
  requireInspectionProof(before.isFile() && before.nlink === 1 && before.uid === process.getuid() &&
    before.gid === process.getgid() && (before.mode & 0o7777) === 0o600 &&
    before.size > 0 && before.size <= inspectionProofMaximumBytes);
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  const same = value => value.dev === before.dev && value.ino === before.ino && value.size === before.size &&
    value.nlink === before.nlink && value.mtimeMs === before.mtimeMs && value.ctimeMs === before.ctimeMs;
  try {
    requireInspectionProof(same(await handle.stat()));
    const bytes = Buffer.alloc(inspectionProofMaximumBytes + 1);
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
    requireInspectionProof(bytesRead === before.size && same(await handle.stat()) && same(await lstat(path)));
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, bytesRead));
    const value = JSON.parse(text);
    requireInspectionProof(JSON.stringify(value) === text);
    return value;
  } finally { await handle.close(); }
}

export async function runLinuxProfileInspectionProof() {
  let phase = 'preflight';
  let evidenceRoot;
  try {
    guardLinuxService();
    requireInspectionProof(process.argv.length === 2);
    const temp = realpathSync(tmpdir());
    inspectServicePath(repository.replace(/\/$/u, ''), true);
    resolveLinuxInspectionElectron(repository.replace(/\/$/u, ''));
    for (const path of ['/usr/bin/xvfb-run', '/usr/bin/Xvfb', '/usr/bin/xauth']) {
      inspectServicePath(path, false);
      requireInspectionProof((lstatSync(path).mode & 0o111) !== 0);
    }
    const run = `run-${randomUUID()}`;
    evidenceRoot = join(repository, 'apps/e2e/test-results', run);
    await mkdir(join(evidenceRoot, 'preparation'), { recursive: true, mode: 0o700 });
    phase = 'preparation';
    const nativeRoot = await mkdtemp(join(temp, 'eky-inspection-native-'));
    const fixtures = await prepareLinuxInspectionProof(repository, temp, nativeRoot);
    const { profileInspectionWorkMilliseconds, profileInspectionShutdownMilliseconds } = await import(
      pathToFileURL(join(repository, 'apps/desktop/dist/runtime/profileInspectionMessages.js')));
    for (const fixture of fixtures) {
      phase = fixture.config.variant;
      // Original startup plus unchanged utility work/shutdown ceilings; no reset.
      const lifetime = createE2eFixtureLifetime(E2E_BACKEND_STARTUP_SAFETY_TIMEOUT_MILLISECONDS +
        profileInspectionWorkMilliseconds + profileInspectionShutdownMilliseconds);
      const outcome = await runLinuxInspectionOwner({ ...fixture, repository: repository.replace(/\/$/u, ''), lifetime,
        startupDeadline: performance.now() + E2E_BACKEND_STARTUP_SAFETY_TIMEOUT_MILLISECONDS },
      { start: startLinuxService, readResult });
      const target = join(evidenceRoot, fixture.config.variant);
      await mkdir(target, { mode: 0o700 });
      // Existing encrypted collector allowlists this exact filename. No profile,
      // database, arbitrary host filesystem or unencrypted artifact is published.
      await writeFile(join(target, 'process-output.private.json'), JSON.stringify({ schemaVersion: 1,
        kind: 'profile-inspection', generation: fixture.config.generation, variant: fixture.config.variant,
        ...outcome }), { flag: 'wx', mode: 0o600 });
      process.stdout.write(JSON.stringify({ operation: 'linuxProfileInspection', variant: fixture.config.variant,
        status: outcome.status, phase: outcome.phase, processTree: outcome.processTree }) + '\n');
      requireInspectionProof(outcome.status === 'passed' && outcome.processTree === 'stopped');
      await removeE2eRunRoot(fixture.paths.runRoot);
    }
    return 0;
  } catch (error) {
    const failure = inspectionPreparationFailure(phase, error);
    if (evidenceRoot) {
      try { await writeFile(join(evidenceRoot, 'preparation/process-output.private.json'),
        JSON.stringify(failure),
        { flag: 'wx', mode: 0o600 }); } catch { /* Keep original failure. */ }
    }
    process.stderr.write(JSON.stringify(failure) + '\n');
    process.stderr.write('LINUX_PROFILE_INSPECTION_PROOF_FAILED\n');
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await runLinuxProfileInspectionProof();
}
