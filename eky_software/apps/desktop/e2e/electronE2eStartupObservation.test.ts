import { describe, expect, it } from 'vitest';
import { desktopStartupStagePhases } from '../src/main/desktopStartupObservation.js';
import { createElectronE2eStartupObservation, parseElectronE2eStartupObservation } from './electronE2eStartupObservation.js';

describe('Electron startup main observation', () => {
  it('dispatches strict legacy v2 and current v3 without silently changing their fields', () => {
    const current = createElectronE2eStartupObservation(() => 0).snapshot();
    const { mainStartup: _main, schemaVersion: _version, ...common } = current;
    const legacy = { schemaVersion: 2, ...common };
    expect(parseElectronE2eStartupObservation(legacy)).toEqual(legacy);
    expect(parseElectronE2eStartupObservation(current)).toEqual(current);
    expect(parseElectronE2eStartupObservation(legacy)).not.toHaveProperty('mainStartup');
    for (const invalid of [{ ...legacy, mainStartup: current.mainStartup },
      { ...common, schemaVersion: 3 }, { ...current, schemaVersion: 4 }, { ...current, extra: true }]) {
      expect(parseElectronE2eStartupObservation(invalid)).toBeUndefined();
    }
  });

  it('retains one latest main stage independently of bounded checkpoints and backend progress', () => {
    let time = 0;
    const observation = createElectronE2eStartupObservation(() => time);
    for (let i = 0; i < 17; i++) observation.record('backendStartRequested');
    observation.recordBackendStartupStage('moduleImport');
    const before = observation.snapshot();
    for (let i = 0; i < 1000; i++) {
      time++;
      observation.recordMainStartup({ stage: 'snapshotStatus', phase: 'work', event: 'entered' });
      observation.recordMainStartup({ stage: 'inspectionShutdown', phase: 'cleanup', event: 'returned' });
    }
    const after = observation.snapshot();
    expect(after.checkpoints).toHaveLength(16);
    expect(after.checkpoints).toEqual(before.checkpoints);
    expect(after.truncated).toBe(true);
    expect(after.backendStartup).toEqual(before.backendStartup);
    expect(after.mainStartup).toEqual({ status: 'observed', stage: 'inspectionShutdown',
      phase: 'cleanup', event: 'returned', elapsedMs: 1000 });
    expect(JSON.stringify(after).length).toBeLessThan(2000);
  });

  it('keeps detached immutable snapshots and closed phase/stage/event pairs', () => {
    const observation = createElectronE2eStartupObservation(() => 0);
    for (const stage of Object.keys(desktopStartupStagePhases) as (keyof typeof desktopStartupStagePhases)[]) {
      for (const event of ['entered', 'returned'] as const) {
        observation.recordMainStartup({ stage, phase: desktopStartupStagePhases[stage], event });
        const snapshot = observation.snapshot(), bytes = JSON.stringify(snapshot);
        const wire = JSON.parse(bytes);
        const parsed = parseElectronE2eStartupObservation(wire);
        expect(parsed).toEqual(snapshot);
        wire.mainStartup.stage = 'unknown';
        expect(parsed).toEqual(snapshot);
        expect(JSON.stringify(snapshot)).toBe(bytes);
        expect(Object.isFrozen(snapshot.mainStartup)).toBe(true);
        expect(Object.isFrozen(parsed)).toBe(true);
        expect(snapshot.mainStartup).not.toHaveProperty('pending');
        expect(snapshot.mainStartup).not.toHaveProperty('success');
      }
    }
  });

  it('rejects invalid fields and phases without losing the last valid observation', () => {
    const observation = createElectronE2eStartupObservation(() => 0);
    observation.recordMainStartup({ stage: 'snapshotStatus', phase: 'work', event: 'entered' });
    const before = observation.snapshot();
    const main = { status: 'observed', stage: 'inspectionShutdown', phase: 'cleanup', event: 'entered', elapsedMs: 0 };
    for (const invalid of [null, { status: 'unobserved', phase: 'work' }, { ...main, phase: 'work' },
      { ...main, event: 'pending' }, { ...main, stage: '__proto__' }, { ...main, secret: 'synthetic' },
      { ...main, elapsedMs: -1 }, { ...main, elapsedMs: 1.5 }, { ...main, elapsedMs: Infinity },
      { ...main, elapsedMs: Number.MAX_SAFE_INTEGER + 1 }, { ...main, phase: undefined }]) {
      expect(parseElectronE2eStartupObservation({ ...before, mainStartup: invalid })).toBeUndefined();
    }
    for (const invalid of [null, { stage: 'backendStop', phase: 'work', event: 'returned' },
      { stage: 'snapshotStatus', event: 'entered' },
      { stage: 'snapshotStatus', phase: 'work', event: 'entered', path: 'synthetic' }]) {
      observation.recordMainStartup(invalid as never);
      expect(observation.snapshot()).toEqual(before);
    }
  });

  it('does not replace the observation when the diagnostic clock fails', () => {
    let time: number | 'throw' = 0;
    const observation = createElectronE2eStartupObservation(() => {
      if (time === 'throw') throw undefined;
      return time;
    });
    observation.recordMainStartup({ stage: 'snapshotStatus', phase: 'work', event: 'entered' });
    const before = observation.snapshot();
    for (const invalid of ['throw', NaN, Infinity, Number.MAX_SAFE_INTEGER + 1] as const) {
      time = invalid;
      expect(() => observation.recordMainStartup({ stage: 'backendStop', phase: 'cleanup', event: 'entered' })).not.toThrow();
      expect(observation.snapshot()).toEqual(before);
    }
  });
});
