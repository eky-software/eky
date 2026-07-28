import { describe, expect, it } from 'vitest';

import { resolveOperationalRuntimeIdentity } from './operationalRuntimeIdentity.js';

const runtimeInstanceId = '11111111-1111-4111-8111-111111111111';

describe('resolveOperationalRuntimeIdentity', () => {
  it('preserves a validated identity supplied by the desktop runtime', () => {
    expect(
      resolveOperationalRuntimeIdentity({
        appVersion: '0.1.0-alpha.1',
        operationalIdentity: {
          appVersion: '0.1.0-alpha.1',
          buildRevision: '123456789abc',
          runtimeInstanceId,
        },
      }),
    ).toEqual({
      appVersion: '0.1.0-alpha.1',
      buildRevision: '123456789abc',
      runtimeInstanceId,
    });
  });

  it('creates an explicit development identity for standalone backend use', () => {
    expect(
      resolveOperationalRuntimeIdentity({
        appVersion: '0.1.0-alpha.1',
        randomId: () => runtimeInstanceId,
      }),
    ).toEqual({
      appVersion: '0.1.0-alpha.1',
      buildRevision: 'development',
      runtimeInstanceId,
    });
  });

  it('rejects mismatched or malformed identities', () => {
    expect(() =>
      resolveOperationalRuntimeIdentity({
        appVersion: '0.1.0-alpha.1',
        operationalIdentity: {
          appVersion: '0.1.0-alpha.2',
          buildRevision: '123456789abc',
          runtimeInstanceId,
        },
      }),
    ).toThrow('OPERATIONAL_RUNTIME_IDENTITY_INVALID');
    expect(() =>
      resolveOperationalRuntimeIdentity({
        operationalIdentity: {
          appVersion: '0.1.0-alpha.1',
          buildRevision: 'not-a-revision',
          runtimeInstanceId,
        },
      }),
    ).toThrow('OPERATIONAL_RUNTIME_IDENTITY_INVALID');
  });
});
