import { EventEmitter } from 'node:events';
import type { Socket } from 'node:net';

import { expect, test } from '@playwright/test';

import { validateBackendServiceReply } from '../../src/environment/windowsBackendServiceProtocol.js';
import { attachViteServiceControl } from '../../src/environment/windowsViteServiceControl.js';
import {
  viteServiceProtocol, viteServiceFrameBytes, createViteServiceFrameReader,
  encodeViteServiceRequest, validateViteServiceReply,
} from '../../src/environment/windowsViteServiceProtocol.js';
import { windowsServiceProfiles } from '../../src/environment/windowsServiceProfile.js';

const generation = 'a'.repeat(64);
const error = 'E2E_VITE_OWNER_PROTOCOL_INVALID';
const reply = (sequence = 1, replyTo: number | null = 1) => ({
  protocol: viteServiceProtocol, schemaVersion: 1, generation, sequence, replyTo, kind: 'status',
  elapsedMilliseconds: 200, cleanupStartedElapsedMilliseconds: null, remainingCleanupMilliseconds: null,
  rssBytes: null,
  state: { created: true, started: true, creationCompleted: true, launchClosed: true,
    identity: { pid: 42, creationTimeFileTimeHex: '0123456789abcdef' }, workload: 'running', exitCode: null,
    assignedBeforeResume: true, activeProcesses: 1, stdioSettled: false, firstFailure: null,
    cleanup: 'pending', cleanupFailure: null },
});

class SyntheticSocket extends EventEmitter {
  onWrite: (request: Record<string, unknown>) => void = () => {};
  write(frame: Buffer, callback: (error?: Error) => void) {
    queueMicrotask(() => { callback(); this.onWrite(JSON.parse(frame.toString())); });
    return true;
  }
  end() { this.emit('end'); this.emit('close'); }
  destroy() { this.emit('close'); }
  receive(value: unknown) { this.emit('data', Buffer.from(JSON.stringify(value) + '\n')); }
}

test.describe('Windows Vite service profile wire', () => {
  test('uses its own fixed mode, filenames, pipe and protocol', () => {
    expect(windowsServiceProfiles.vite).toEqual({ protocol: 'eky.e2e.vite-service', mode: '--vite-owner',
      pipePrefix: 'eky-e2e-vite-v1-', configName: 'vite-service-config.json',
      terminalName: 'vite-service-terminal.json', errorPrefix: 'E2E_VITE' });
    expect(JSON.parse(encodeViteServiceRequest(generation, 1, 'launch', 'b'.repeat(64), 49_000).toString()))
      .toEqual({ protocol: viteServiceProtocol, schemaVersion: 1, generation, sequence: 1,
        kind: 'launch', launchNonce: 'b'.repeat(64), workDeadlineElapsedMilliseconds: 49_000 });
  });
  test('rejects cross-profile replies in both directions', () => {
    expect(() => validateBackendServiceReply(reply(), generation, 0)).toThrow('E2E_BACKEND_OWNER_PROTOCOL_INVALID');
    expect(() => validateViteServiceReply({ ...reply(), protocol: 'eky.e2e.backend-service' }, generation, 0)).toThrow(error);
    expect(Object.isFrozen(validateViteServiceReply(reply(), generation, 0).state.identity)).toBe(true);
  });
  for (const [name, changes] of Object.entries({
    unknownField: { session: 'PRIVATE_SESSION' }, wrongVersion: { schemaVersion: 2 },
    wrongGeneration: { generation: 'b'.repeat(64) }, skippedSequence: { sequence: 2 },
    unsolicitedStatus: { replyTo: null }, invalidRSS: { kind: 'rss', rssBytes: 0 },
    prematureStarted: { kind: 'started', state: { ...reply().state, creationCompleted: false } },
    inventedCleanupTime: { kind: 'terminal', cleanupStartedElapsedMilliseconds: 201, remainingCleanupMilliseconds: 3_000,
      state: { ...reply().state, workload: 'exited', exitCode: 0, activeProcesses: 0,
        stdioSettled: true, cleanup: 'processTreeAbsent' } },
  })) {
    test(`rejects ${name}`, () => {
      expect(() => validateViteServiceReply({ ...reply(), ...changes }, generation, 0)).toThrow(error);
    });
  }
  test('keeps closed commands and the canonical frame bound', () => {
    for (const kind of ['status', 'rss', 'stop'] as const) {
      expect(() => encodeViteServiceRequest(generation, 1, kind, 'b'.repeat(64))).toThrow(error);
    }
    const frame = createViteServiceFrameReader(() => {});
    frame.push(Buffer.from('"' + 'x'.repeat(viteServiceFrameBytes - 3) + '"\n'));
    frame.end();
    expect(() => frame.push(Buffer.alloc(viteServiceFrameBytes, 120))).toThrow(error);
    expect(() => frame.push(Buffer.from('{}\n'))).toThrow(error);
    for (const raw of ['{"kind":"status","kind":"started"}\n', '{ "kind":"status"}\n', '{}']) {
      const reader = createViteServiceFrameReader(() => {});
      expect(() => { reader.push(Buffer.from(raw)); reader.end(); }).toThrow(error);
    }
  });
  for (const wrongProfile of [false, true]) {
    test(`control binds Vite identity and send time with wrong profile ${wrongProfile}`, async () => {
      const socket = new SyntheticSocket();
      let now = 100;
      let losses = 0;
      const sent: number[] = [];
      const control = attachViteServiceControl(socket as unknown as Socket, {
        generation, now: () => now, readDeadline: () => 60_000,
        onReply: (_, sentAt) => { sent.push(sentAt!); }, onLost: () => { losses++; },
      });
      socket.onWrite = request => {
        expect(request.protocol).toBe(viteServiceProtocol);
        now = 400;
        socket.receive({ ...reply(), ...(wrongProfile ? { protocol: 'eky.e2e.backend-service' } : {}) });
      };
      if (wrongProfile) {
        await expect(control.request('status')).rejects.toThrow(error);
        await expect(control.request('stop')).rejects.toThrow(error);
        expect(losses).toBe(1);
      } else {
        await expect(control.request('status')).resolves.toMatchObject({ protocol: viteServiceProtocol });
        expect(sent).toEqual([100]);
        expect(losses).toBe(0);
        control.destroy();
      }
    });
  }
});
