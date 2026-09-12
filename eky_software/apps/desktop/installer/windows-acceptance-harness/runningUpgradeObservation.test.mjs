import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, link } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { classifyRunningUpgradeLog, readRunningUpgradeObservation,
  validateRunningUpgradeObservation } from './runningUpgradeObservation.mjs';

const at = (second) => new Date(2026, 0, 1, 10, 0, second).getTime();
const moments = { started: at(0), finished: at(20), closeRequested: at(4),
  applicationExitObserved: at(8), msiCompleted: at(15) };
const log = [
  'MSI (s) (12:34) [10:00:01:000]: Doing action: InstallFinalize',
  'Info 1603. The file synthetic-private.dll is being held in use.',
  'Info 1903. Scheduling reboot operation: Deleting file synthetic-private.rbf. Must reboot to complete operation.',
  'MSI (s) (12:34) [10:00:02:000]: continuing',
  "MSI (s) (12:34) [10:00:12:000]: PROPERTY CHANGE: Adding ReplacedInUseFiles property. Its value is '1'.",
  'Property(S): MsiSystemRebootPending = 1',
].join('\r\n');

test('verbose reboot observation preserves untimed-record uncertainty and closed fields', () => {
  const result = classifyRunningUpgradeLog(log, moments);
  assert.deepEqual(result, { status: 'observed', fileInUseObserved: true,
    scheduledDeletionObserved: true, replacedInUseFilesObserved: true, rebootPendingObserved: true,
    rebootAction: 'InstallFinalize', rebootVsCloseRequest: 'before',
    rebootVsExitObservation: 'before', msiCompletionVsExitObservation: 'after' });
  assert.equal(classifyRunningUpgradeLog(log, { ...moments, closeRequested: at(1) + 500 }).rebootVsCloseRequest, 'overlap');
  assert.equal(classifyRunningUpgradeLog(log, { ...moments, closeRequested: at(0) }).rebootVsCloseRequest, 'after');
  assert.equal(JSON.stringify(result).includes('synthetic-private'), false);
  assert.throws(() => validateRunningUpgradeObservation({ ...result, rawLog: log }));
  assert.throws(() => validateRunningUpgradeObservation({ ...result, rebootAction: 'private-action' }));
});

test('3010 without a logged reason is not silently assigned to files in use', () => {
  const result = classifyRunningUpgradeLog('MSI (c) (12:34) [10:00:15:000]: MainEngineThread is returning 3010', moments);
  assert.equal(result.status, 'observed');
  assert.equal(result.scheduledDeletionObserved, false);
  assert.equal(result.fileInUseObserved, false);
  assert.equal(result.rebootVsExitObservation, 'unknown');
  assert.equal(result.rebootAction, 'unknown');
  assert.equal(classifyRunningUpgradeLog('', moments).status, 'unavailable');
  const outOfOrder = log.replace('[10:00:02:000]', '[10:00:00:500]');
  assert.equal(classifyRunningUpgradeLog(outOfOrder, moments).scheduledDeletionObserved, true);
  assert.equal(classifyRunningUpgradeLog(outOfOrder, moments).rebootVsExitObservation, 'unknown');
  const outsideRun = log.replace('[10:00:02:000]', '[10:01:00:000]');
  assert.equal(classifyRunningUpgradeLog(outsideRun, moments).rebootVsCloseRequest, 'unknown');
});

test('time-only MSI records spanning midnight remain bounded by the actual run', () => {
  const started = new Date(2026, 0, 1, 23, 59, 59).getTime();
  const result = classifyRunningUpgradeLog(
    'MSI (s) (12:34) [00:00:00:000]: Info 1903. Scheduling reboot operation: Deleting file private.rbf.',
    { started, finished: started + 5000, closeRequested: started + 2000,
      applicationExitObserved: started + 3000, msiCompleted: started + 4000 });
  assert.equal(result.rebootVsCloseRequest, 'before');
  assert.equal(result.rebootVsExitObservation, 'before');
});

test('log reader handles UTF-16 and missing or hardlinked diagnostics without failing the operation', async () => {
  const root = await mkdtemp(join(tmpdir(), 'eky-msi-observation-'));
  try {
    const path = join(root, 'synthetic.log');
    assert.equal((await readRunningUpgradeObservation(path, moments)).status, 'unavailable');
    await writeFile(path, Buffer.concat([Buffer.from([255, 254]), Buffer.from(log, 'utf16le')]));
    assert.deepEqual(await readRunningUpgradeObservation(path, moments), classifyRunningUpgradeLog(log, moments));
    await link(path, join(root, 'linked.log'));
    assert.equal((await readRunningUpgradeObservation(path, moments)).status, 'unavailable');
  } finally { await rm(root, { recursive: true, force: true }); }
});
