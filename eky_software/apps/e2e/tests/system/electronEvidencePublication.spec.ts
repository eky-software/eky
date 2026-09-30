import { readFileSync, writeFileSync } from 'node:fs';
import { expect, test, type TestInfo } from '@playwright/test';
import { reportElectronLifecycleEvidence } from '../../src/fixtures/isolatedElectronTest.js';

const evidence = {
  launch: [], observationsTruncated: false,
  cleanup: { api: 'completed', runtime: 'completed', port: 'released', runRoot: 'retained' },
} as const;

test.describe('SYS-ELECTRON-EVIDENCE-PUBLICATION-001 @critical @security', () => {
  for (const failure of ['path', 'write', 'attachment', 'both'] as const) {
    test(`preserves the other existing delivery and closed metadata when ${failure} fails`, async ({}, info) => {
      const path = info.outputPath('publication-fixture.json');
      if (failure === 'write') writeFileSync(path, 'first-attempt-evidence', { flag: 'wx' });
      const annotations: TestInfo['annotations'] = [];
      let attached: string | undefined;
      let attachmentCalls = 0;
      const fakeInfo = {
        retry: info.retry, annotations,
        outputPath() {
          if (failure === 'path' || failure === 'both') throw new Error('private output path');
          return path;
        },
        async attach(_name: string, options: { body: string }) {
          attachmentCalls++;
          if (failure === 'attachment' || failure === 'both') throw new Error('private attachment failure');
          attached = options.body;
        },
      } as unknown as TestInfo;
      await expect(reportElectronLifecycleEvidence(fakeInfo, evidence)).rejects.toThrow('E2E_ELECTRON_EVIDENCE_FAILED');
      expect(attachmentCalls).toBe(1);
      expect(annotations).toEqual([
        ...(failure !== 'attachment' ? [{ type: 'electron-evidence-failure', description: 'fileWriteFailed' }] : []),
        ...(failure === 'attachment' || failure === 'both'
          ? [{ type: 'electron-evidence-failure', description: 'attachmentFailed' }] : []),
      ]);
      expect(JSON.stringify(annotations)).not.toContain('private');
      if (failure === 'attachment') {
        expect(JSON.parse(readFileSync(path, 'utf8')).cleanup.runRoot).toBe('retained');
      } else if (failure !== 'both') {
        expect(JSON.parse(attached!).attempt).toBe(info.retry);
        expect(JSON.parse(attached!).cleanup.runRoot).toBe('retained');
      }
      if (failure === 'write') expect(readFileSync(path, 'utf8')).toBe('first-attempt-evidence');
    });
  }

  test('successful delivery uses identical bytes for the retained file and in-memory attachment', async ({}, info) => {
    await reportElectronLifecycleEvidence(info, evidence);
    const firstBytes = readFileSync(info.outputPath('electron-lifecycle.json'));
    const attachment = info.attachments.find(item => item.name === 'electron-lifecycle');
    expect(attachment?.body).toEqual(firstBytes);
    expect(attachment?.path).toBeUndefined();
    expect(info.annotations.filter(value => value.type === 'electron-evidence-failure')).toEqual([]);
  });
});
