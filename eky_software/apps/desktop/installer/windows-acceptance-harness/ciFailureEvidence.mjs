import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { appendFile, lstat, mkdir, opendir, readFile, realpath, writeFile } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import {
  encryptArchive, evidenceRecipient, ordinaryPath, retain, writeEvidenceArchive,
} from './workspaceEncryptedEvidence.mjs';
import commandBudgets from '../windows-process-supervisor/supervisorCommandBudgets.json' with { type: 'json' };
import { projectPlaywrightFailureReport } from './playwrightFailureReport.mjs';

const MiB = 1024 * 1024;
const MAX_FILE = 8 * MiB;
const MAX_TOTAL = 128 * MiB;
const MAX_FILES = 256;
const MAX_ENTRIES = 4096;
const MAX_DEPTH = 9;
const MAX_SOURCE_MILLISECONDS = 5000;
const outcomes = new Set(['success', 'failure', 'cancelled', 'skipped']);
const runPattern = 'run-[a-f0-9-]{36}';
const failure = () => new Error('CI_FAILURE_EVIDENCE_UNVERIFIED');
const commandPhases = new Set(['publishFailure', ...Object.values(commandBudgets)
  .filter(plan => Array.isArray(plan.phases)).flatMap(plan => plan.phases.map(([phase]) => phase))]);

// Source names are test-tool contracts, not a glob over profiles or the runner.
export function evidenceSourceKind(area, path) {
  if (area === 'reports' && new RegExp(`^${runPattern}/results\\.private\\.json$`, 'u').test(path)) return 'playwrightReport';
  if (area === 'results' && new RegExp(`^${runPattern}/[^/]+/(?:backend-startup|process-output|failure)\\.private\\.json$`, 'u').test(path)) return 'processOutput';
  if (area !== 'temporary') return null;
  if (/^eky-desktop-smoke\/[a-f0-9]{32}\/(?:result\/desktop-smoke-result\.json|smoke-output\.private\.json)$/u.test(path)) return 'packagedSmoke';
  const fixturePrefix = '(?:(?:eky supervisor [a-zA-Z0-9]+/temporary|eky-t-[a-zA-Z0-9]+)/)?';
  if (new RegExp(`^${fixturePrefix}eky-(?:clean|upgrade|legacy|workspace)-caller-[a-f0-9]{32}/result\\.json$`, 'u').test(path)) return 'nativeResult';
  if (/^eky supervisor [a-zA-Z0-9]+\/(?:result\.json|worker-result\.json|ci-step\.(?:stdout|stderr)\.private|supervisor-(?:[1-9]|1[0-6])\.(?:stdout|stderr)\.private|supervisor-output\.private\.json)$/u.test(path)) return 'nativeResult';
  const command = new RegExp(`^${fixturePrefix}eky-acceptance-command-[a-f0-9]{32}/([^/]+)/(?:result|worker-result)\\.json$`, 'u').exec(path);
  if (command && commandPhases.has(command[1])) return 'nativeResult';
  return null;
}

export function jobEvidenceBinding(env) {
  if (!/^[1-9][0-9]*$/u.test(env.GITHUB_RUN_ID ?? '')
    || !/^[1-9][0-9]*$/u.test(env.GITHUB_RUN_ATTEMPT ?? '')
    || !/^[A-Za-z0-9_-]{1,120}$/u.test(env.GITHUB_JOB ?? '')
    || !/^[A-Za-z0-9_-]{1,120}$/u.test(env.EKY_EVIDENCE_JOB_KEY ?? '')
    || !/^[a-f0-9]{40}$/u.test(env.GITHUB_SHA ?? '')) throw failure();
  return { runId: env.GITHUB_RUN_ID, attempt: env.GITHUB_RUN_ATTEMPT,
    job: env.GITHUB_JOB, jobKey: env.EKY_EVIDENCE_JOB_KEY, sourceRevision: env.GITHUB_SHA };
}

