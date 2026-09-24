import { randomUUID } from 'node:crypto';
import { existsSync, linkSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync, writeSync } from 'node:fs';
import { join } from 'node:path';

import { errors, expect, test } from '@playwright/test';

import {
  createFirstStartProofObserver,
  createFirstStartProofAdmission,
  firstStartProofObservationPath,
  MAX_FIRST_START_PROOF_OBSERVATIONS,
  MAX_FIRST_START_PROOF_OBSERVATION_BYTES,
  parseFirstStartProofObservations,
  type FirstStartProofCapture,
  type FirstStartProofPhase,
} from '../../../desktop/e2e/workspaceFirstStartProofObservation.js';
import { captureFirstStartProof } from '../../src/fixtures/captureFirstStartProof.js';
import { createE2eRunRoot } from '../../src/environment/createE2eRunRoot.js';
import { removeE2eRunRoot } from '../../src/environment/removeE2eRunRoot.js';
import { finishIsolatedElectronTest, reportElectronLifecycleEvidence } from '../../src/fixtures/isolatedElectronTest.js';

test.describe('SYS-FIRST-START-EVIDENCE-001 @critical @security', () => {
  test('keeps timed-out proof progress through owned cleanup and root deletion without evaluate', async ({}, testInfo) => {
    const root = createE2eRunRoot();
    const runtimeId = randomUUID();
    let time = 10;
    const observer = createFirstStartProofObserver(root, runtimeId, () => time);
    let captured: FirstStartProofCapture = { status: 'notRequested' };
    const calls: string[] = [];
    const original = new errors.TimeoutError('private evaluation timeout');
    observer.record('initialShutdownStarted');
    time = 15;
    observer.record('initialShutdownCompleted');
    observer.record('proofStarted');
    time = 22;
    observer.record('mixedStartup');
    // The proof's own finally can delete its subtree before fixture teardown.
    const proofRoot = join(root, 'w6-synthetic');
    mkdirSync(proofRoot);
    writeFileSync(join(proofRoot, 'progress.jsonl'), 'private discarded progress');
    rmSync(proofRoot, { recursive: true });
    try {
      await expect(finishIsolatedElectronTest({
        failure: { error: original }, testAlreadyFailed: false,
        async disposeApi() { calls.push('api'); },
        async closeRuntime() { calls.push('runtime'); observer.close(); },
        async releasePort() { calls.push('port'); },
        captureEvidence() {
          calls.push('capture');
          captured = captureFirstStartProof(root, runtimeId);
        },
        async removeRoot() { calls.push('remove'); await removeE2eRunRoot(root); },
        async report(cleanup) {
          calls.push('report');
          expect(existsSync(root)).toBe(false);
          await reportElectronLifecycleEvidence(testInfo, {
            launch: [], observationsTruncated: false, cleanup, firstStartProof: captured,
          });
        },
      })).rejects.toBe(original);
      expect(calls).toEqual(['api', 'runtime', 'port', 'capture', 'remove', 'report']);
      const text = readFileSync(testInfo.outputPath('electron-lifecycle.json'), 'utf8');
      const evidence = JSON.parse(text);
      expect(evidence.firstStartProof).toEqual({
        status: 'captured', truncated: false,
        observations: [
          record('initialShutdownStarted', 0), record('initialShutdownCompleted', 5),
          record('proofStarted', 5), record('mixedStartup', 12),
        ],
      });
      expect(evidence.cleanup).toEqual({ api: 'completed', runtime: 'completed', port: 'released', runRoot: 'removed' });
      expect(text).not.toContain(runtimeId);
      expect(text).not.toMatch(/private|w6-synthetic|session|userData/);
    } finally { observer.close(); await removeIfPresent(root); }
  });

  test('captures even if runtime cleanup is unverified without deleting or upgrading cleanup', async () => {
    const root = createE2eRunRoot();
    const runtimeId = randomUUID();
    const observer = createFirstStartProofObserver(root, runtimeId);
    observer.record('initialShutdownStarted');
    observer.close();
    let captured: FirstStartProofCapture = { status: 'notRequested' };
    let removed = false;
    try {
      await expect(finishIsolatedElectronTest({
        failure: undefined, testAlreadyFailed: false,
        async disposeApi() {}, async closeRuntime() { throw new Error('private'); },
        async releasePort() {},
        captureEvidence() { captured = captureFirstStartProof(root, runtimeId); },
        async removeRoot() { removed = true; },
        async report(cleanup) {
          expect(cleanup.runtime).toBe('unverified');
          expect(cleanup.runRoot).toBe('retained');
        },
      })).rejects.toThrow('E2E_ELECTRON_CLEANUP_FAILED');
      expect(captured.status).toBe('captured');
      expect(removed).toBe(false);
      expect(existsSync(root)).toBe(true);
    } finally { await removeIfPresent(root); }
  });

  test('capture failure cannot skip cleanup, replace the first error or silently pass', async () => {
    for (const original of [new Error('private original'), undefined]) {
      const calls: string[] = [];
      const promise = finishIsolatedElectronTest({
        failure: original === undefined ? undefined : { error: original },
        testAlreadyFailed: false,
        async disposeApi() { calls.push('api'); },
        async closeRuntime() { calls.push('runtime'); },
        async releasePort() { calls.push('port'); },
        captureEvidence() { calls.push('capture'); throw new Error('private read'); },
        async removeRoot() { calls.push('remove'); },
        async report() { calls.push('report'); },
      });
      if (original === undefined) await expect(promise).rejects.toThrow('E2E_ELECTRON_EVIDENCE_FAILED');
      else await expect(promise).rejects.toBe(original);
      expect(calls).toEqual(['api', 'runtime', 'port', 'capture', 'remove', 'report']);
    }
  });

  test('bounds writes and reads and uses a monotonic, identifier-free closed snapshot', async () => {
    const root = createE2eRunRoot();
    const runtimeId = randomUUID();
    let time = 100;
    const observer = createFirstStartProofObserver(root, runtimeId, () => time);
    try {
      observer.record('initialShutdownStarted');
      time = 99;
      for (let i = 0; i < MAX_FIRST_START_PROOF_OBSERVATIONS + 10; i++) observer.record('setup');
      const captured = captureFirstStartProof(root, runtimeId);
      expect(captured.status).toBe('captured');
      if (captured.status !== 'captured') throw new Error('Expected captured observations');
      expect(captured.observations).toHaveLength(MAX_FIRST_START_PROOF_OBSERVATIONS);
      expect(captured.truncated).toBe(true);
      expect(captured.observations.at(-1)).toEqual(record('observationsTruncated', 0));
      const bytes = readFileSync(firstStartProofObservationPath(root, runtimeId));
      expect(bytes.byteLength).toBeLessThanOrEqual(MAX_FIRST_START_PROOF_OBSERVATION_BYTES);
      expect(bytes.toString()).not.toContain(runtimeId);
    } finally { observer.close(); await removeIfPresent(root); }
  });

  test('does not attribute a previous process generation to a fresh runtime', async () => {
    const root = createE2eRunRoot();
    const previousId = randomUUID();
    const observer = createFirstStartProofObserver(root, previousId);
    try {
      observer.record('proofCompleted');
      observer.close();
      expect(captureFirstStartProof(root, randomUUID())).toEqual({ status: 'missing' });
      const originalBytes = readFileSync(firstStartProofObservationPath(root, previousId));
      const duplicate = createFirstStartProofObserver(root, previousId);
      duplicate.record('proofStarted');
      duplicate.close();
      expect(readFileSync(firstStartProofObservationPath(root, previousId))).toEqual(originalBytes);
    } finally { observer.close(); await removeIfPresent(root); }
  });

  test('admits only one invocation before any asynchronous work, even after failure', async () => {
    const admit = createFirstStartProofAdmission();
    let work = 0;
    const original = new Error('private proof failure');
    const invoke = async () => {
      admit();
      work++;
      await Promise.resolve();
      throw original;
    };
    const first = invoke();
    await expect(invoke()).rejects.toThrow('E2E_FIRST_START_PROOF_ALREADY_REQUESTED');
    await expect(first).rejects.toBe(original);
    await expect(invoke()).rejects.toThrow('E2E_FIRST_START_PROOF_ALREADY_REQUESTED');
    expect(work).toBe(1);
    expect(() => createFirstStartProofAdmission()()).not.toThrow();
  });

  test('failed or partial writes preserve earlier complete evidence and do not replace the proof error', async () => {
    const root = createE2eRunRoot();
    try {
      for (const partial of [false, true]) {
        const id = randomUUID();
        let writes = 0;
        const observer = createFirstStartProofObserver(root, id, () => 0, (fd, line) => {
          writes++;
          if (writes === 1) return writeSync(fd, line);
          if (partial) return writeSync(fd, line.subarray(0, 10));
          throw new Error('private filesystem failure');
        });
        const original = new Error('private proof error');
        const proof = async () => {
          observer.record('initialShutdownStarted');
          observer.record('proofStarted');
          throw original;
        };
        await expect(proof()).rejects.toBe(original);
        observer.record('proofFailed');
        observer.close();
        expect(writes).toBe(2);
        expect(captureFirstStartProof(root, id)).toEqual({
          status: partial ? 'partial' : 'captured', truncated: false,
          observations: [record('initialShutdownStarted')],
        });
      }
    } finally { await removeIfPresent(root); }
  });

  test('initialization, writer and clock errors stay out of the test outcome', async () => {
    const root = createE2eRunRoot();
    try {
      const missing = createFirstStartProofObserver(join(root, 'absent'), randomUUID());
      expect(() => missing.record('setup')).not.toThrow();
      missing.close();
      const id = randomUUID();
      const observer = createFirstStartProofObserver(root, id, () => Number.NaN);
      expect(() => observer.record('setup')).not.toThrow();
      observer.close();
      expect(captureFirstStartProof(root, id)).toEqual({ status: 'invalid' });
      const rejected = createFirstStartProofObserver(root, randomUUID());
      expect(() => rejected.record('private-secret' as FirstStartProofPhase)).not.toThrow();
      rejected.close();
      for (const write of [() => { throw new Error('private write failure'); }, () => 0]) {
        const failedId = randomUUID();
        const failed = createFirstStartProofObserver(root, failedId, () => 0, write);
        expect(() => failed.record('setup')).not.toThrow();
        failed.close();
        expect(captureFirstStartProof(root, failedId)).toEqual({ status: 'invalid' });
      }
    } finally { await removeIfPresent(root); }
  });

  test('refuses linked roots without reading another directory', async () => {
    const root = createE2eRunRoot();
    const target = join(root, 'target');
    const linked = join(root, 'linked');
    const id = randomUUID();
    mkdirSync(target);
    try {
      const observer = createFirstStartProofObserver(target, id);
      observer.record('setup');
      observer.close();
      symlinkSync(target, linked, process.platform === 'win32' ? 'junction' : 'dir');
      expect(captureFirstStartProof(linked, id)).toEqual({ status: 'readFailed' });
    } finally {
      if (existsSync(linked)) rmSync(linked);
      await removeIfPresent(root);
    }
  });

  test('rejects missing, malformed, oversized, unreadable and multiply linked files safely', async () => {
    const root = createE2eRunRoot();
    const id = randomUUID();
    const path = firstStartProofObservationPath(root, id);
    try {
      expect(captureFirstStartProof(root, id)).toEqual({ status: 'missing' });
      expect(captureFirstStartProof(`${root}\0`, id)).toEqual({ status: 'readFailed' });
      writeFileSync(path, 'private invalid JSON\n');
      expect(captureFirstStartProof(root, id)).toEqual({ status: 'invalid' });
      writeFileSync(path, 'x'.repeat(MAX_FIRST_START_PROOF_OBSERVATION_BYTES + 1));
      expect(captureFirstStartProof(root, id)).toEqual({ status: 'tooLarge' });
      writeFileSync(path, `${JSON.stringify(record('setup'))}\n`);
      linkSync(path, join(root, 'same-evidence-link'));
      expect(captureFirstStartProof(root, id)).toEqual({ status: 'invalid' });
    } finally { await removeIfPresent(root); }
  });

  test('preserves only validated complete records when the last write was interrupted', () => {
    const complete = `${JSON.stringify(record('mixedStartup', 17))}\n`;
    expect(parseFirstStartProofObservations(`${complete}{"private":"incomplete`)).toEqual({
      status: 'partial', observations: [record('mixedStartup', 17)], truncated: false,
    });
    expect(parseFirstStartProofObservations('{')).toEqual({ status: 'invalid' });
  });

  test('rejects unrecognized keys, phases, schemas, numbers, ordering and excessive records', () => {
    const bad: unknown[] = [
      { ...record('setup'), path: 'private' }, { ...record('setup'), phase: 'private' },
      { ...record('setup'), schemaVersion: 2 }, { ...record('setup'), elapsedMs: -1 },
      { ...record('setup'), elapsedMs: 0.5 }, { ...record('setup'), elapsedMs: Number.MAX_SAFE_INTEGER + 1 },
      { ...record('setup'), elapsedMs: '0' }, null, [],
    ];
    for (const value of bad) {
      expect(parseFirstStartProofObservations(`${JSON.stringify(value)}\n`)).toEqual({ status: 'invalid' });
    }
    for (const values of [
      [record('setup', 2), record('mixedStartup', 1)],
      [record('observationsTruncated'), record('setup')],
      Array.from({ length: MAX_FIRST_START_PROOF_OBSERVATIONS + 1 }, () => record('setup')),
    ]) {
      expect(parseFirstStartProofObservations(values.map((value) => `${JSON.stringify(value)}\n`).join(''))).toEqual({ status: 'invalid' });
    }
  });
});

function record(phase: FirstStartProofPhase, elapsedMs = 0) {
  return { schemaVersion: 1 as const, phase, elapsedMs };
}

async function removeIfPresent(root: string) {
  if (existsSync(root)) await removeE2eRunRoot(root);
}
