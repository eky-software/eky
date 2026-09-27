import { EventEmitter } from 'node:events';
import type { Socket } from 'node:net';
import { expect, test } from '@playwright/test';

import { createWindowsServiceProtocol, windowsServiceFrameBytes,
  type WindowsElectronBridgeCommand } from '../../src/environment/windowsServiceProtocol.js';
import { createWindowsServiceControl } from '../../src/environment/windowsServiceControl.js';
import { windowsServiceProfiles } from '../../src/environment/windowsServiceProfile.js';

const generation = 'a'.repeat(64);
const nonce = 'b'.repeat(64);
const registration = 'c'.repeat(64);
const bootstrap = JSON.stringify({ generation, launchNonce: nonce, opaqueClock: '123' });
const wire = createWindowsServiceProtocol('electronBridge');
function reply(kind = 'status', sequence = 1) {
  return { protocol: windowsServiceProfiles.electronBridge.protocol, schemaVersion: 1, generation,
    sequence, replyTo: sequence, kind, rssBytes: null, elapsedMilliseconds: 0,
    cleanupStartedElapsedMilliseconds: null, remainingCleanupMilliseconds: null,
    registration: kind === 'status' ? registration : null, bootstrap: kind === 'armed' ? bootstrap : null,
    state: { created: false, started: false, creationCompleted: false, launchClosed: false, identity: null,
      workload: 'pending', exitCode: null, assignedBeforeResume: false, activeProcesses: 0,
      stdioSettled: false, firstFailure: null, cleanup: 'pending', cleanupFailure: null } };
}

