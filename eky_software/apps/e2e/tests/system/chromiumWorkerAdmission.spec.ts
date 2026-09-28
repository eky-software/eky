import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import { claimChromiumWorker } from '../../src/fixtures/chromiumWorkerAdmission.js';
import { requireChromiumReady, requireChromiumEndpoint, chromiumWorkerProtocol } from '../../src/environment/chromiumWorkerContract.mjs';

function fixture() {
  const outputDirectory = mkdtempSync(join(tmpdir(), 'eky-worker-admission-'));
  let now = 100_000_000_000n;
  const input = { outputDirectory, parallelIndex: 0, globalTimeout: 60_000, workers: 1 };
  return { input, claim: () => claimChromiumWorker(input, () => now),
    advance: (milliseconds: number) => { now += BigInt(milliseconds) * 1_000_000n; },
    dispose: () => rmSync(outputDirectory, { recursive: true, force: true }) };
}

test.describe('Chromium worker admission contract', () => {
  test('replacement worker does not renew the invocation containment ceiling', () => {
    const f = fixture();
    try {
      const first = f.claim();
      expect(first.lifetime.readRemainingWorkMilliseconds()).toBe(60_000);
      f.advance(20_000);
      first.releaseAfterVerifiedCleanup();
      first.releaseAfterVerifiedCleanup();
      const second = f.claim();
      expect(second.lifetime.readRemainingWorkMilliseconds()).toBe(40_000);
      second.releaseAfterVerifiedCleanup();
      f.advance(40_000);
      expect(f.claim).toThrow('E2E_CHROMIUM_WORKER_ADMISSION_REFUSED');
    } finally { f.dispose(); }
  });
  test('a lost worker keeps replacement admission closed', () => {
    const f = fixture();
    try {
      f.claim();
      f.advance(100);
      expect(f.claim).toThrow('E2E_CHROMIUM_WORKER_ADMISSION_REFUSED');
      expect(f.claim).toThrow('E2E_CHROMIUM_WORKER_ADMISSION_REFUSED');
    } finally { f.dispose(); }
  });
  test('release refuses to erase another identity and retains the stop marker', () => {
    const f = fixture();
    try {
      const first = f.claim();
      const marker = join(f.input.outputDirectory, '.eky-chromium-worker-pending.json');
      writeFileSync(marker, JSON.stringify({ schemaVersion: 1, token: 'different' }));
      expect(first.releaseAfterVerifiedCleanup).toThrow('E2E_CHROMIUM_WORKER_ADMISSION_REFUSED');
      expect(existsSync(marker)).toBe(true);
      expect(readFileSync(marker, 'utf8')).toContain('different');
    } finally { f.dispose(); }
  });
  test('clock rollback remains a failure even after the clock recovers', () => {
    const f = fixture();
    try {
      const worker = f.claim();
      f.advance(-1);
      expect(worker.lifetime.readRemainingWorkMilliseconds).toThrow();
      f.advance(2);
      expect(worker.lifetime.readRemainingWorkMilliseconds).toThrow();
      worker.releaseAfterVerifiedCleanup();
    } finally { f.dispose(); }
  });
  for (const change of [{ globalTimeout: 0 }, { globalTimeout: Infinity }, { parallelIndex: 1 }, { workers: 2 }]) {
    test(`rejects unsupported limits ${JSON.stringify(change)} before claiming`, () => {
      const f = fixture();
      try {
        expect(() => claimChromiumWorker({ ...f.input, ...change })).toThrow('E2E_CHROMIUM_WORKER_ADMISSION_REFUSED');
        expect(existsSync(join(f.input.outputDirectory, '.eky-chromium-worker-pending.json'))).toBe(false);
      } finally { f.dispose(); }
    });
  }
  for (const value of ['{}', 'null', '{"origin":"0","budget":60000,"schemaVersion":2}', 'x'.repeat(1025)]) {
    test(`rejects invalid clock record ${value.slice(0, 30)}`, () => {
      const f = fixture();
      try {
        writeFileSync(join(f.input.outputDirectory, '.eky-chromium-clock.json'), value);
        expect(f.claim).toThrow();
      } finally { f.dispose(); }
    });
  }
});

test.describe('Chromium private ready receipt', () => {
  const endpoint = 'ws://127.0.0.1:45123/' + 'x'.repeat(32);
  const generation = 'a'.repeat(64);
  const receipt = { protocol: chromiumWorkerProtocol, schemaVersion: 1, generation, endpoint };
  test('accepts only the current generation on loopback', () => {
    expect(requireChromiumReady(receipt, generation)).toBe(endpoint);
    expect(() => requireChromiumReady(receipt, 'b'.repeat(64))).toThrow('E2E_CHROMIUM_READY_INVALID');
  });
  for (const value of [endpoint.replace('127.0.0.1', 'example.invalid'), endpoint + '?secret=1',
    endpoint.replace('45123', '65536'), endpoint.replace('ws:', 'wss:'), endpoint + '/extra', 'private-input']) {
    test(`rejects invalid endpoint form ${value.indexOf('?') >= 0 ? 'query' : value.slice(0, 25)}`, () => {
      let message = '';
      try { requireChromiumEndpoint(value); } catch (error) { message = (error as Error).message; }
      expect(message).toBe('E2E_CHROMIUM_ENDPOINT_INVALID');
      expect(message).not.toContain(value);
    });
  }
  test('rejects extra fields without exposing their values', () => {
    expect(() => requireChromiumReady({ ...receipt, extra: 'PRIVATE' }, generation)).toThrow('E2E_CHROMIUM_READY_INVALID');
  });
});
