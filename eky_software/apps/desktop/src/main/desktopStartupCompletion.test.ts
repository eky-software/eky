import { describe, expect, it, vi } from 'vitest';

import type { DesktopOperationalEvent } from '../observability/desktopOperationalEvent.js';
import { validateDesktopOperationalEvent } from '../observability/desktopOperationalEventValidator.js';
import {
  reportDesktopStarted,
  runPackagedDesktopStartupProof,
} from './desktopStartupCompletion.js';
import type { W6b2PackagedProofConfiguration } from './w6b2PackagedProof.js';

describe('desktop startup completion wiring', () => {
  it('records exactly one existing startup event after session validation and before controller shutdown', async () => {
    const fixture = createFixture();
    let acceptSession!: () => void;
    fixture.options.validateSession = async () => {
      await new Promise<void>((resolve) => {
        acceptSession = resolve;
      });
      fixture.order.push('sessionValidated');
    };
    const pending = runPackagedDesktopStartupProof(fixture.options);
    expect(fixture.events).toEqual([]);
    expect(fixture.options.runController).not.toHaveBeenCalled();

    acceptSession();
    await expect(pending).resolves.toEqual(fixture.result);

    expect(fixture.order).toEqual([
      'sessionValidated', 'desktop.started', 'controllerShutdown',
    ]);
    expect(fixture.events).toHaveLength(1);
    expect(validateDesktopOperationalEvent(fixture.events[0])).toEqual(
      fixture.events[0],
    );
    expect(fixture.events[0]).toMatchObject({
      ...fixture.options.identity,
      schemaVersion: 1,
      eventName: 'desktop.started',
      component: 'desktop',
      outcome: 'success',
    });
    expect(JSON.stringify(fixture.events)).not.toContain(
      fixture.configuration.sessionProbeNonce,
    );
  });

  it('preserves failed session validation without a success event or controller side effects', async () => {
    const fixture = createFixture();
    const failure = new Error('W6B2_PROOF_SESSION_VALIDATION_FAILED');
    fixture.options.validateSession = async () => {
      throw failure;
    };
    await expect(
      runPackagedDesktopStartupProof(fixture.options),
    ).rejects.toBe(failure);
    expect(fixture.events).toEqual([]);
    expect(fixture.options.runController).not.toHaveBeenCalled();
  });

  it('does not label legacy success, fault or unavailable-controller proof as a completed startup', async () => {
    const fixture = createFixture();
    const { sessionProbeNonce: _nonce, ...legacy } = fixture.configuration;
    fixture.options.configuration = legacy;
    await runPackagedDesktopStartupProof(fixture.options);
    fixture.options.configuration = {
      ...legacy,
      controlFormatVersion: 2,
      faultScenario: 'acceptanceInterruption',
      phase: 'targetAcceptanceRecovery',
    };
    fixture.options.validateSession = vi.fn(async () => {
      throw new Error('unexpected');
    });
    await runPackagedDesktopStartupProof(fixture.options);
    expect(fixture.options.validateSession).not.toHaveBeenCalled();
    fixture.options.configuration = fixture.configuration;
    fixture.options.controllerAvailable = false;
    fixture.options.validateSession = async () => undefined;
    await runPackagedDesktopStartupProof(fixture.options);
    expect(fixture.events).toEqual([]);
  });

  it('keeps ordinary startup synchronous and emits only its single existing event', () => {
    const fixture = createFixture();
    expect(reportDesktopStarted(fixture.options)).toBeUndefined();
    expect(fixture.order).toEqual(['desktop.started']);
    expect(fixture.events).toHaveLength(1);
    expect(fixture.options.runController).not.toHaveBeenCalled();
  });
});

function createFixture() {
  const order: string[] = [];
  const events: DesktopOperationalEvent[] = [];
  const configuration = {
    controlFormatVersion: 1 as const,
    enabled: true as const,
    phase: 'targetFirstStart' as const,
    role: 'target' as const,
    root: 'synthetic-root',
    userDataPath: 'synthetic-profile',
    resultFilePath: 'synthetic-result',
    sourceManifestPath: 'synthetic-source',
    targetManifestPath: 'synthetic-target',
    sessionProbeNonce: 'a'.repeat(64),
  };
  const result = {
    formatVersion: 1 as const,
    phase: configuration.phase,
    status: 'completed' as const,
  };
  const options = {
    configuration: configuration as W6b2PackagedProofConfiguration,
    controllerAvailable: true,
    identity: {
      appVersion: '0.2.8',
      buildRevision: 'b'.repeat(40),
      runtimeInstanceId: '11111111-1111-4111-8111-111111111111',
    },
    logger: {
      write(event: DesktopOperationalEvent) {
        events.push(event);
        order.push(event.eventName);
      },
    },
    startedAt: Date.now(),
    async validateSession() {
      order.push('sessionValidated');
    },
    runController: vi.fn(async () => {
      order.push('controllerShutdown');
      return result;
    }),
  };
  return { configuration, events, options, order, result };
}