export async function collectJobFailureEvidence(env, { nativeTemp = env.RUNNER_TEMP } = {}) {
  const binding = jobEvidenceBinding(env);
  const { fingerprint, key } = evidenceRecipient(env);
  const temp = await realpath(env.RUNNER_TEMP);
  const checkout = await realpath(env.GITHUB_WORKSPACE);
  const native = await realpath(nativeTemp);
  const root = join(temp, `eky-job-evidence-${binding.runId}-${binding.attempt}-${binding.jobKey}-${randomUUID()}`);
  await mkdir(root, { mode: 0o700 });
  await writeFile(join(root, 'recipient.asc'), key, { flag: 'wx', mode: 0o600 });
  const stage = join(root, 'retained');
  await mkdir(stage, { mode: 0o700 });
  const manifest = { schemaVersion: 1, binding, scope: 'ciFailureEvidence',
    jobOutcome: outcomes.has(env.EKY_EVIDENCE_JOB_OUTCOME) ? env.EKY_EVIDENCE_JOB_OUTCOME : 'unknown',
    cleanup: 'notInferred', unresolvedEvidenceHold: true,
    publicCommandLog: 'githubWorkflowLog', files: [], sources: [],
    exclusions: ['databases', 'profiles', 'environment', 'configuration', 'unreviewedTraces', 'memoryDumps', 'dependencyToolRawOutput'] };
  let total = 0;
  const select = async (base, path, area, location, relativePath) => {
    const kind = evidenceSourceKind(area, relativePath);
    if (kind === null) return;
    if (manifest.files.length >= MAX_FILES) return;
    const name = `${String(manifest.files.length).padStart(4, '0')}.private`;
    const entry = { name, source: `${area}/${relativePath}`, location, kind, status: 'unverified' };
    manifest.files.push(entry);
    try {
      const info = await ordinaryPath(base, path);
      if (info.size > MAX_FILE) { entry.status = 'tooLarge'; return; }
      if (info.size > MAX_TOTAL - total) { entry.status = 'totalLimit'; return; }
      let proof = await retain(base, path, join(stage, name), MAX_FILE);
      if (kind === 'playwrightReport') {
        const bytes = Buffer.from(JSON.stringify(projectPlaywrightFailureReport(
          JSON.parse(await readFile(join(stage, name), 'utf8')))));
        if (bytes.length > MAX_FILE || bytes.length > MAX_TOTAL - total) { entry.status = 'tooLarge'; return; }
        entry.sourceProof = proof;
        entry.projection = 'failureFieldsWithoutConfigurationOrInlineAttachments';
        await writeFile(join(stage, name), bytes);
        proof = { bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
      }
      total += proof.bytes;
      Object.assign(entry, proof, { status: 'retained' });
    } catch (error) { entry.status = error.code === 'ENOENT' ? 'missing' : 'unverified'; }
  };
  for (const [area, location, base, start] of [
    ['reports', 'checkout', checkout, join(checkout, 'eky_software/apps/e2e/playwright-report')],
    ['results', 'checkout', checkout, join(checkout, 'eky_software/apps/e2e/test-results')],
    ['temporary', 'runnerTemp', temp, temp],
    ...(native === temp ? [] : [['temporary', 'nativeTemp', native, native]]),
  ]) {
    const fileLimit = area === 'temporary' && native === temp ? MAX_FILES / 2 : MAX_FILES / 4;
    const source = { area, location, status: 'complete', examinedEntries: 0, fileLimit };
    manifest.sources.push(source);
    const firstFile = manifest.files.length;
    const deadline = performance.now() + MAX_SOURCE_MILLISECONDS;
    const exhausted = () => manifest.files.length - firstFile >= fileLimit
      || performance.now() >= deadline;
    const walk = async (directory, prefix, depth) => {
      if (depth > MAX_DEPTH || source.examinedEntries >= MAX_ENTRIES || exhausted() || manifest.files.length >= MAX_FILES) {
        source.status = 'limited'; return;
      }
      if (directory !== base) await ordinaryPath(base, directory, true);
      const entries = [];
      for await (const item of await opendir(directory)) {
        if (performance.now() >= deadline) { source.status = 'limited'; break; }
        if (depth === 0 && area === 'temporary' && !/^(?:eky supervisor |eky-(?:t-|acceptance-command-|desktop-smoke$|(?:clean|upgrade|legacy|workspace)-caller-))/u.test(item.name)) continue;
        if (depth === 0 && area !== 'temporary' && !new RegExp(`^${runPattern}$`, 'u').test(item.name)) continue;
        if (++source.examinedEntries > MAX_ENTRIES) { source.status = 'limited'; break; }
        const path = join(directory, item.name);
        const rel = prefix ? `${prefix}/${item.name}` : item.name;
        let modified = 0;
        try { modified = (await lstat(path)).mtimeMs; } catch { source.status = 'partial'; }
        entries.push({ item, path, rel, modified });
      }
      // Current reports get their own quota; newest native roots precede retained earlier tests.
      entries.sort((left, right) => right.modified - left.modified || left.rel.localeCompare(right.rel));
      for (const { item, path, rel } of entries) {
        if (exhausted() || manifest.files.length >= MAX_FILES) { source.status = 'limited'; break; }
        if (item.isDirectory()) {
          if (['node_modules', '.npm-cache', 'cache', 'user-data', 'profiles', 'database', 'storage'].includes(item.name)) continue;
          try { await walk(path, rel, depth + 1); } catch { source.status = 'partial'; }
        } else if (item.isSymbolicLink()) {
          source.status = 'partial';
          await select(base, path, area, location, rel);
        } else if (item.isFile()) await select(base, path, area, location, rel);
      }
    };
    try { await walk(start, '', 0); }
    catch (error) { source.status = error.code === 'ENOENT' ? 'missing' : 'unverified'; }
  }
  const archivePath = join(root, 'evidence.private.json.gz');
  await writeEvidenceArchive({ temp, stage, archivePath, manifest });
  return { root, archivePath, fingerprint, manifest };
}

export function jobEvidenceGit(env, platform = process.platform) {
  const tools = { win32: { runner: 'Windows', git: 'git.exe' }, linux: { runner: 'Linux', git: 'git' } }[platform];
  if (!tools || env.RUNNER_OS !== tools.runner
    || env.GITHUB_ACTIONS !== 'true' || env.RUNNER_ENVIRONMENT !== 'github-hosted'
    || !['push', 'schedule', 'workflow_dispatch', 'pull_request'].includes(env.GITHUB_EVENT_NAME)) throw failure();
  return tools.git;
}

export async function runJobEvidence(env = process.env) {
  const git = jobEvidenceGit(env);
  if (!isAbsolute(env.GITHUB_OUTPUT ?? '') || !isAbsolute(env.GITHUB_EVENT_PATH ?? '')) throw failure();
  const eventInfo = await lstat(env.GITHUB_EVENT_PATH);
  if (!eventInfo.isFile() || eventInfo.isSymbolicLink() || eventInfo.size > 2 * MiB) throw failure();
  const event = JSON.parse(await readFile(env.GITHUB_EVENT_PATH, 'utf8'));
  if (env.GITHUB_EVENT_NAME === 'pull_request' &&
    (!env.GITHUB_REPOSITORY || event.pull_request?.head?.repo?.full_name !== env.GITHUB_REPOSITORY)) throw failure();
  if (event.pull_request && event.pull_request.head?.repo?.full_name !== env.GITHUB_REPOSITORY) throw failure();
  await new Promise((accept, reject) => {
    execFile(git, ['rev-parse', 'HEAD'], { cwd: env.GITHUB_WORKSPACE,
      timeout: 10_000, maxBuffer: 4096, windowsHide: true }, (error, stdout) => {
      if (error || stdout.trim() !== env.GITHUB_SHA) reject(failure()); else accept();
    });
  });
  const collected = await collectJobFailureEvidence(env, { nativeTemp: tmpdir() });
  await encryptArchive(collected.root, collected, true);
  const ciphertext = join(collected.root, 'evidence.json.gz.gpg');
  const info = await ordinaryPath(await realpath(env.RUNNER_TEMP), ciphertext);
  if (info.size === 0 || info.size > MAX_TOTAL * 2) throw failure();
  console.log(JSON.stringify({ operation: 'ciFailureEvidence', status: 'sealed',
    retainedFiles: collected.manifest.files.filter(file => file.status === 'retained').length,
    missingOrRejectedFiles: collected.manifest.files.filter(file => file.status !== 'retained').length,
    sourceCoverage: collected.manifest.sources.map(({ area, status }) => ({ area, status })) }));
  await appendFile(env.GITHUB_OUTPUT, `ciphertext=${ciphertext}\nsealed=true\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runJobEvidence().catch(() => { console.error('CI_FAILURE_EVIDENCE_UNVERIFIED'); process.exitCode = 1; });
}
