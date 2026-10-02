import { writeFile } from 'node:fs/promises';
import type { TestInfo } from '@playwright/test';

import { defaultProcessOutputLimitBytes } from '../environment/boundedProcessOutput.js';

type StartupOutputKind = 'backend-startup' | 'electron-launch';
type StartupOutput = Readonly<{ stdout: string; stderr: string }>;
type ReportContext = Pick<TestInfo, 'outputPath' | 'attach' | 'annotations'>;
interface FixtureOutputSource {
  name: 'backend' | 'web' | 'nativeOwner';
  role: 'current' | 'firstLaunchFailure' | 'lastStarted';
  generation: number | null;
  read(): StartupOutput | undefined;
}

// Call only from post-cleanup reporting, using existing redacted process readers.
export async function reportStartupProcessOutput(
  testInfo: ReportContext,
  kind: StartupOutputKind,
  read: () => StartupOutput | undefined,
): Promise<void> {
  const output = captureOutput(read);
  await attachOutputEvidence(testInfo,
    kind === 'backend-startup' ? 'backend-startup.private.json' : 'process-output.private.json',
    `${kind}-output`, 'startup-output-evidence', { kind, source: output.source }, {
      schemaVersion: 1, kind, ...output, scope: 'boundedRedactedTail',
      streamSource: kind === 'backend-startup' ? 'backend' : 'nativeOwner',
      ...(kind === 'electron-launch' ? { workloadOutput: 'notCaptured' } : {}),
      limitBytesPerStream: defaultProcessOutputLimitBytes,
    });
}

export async function reportFixtureProcessOutput(
  testInfo: ReportContext,
  family: 'backend' | 'web' | 'electron',
  sources: readonly FixtureOutputSource[],
): Promise<void> {
  const streams = sources.slice(0, 2).map(({ name, role, generation, read }) => ({
    name, role, generation, ...captureOutput(read),
    ...(name === 'nativeOwner' ? { workloadOutput: 'notCaptured' } : {}),
  }));
  await attachOutputEvidence(testInfo, 'process-output.private.json', 'fixture-process-output',
    'fixture-output-evidence', { family, sources: streams.map(({ name, source }) => ({ name, source })) }, {
      schemaVersion: 1, kind: 'fixture-failure', family, scope: 'boundedRedactedTail',
      limitBytesPerStream: defaultProcessOutputLimitBytes, sourcesTruncated: sources.length > 2,
      operationalLogs: 'notIncluded', streams,
    });
}

function captureOutput(read: () => StartupOutput | undefined) {
  let source: 'available' | 'unavailable' | 'readFailed' = 'unavailable';
  let output: StartupOutput | undefined;
  try {
    const value = read();
    if (value !== undefined) {
      output = { stdout: boundedTail(value.stdout), stderr: boundedTail(value.stderr) };
      source = 'available';
    }
  } catch { source = 'readFailed'; }
  return { source, ...output };
}

async function attachOutputEvidence(
  testInfo: ReportContext, basename: string, attachmentName: string, annotationType: string,
  availability: object, evidence: object,
): Promise<void> {
  let file: 'written' | 'writeFailed' = 'writeFailed';
  let attachment: 'attached' | 'attachmentFailed' | 'notAttempted' = 'notAttempted';
  try {
    const path = testInfo.outputPath(basename);
    await writeFile(path, JSON.stringify(evidence), { flag: 'wx', mode: 0o600 });
    file = 'written';
    attachment = 'attachmentFailed';
    await testInfo.attach(attachmentName, { path, contentType: 'application/json' });
    attachment = 'attached';
  } catch { /* Evidence failure must not replace the original startup error. */ }
  try {
    testInfo.annotations.push({
      type: annotationType,
      description: JSON.stringify({ ...availability, file, attachment }),
    });
  } catch { /* Best effort when the reporting context is already unavailable. */ }
}

function boundedTail(text: string): string {
  const bytes = Buffer.from(text);
  let start = Math.max(0, bytes.length - defaultProcessOutputLimitBytes);
  // Do not turn a cut UTF-8 character into an extra replacement character.
  while (start < bytes.length && (bytes[start]! & 0xc0) === 0x80) start++;
  return bytes.subarray(start).toString('utf8');
}
