import { randomUUID } from 'node:crypto';
import { lstatSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { E2eFixtureLifetime } from '../environment/e2eFixtureLifetime.js';

// Playwright clears the project output directory once per invocation, not on
// retries. A lost worker therefore cannot erase its unverified cleanup claim.
export function claimChromiumWorker(input: {
  outputDirectory: string; parallelIndex: number; globalTimeout: number; workers: number;
}, now = () => process.hrtime.bigint()): {
  readonly lifetime: E2eFixtureLifetime; releaseAfterVerifiedCleanup(): void;
} {
  const fail = () => new Error('E2E_CHROMIUM_WORKER_ADMISSION_REFUSED');
  if (input.workers !== 1 || input.parallelIndex !== 0 ||
      !Number.isSafeInteger(input.globalTimeout) || input.globalTimeout < 1 || input.globalTimeout > 2_147_483_647) throw fail();
  mkdirSync(input.outputDirectory, { recursive: true });
  const clockPath = join(input.outputDirectory, '.eky-chromium-clock.json');
  const read = (path: string) => {
    const stat = lstatSync(path);
    if (stat.isSymbolicLink() || !stat.isFile() || stat.size > 1024) throw fail();
    return JSON.parse(readFileSync(path, 'utf8')) as unknown;
  };
  const origin = now();
  try {
    writeFileSync(clockPath, JSON.stringify({ schemaVersion: 1, origin: origin.toString(),
      budget: input.globalTimeout }), { flag: 'wx', mode: 0o600 });
  } catch (error) {
    if (!(error instanceof Error) || !('code' in error) || error.code !== 'EEXIST') throw fail();
  }
  const clock = read(clockPath);
  if (clock === null || typeof clock !== 'object' || Array.isArray(clock) ||
      Object.keys(clock).sort().join(',') !== 'budget,origin,schemaVersion') throw fail();
  const record = clock as { schemaVersion: unknown; origin: unknown; budget: unknown };
  if (record.schemaVersion !== 1 || record.budget !== input.globalTimeout || typeof record.origin !== 'string' ||
      !/^[0-9]{1,24}$/.test(record.origin)) throw fail();
  const start = BigInt(record.origin);
  const deadline = start + BigInt(input.globalTimeout) * 1_000_000n;
  let previous = origin;
  let clockLost = origin < start;
  const lifetime = Object.freeze({ readRemainingWorkMilliseconds() {
    const current = now();
    clockLost ||= current < previous;
    previous = current;
    if (clockLost) throw fail();
    return Number((deadline > current ? deadline - current : 0n) / 1_000_000n);
  } });
  if (lifetime.readRemainingWorkMilliseconds() < 1) throw fail();
  const claimPath = join(input.outputDirectory, '.eky-chromium-worker-pending.json');
  const claim = JSON.stringify({ schemaVersion: 1, token: randomUUID() });
  try { writeFileSync(claimPath, claim, { flag: 'wx', mode: 0o600 }); }
  catch { throw fail(); }
  let released = false;
  return { lifetime, releaseAfterVerifiedCleanup() {
    if (released) return;
    if (JSON.stringify(read(claimPath)) !== claim) throw fail();
    unlinkSync(claimPath);
    released = true;
  } };
}
