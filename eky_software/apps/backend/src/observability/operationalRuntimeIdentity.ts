import { randomUUID } from 'node:crypto';

import type { OperationalRuntimeIdentity } from './operationalEvent.js';

const safeVersionPattern = /^[A-Za-z0-9.+_-]{1,80}$/;
const buildRevisionPattern = /^(?:[0-9a-f]{7,40}|development)$/;
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function resolveOperationalRuntimeIdentity(input: {
  appVersion?: string;
  operationalIdentity?: Readonly<OperationalRuntimeIdentity>;
  randomId?(): string;
}): Readonly<OperationalRuntimeIdentity> {
  const identity =
    input.operationalIdentity ??
    {
      appVersion: input.appVersion ?? '0.0.0',
      buildRevision: 'development',
      runtimeInstanceId: (input.randomId ?? randomUUID)(),
    };

  if (
    !safeVersionPattern.test(identity.appVersion) ||
    !buildRevisionPattern.test(identity.buildRevision) ||
    !uuidPattern.test(identity.runtimeInstanceId) ||
    (input.appVersion !== undefined &&
      identity.appVersion !== input.appVersion)
  ) {
    throw new Error('OPERATIONAL_RUNTIME_IDENTITY_INVALID');
  }

  return Object.freeze({ ...identity });
}
