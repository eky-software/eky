import { spawnSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { classifyCiRisk, validateCiChangedPaths, validateCiRiskPlan } from './ciRiskPolicy.mjs';

const SHA = /^[0-9a-f]{40}$/;
const MAX_DIFF_BYTES = 4 * 1024 * 1024;

export function parseCiDiff(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length > MAX_DIFF_BYTES) throw new Error('CI_DIFF_INVALID');
  const value = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  if (value === '') return [];
  if (!value.endsWith('\0')) throw new Error('CI_DIFF_INVALID');
  return validateCiChangedPaths(value.slice(0, -1).split('\0'));
}

export function classifyCiChanges(environment, { git = spawnSync } = {}) {
  const eventName = environment.GITHUB_EVENT_NAME;
  const ref = environment.GITHUB_REF;
  let changedPaths = [];
  let comparisonComplete = false;
  if (eventName === 'pull_request' && SHA.test(environment.CI_BASE_SHA ?? '') && SHA.test(environment.CI_HEAD_SHA ?? '')) {
    try {
      // No rename folding: moving a sensitive file must retain its old path.
      const result = git('git', ['diff', '--no-ext-diff', '--no-textconv', '--no-renames', '--name-only', '-z',
        `${environment.CI_BASE_SHA}...${environment.CI_HEAD_SHA}`, '--'], {
        encoding: 'buffer', shell: false, timeout: 10_000, maxBuffer: MAX_DIFF_BYTES,
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      if (result.status === 0 && !result.error) {
        changedPaths = parseCiDiff(result.stdout);
        comparisonComplete = true;
      }
    } catch { /* An incomplete comparison selects all gates, never fewer. */ }
  }
  return classifyCiRisk({ eventName, ref, changedPaths, comparisonComplete });
}

export function publishCiRiskPlan(plan, outputPath, append = appendFileSync) {
  validateCiRiskPlan(plan);
  if (typeof outputPath !== 'string' || outputPath.length === 0) throw new Error('CI_OUTPUT_UNAVAILABLE');
  // The value contains only closed policy fields, never filenames or branch text.
  append(outputPath, `plan=${JSON.stringify(plan)}\n`, { encoding: 'utf8' });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (process.argv.length !== 2) throw new Error('CI_ARGUMENTS_INVALID');
    publishCiRiskPlan(classifyCiChanges(process.env), process.env.GITHUB_OUTPUT);
  } catch { process.exitCode = 1; }
}
