import { existsSync, readFileSync } from 'node:fs';
import { expect, test, type TestInfo } from '@playwright/test';

import { createBoundedProcessOutput, defaultProcessOutputLimitBytes } from '../../src/environment/boundedProcessOutput.js';
import { finishIsolatedElectronTest, reportElectronFixtureCompletion } from '../../src/fixtures/isolatedElectronTest.js';
import { reportFixtureProcessOutput, reportStartupProcessOutput } from '../../src/fixtures/reportStartupProcessOutput.js';

test.describe('startup output attachments @security', () => {
  for (const failure of ['body', 'assertion', 'api', 'runtime', 'port', 'remove', 'report'] as const) {
    test(`successful Electron launch exports current generation after ${failure} failure and handle clearing`, async ({}, info) => {
      let closed = false;
      const calls: string[] = [];
      const primary = new Error('synthetic primary failure');
      let bridge: { readStdout(): string; readStderr(): string } | undefined = {
        readStdout() { expect(closed).toBe(true); calls.push('read'); return 'synthetic owner [REDACTED]'; },
        readStderr: () => 'synthetic owner error',
      };
      const currentOutput = { bridge, generation: 3 };
      const reportInfo = {
        retry: info.retry, annotations: info.annotations,
        outputPath: (...segments: string[]) => info.outputPath(...segments),
        attach: async (name: string, options: Parameters<TestInfo['attach']>[1]) => {
          if (failure === 'report' && name === 'electron-lifecycle') throw new Error('synthetic report failure');
          await info.attach(name, options);
        },
      } as TestInfo;
      const run = finishIsolatedElectronTest({
        failure: failure === 'body' ? { error: primary } : undefined,
        testAlreadyFailed: failure === 'assertion',
        async disposeApi() { if (failure === 'api') throw new Error('synthetic api failure'); },
        async closeRuntime() {
          closed = true;
          bridge = undefined;
          if (failure === 'runtime') throw new Error('synthetic runtime cleanup failure');
        },
        async releasePort() { calls.push('port'); if (failure === 'port') throw new Error('synthetic port failure'); },
        async removeRoot() { if (failure === 'remove') throw new Error('synthetic remove failure'); },
        async report(cleanup) {
          await reportElectronFixtureCompletion(reportInfo, {
            failed: failure === 'body' || failure === 'assertion' || cleanup.runRoot !== 'removed',
            currentOutput, firstFailedLaunch: undefined,
            evidence: { launch: [], observationsTruncated: false, cleanup,
              ...(failure === 'report' ? { firstStartProof: { status: 'notRequested' as const } } : {}),
            },
          });
        },
      });
      if (failure === 'body') await expect(run).rejects.toBe(primary);
      else if (failure === 'assertion') await expect(run).resolves.toBeUndefined();
      else await expect(run).rejects.toThrow(failure === 'report' ? 'E2E_ELECTRON_EVIDENCE_FAILED' : 'E2E_ELECTRON_CLEANUP_FAILED');
      expect(bridge).toBeUndefined();
      expect(calls).toEqual(['port', 'read']);
      const report = JSON.parse(readFileSync(info.outputPath('process-output.private.json'), 'utf8'));
      expect(report.streams).toEqual([{ name: 'nativeOwner', role: 'current', generation: 3, source: 'available',
        stdout: 'synthetic owner [REDACTED]', stderr: 'synthetic owner error', workloadOutput: 'notCaptured' }]);
    });
  }

  test('keeps first failed and current Electron generations distinct without exporting a whole fixture', async ({}, info) => {
    await reportElectronFixtureCompletion(info, {
      failed: true,
      currentOutput: { generation: 2, bridge: { readStdout: () => 'current', readStderr: () => '' } },
      firstFailedLaunch: { generation: 1, bridge: { readStdout: () => 'first failure', readStderr: () => '' } },
      evidence: { launch: [], observationsTruncated: false,
        cleanup: { api: 'completed', runtime: 'completed', port: 'released', runRoot: 'retained' } },
    });
    const report = JSON.parse(readFileSync(info.outputPath('process-output.private.json'), 'utf8'));
    expect(report.streams.map(({ generation, role, stdout }: { generation: number; role: string; stdout: string }) => ({ generation, role, stdout })))
      .toEqual([{ generation: 1, role: 'firstLaunchFailure', stdout: 'first failure' }, { generation: 2, role: 'current', stdout: 'current' }]);
  });

  test('does not export current Electron output for a successful fixture', async ({}, info) => {
    await reportElectronFixtureCompletion(info, {
      failed: false, currentOutput: { generation: 1, bridge: { readStdout() { throw new Error('UNEXPECTED_READ'); }, readStderr: () => '' } },
      firstFailedLaunch: undefined,
      evidence: { launch: [], observationsTruncated: false,
        cleanup: { api: 'completed', runtime: 'completed', port: 'released', runRoot: 'removed' } },
    });
    expect(existsSync(info.outputPath('process-output.private.json'))).toBe(false);
  });

  test('one unavailable or unreadable service does not erase the other bounded stream', async ({}, info) => {
    await reportFixtureProcessOutput(info, 'web', [
      { name: 'backend', role: 'current', generation: null, read() { throw new Error('private read error'); } },
      { name: 'web', role: 'current', generation: null, read: () => ({ stdout: 'x'.repeat(defaultProcessOutputLimitBytes + 20), stderr: 'web error' }) },
    ]);
    const report = JSON.parse(readFileSync(info.outputPath('process-output.private.json'), 'utf8'));
    expect(report.streams[0]).toEqual({ name: 'backend', role: 'current', generation: null, source: 'readFailed' });
    expect(report.streams[1]).toMatchObject({ source: 'available', stderr: 'web error' });
    expect(Buffer.byteLength(report.streams[1].stdout)).toBe(defaultProcessOutputLimitBytes);
  });

  test('bounds already-redacted tails, attaches only file paths, and never overwrites first evidence', async ({}, info) => {
    const secret = 'synthetic-session-capability';
    const output = createBoundedProcessOutput(undefined, [secret]);
    output.append(Buffer.from('x'.repeat(defaultProcessOutputLimitBytes) + secret));
    await reportStartupProcessOutput(info, 'backend-startup', () => ({ stdout: output.read(), stderr: 'synthetic error' }));
    const path = info.outputPath('backend-startup.private.json');
    const original = readFileSync(path, 'utf8');
    const evidence = JSON.parse(original);
    expect(evidence.source).toBe('available');
    expect(evidence.stdout).toContain('[REDACTED]');
    expect(original).not.toContain(secret);
    expect(Buffer.byteLength(evidence.stdout)).toBeLessThanOrEqual(defaultProcessOutputLimitBytes);
    const attachment = info.attachments.find(item => item.name === 'backend-startup-output');
    expect(attachment?.path).toBeTruthy();
    expect(attachment?.body).toBeUndefined();
    await reportStartupProcessOutput(info, 'backend-startup', () => ({ stdout: 'second', stderr: '' }));
    expect(readFileSync(path, 'utf8')).toBe(original);
    expect(JSON.parse(info.annotations.at(-1)!.description!)).toMatchObject({ file: 'writeFailed', attachment: 'notAttempted' });
  });

  for (const source of ['unavailable', 'readFailed'] as const) {
    test(`records ${source} explicitly without exporting an exception`, async ({}, info) => {
      await reportStartupProcessOutput(info, 'electron-launch', () => {
        if (source === 'readFailed') throw new Error('synthetic private reader error');
        return undefined;
      });
      const evidence = JSON.parse(readFileSync(info.outputPath('process-output.private.json'), 'utf8'));
      expect(evidence).toEqual({ schemaVersion: 1, kind: 'electron-launch', source,
        scope: 'boundedRedactedTail', streamSource: 'nativeOwner', workloadOutput: 'notCaptured',
        limitBytesPerStream: defaultProcessOutputLimitBytes });
      expect(JSON.parse(info.annotations.at(-1)!.description!)).toEqual({
        kind: 'electron-launch', source, file: 'written', attachment: 'attached',
      });
    });
  }

  test('Electron output is read after teardown, and failed attachment preserves primary failure and the file', async ({}, info) => {
    const calls: string[] = [];
    const original = new Error('synthetic primary failure');
    const reporting: Pick<TestInfo, 'outputPath' | 'attach' | 'annotations'> = {
      outputPath: name => info.outputPath(name), annotations: info.annotations,
      async attach() { calls.push('attach'); throw new Error('synthetic private attachment error'); },
    };
    await expect(finishIsolatedElectronTest({
      failure: { error: original }, testAlreadyFailed: false,
      async disposeApi() { calls.push('api'); },
      async closeRuntime() { calls.push('runtime'); },
      async releasePort() { calls.push('port'); },
      async removeRoot() { calls.push('remove'); },
      async report() {
        await reportStartupProcessOutput(reporting, 'electron-launch', () => {
          calls.push('read');
          return { stdout: 'synthetic [REDACTED]', stderr: 'synthetic first-window error' };
        });
      },
    })).rejects.toBe(original);
    expect(calls).toEqual(['api', 'runtime', 'port', 'read', 'attach']);
    expect(JSON.parse(readFileSync(info.outputPath('process-output.private.json'), 'utf8')).stderr)
      .toBe('synthetic first-window error');
    expect(JSON.parse(info.annotations.at(-1)!.description!)).toMatchObject({ file: 'written', attachment: 'attachmentFailed' });
  });
});