test.describe('closed Electron bridge caller wire @security', () => {
  test('arm alone carries the original bound; register cannot reset it', () => {
    const encode = (command: WindowsElectronBridgeCommand) =>
      JSON.parse(wire.encodeWindowsElectronBridgeRequest(generation, 1, command).toString());
    expect(encode({ kind: 'arm', launchNonce: nonce, workDeadlineElapsedMilliseconds: 1_000 })).toEqual({
      protocol: windowsServiceProfiles.electronBridge.protocol, schemaVersion: 1, generation, sequence: 1,
      kind: 'arm', launchNonce: nonce, workDeadlineElapsedMilliseconds: 1_000 });
    expect(encode({ kind: 'register', launchNonce: nonce, observedBridgePid: 42 })).toEqual({
      protocol: windowsServiceProfiles.electronBridge.protocol, schemaVersion: 1, generation, sequence: 1,
      kind: 'register', launchNonce: nonce, observedBridgePid: 42 });
    expect(encode({ kind: 'go', registration })).toMatchObject({ kind: 'go', registration });
    expect(() => encode({ kind: 'register', launchNonce: nonce, observedBridgePid: 42,
      workDeadlineElapsedMilliseconds: 2_000 } as WindowsElectronBridgeCommand)).toThrow();
    expect(() => wire.encodeWindowsServiceRequest(generation, 1, 'launch', nonce, 1_000)).toThrow();
  });

  test('rejects invalid command boundaries and extra fields', () => {
    const invalid = [
      { kind: 'register', launchNonce: nonce, observedBridgePid: 0 },
      { kind: 'register', launchNonce: nonce, observedBridgePid: 0x1_0000_0000 },
      { kind: 'arm', launchNonce: nonce, workDeadlineElapsedMilliseconds: 0 },
      { kind: 'arm', launchNonce: nonce, workDeadlineElapsedMilliseconds: 1.5 },
      { kind: 'arm', launchNonce: generation.toUpperCase(), workDeadlineElapsedMilliseconds: 10 },
      { kind: 'go', registration, args: [] }, { kind: 'go', registration: '' },
    ];
    for (const command of invalid) expect(() => wire.encodeWindowsElectronBridgeRequest(
      generation, 1, command as WindowsElectronBridgeCommand)).toThrow('E2E_ELECTRON_BRIDGE_OWNER_PROTOCOL_INVALID');
  });

  test('keeps all three direct profiles closed and their original request signature', () => {
    for (const profile of ['backend', 'vite', 'electron'] as const) {
      const direct = createWindowsServiceProtocol(profile);
      expect(JSON.parse(direct.encodeWindowsServiceRequest(generation, 1, 'launch', nonce, 100).toString()).kind).toBe('launch');
      expect(() => direct.encodeWindowsElectronBridgeRequest(generation, 1, { kind: 'go', registration })).toThrow();
      const value = { ...reply(), protocol: windowsServiceProfiles[profile].protocol };
      expect(() => direct.validateWindowsServiceReply(value, generation, 0)).toThrow();
      const { registration: unusedRegistration, bootstrap: unusedBootstrap, ...legacy } = value;
      expect(unusedRegistration).toBe(registration); expect(unusedBootstrap).toBeNull();
      expect(direct.validateWindowsServiceReply(legacy, generation, 0).kind).toBe('status');
    }
  });

  test('requires both bridge fields and projects capabilities only on their named replies', () => {
    for (const kind of ['armed', 'registering', 'status']) {
      expect(wire.validateWindowsServiceReply(reply(kind), generation, 0).kind).toBe(kind);
    }
    for (const value of [
      { ...reply('registering'), bootstrap }, { ...reply('registering'), registration },
      { ...reply('armed'), bootstrap: null }, { ...reply('armed'), bootstrap: '' },
      { ...reply('armed'), bootstrap: '\0' }, { ...reply('armed'), bootstrap: 'x'.repeat(windowsServiceFrameBytes) },
      { ...reply('armed'), registration }, { ...reply(), bootstrap },
      { ...reply(), state: { ...reply().state, launchClosed: true } },
    ]) expect(() => wire.validateWindowsServiceReply(value, generation, 0)).toThrow();
    for (const key of ['registration', 'bootstrap']) {
      const value: Record<string, unknown> = reply(); delete value[key];
      expect(() => wire.validateWindowsServiceReply(value, generation, 0)).toThrow();
    }
  });

  test('passes opaque bootstrap intact through native string escapes without accepting duplicate keys', () => {
    const accepted: unknown[] = [];
    const frame = JSON.stringify(reply('armed'));
    const native = frame.replace(JSON.stringify(bootstrap), JSON.stringify(bootstrap).replaceAll('\\"', '\\u0022'));
    const reader = wire.createWindowsServiceFrameReader(value => { accepted.push(value); });
    for (const byte of Buffer.from(native + '\n')) reader.push(Buffer.from([byte]));
    reader.end();
    expect(accepted).toEqual([reply('armed')]);
    for (const duplicate of [
      native.replace('"registration":null', '"registration":null,"registration":null'),
      native.replace('"registration":null', '"registration":null,"\\u0072egistration":null'),
    ]) expect(() => wire.createWindowsServiceFrameReader(() => {}).push(Buffer.from(duplicate + '\n'))).toThrow();
  });

  test('rejects malformed, partial and oversized frames', () => {
    for (const frame of ['{} trailing\n', '{"bootstrap":"\\q"}\n', 'x'.repeat(windowsServiceFrameBytes)]) {
      expect(() => wire.createWindowsServiceFrameReader(() => {}).push(Buffer.from(frame))).toThrow();
    }
    const reader = wire.createWindowsServiceFrameReader(() => {});
    reader.push(Buffer.from('{')); expect(() => reader.end()).toThrow();
  });

  test('correlates armed/registering and rejects a mismatched bridge reply', async () => {
    const socket = new EventEmitter() as EventEmitter & { write: (data: Buffer, callback: () => void) => boolean; destroy: () => void };
    let sequence = 0; let mismatch = false;
    socket.destroy = () => { socket.emit('close'); };
    socket.write = (data, callback) => {
      const command = JSON.parse(data.toString());
      queueMicrotask(() => { callback(); socket.emit('data', Buffer.from(JSON.stringify(reply(
        mismatch ? 'armed' : command.kind === 'arm' ? 'armed' : 'registering', ++sequence)) + '\n')); });
      return true;
    };
    const control = createWindowsServiceControl('electronBridge').attachWindowsServiceControl(socket as unknown as Socket, {
      generation, now: () => 0, readDeadline: () => 10_000, onReply() {}, onLost() {},
    });
    expect((await control.requestBridge!({ kind: 'arm', launchNonce: nonce, workDeadlineElapsedMilliseconds: 100 })).bootstrap).toBe(bootstrap);
    expect((await control.requestBridge!({ kind: 'register', launchNonce: nonce, observedBridgePid: 42 })).kind).toBe('registering');
    mismatch = true;
    await expect(control.requestBridge!({ kind: 'go', registration })).rejects.toThrow('E2E_ELECTRON_BRIDGE_OWNER_PROTOCOL_INVALID');
  });
});
