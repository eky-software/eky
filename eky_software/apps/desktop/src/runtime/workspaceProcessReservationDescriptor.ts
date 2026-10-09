import { isAbsolute, resolve } from 'node:path';

const maximumRootCharacters = 4_096;
const identityPattern = /^[a-f0-9]{64}$/;
const generationPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const descriptorKeys = ['generationId', 'identity', 'userDataRoot'] as const;

/** Private-channel value only: neither parsing nor matching grants permission to write. */
export interface WorkspaceProcessReservationDescriptor {
  readonly generationId: string;
  readonly identity: string;
  readonly userDataRoot: string;
}

export function isWorkspaceProcessReservationIdentity(value: unknown): value is string {
  return typeof value === 'string' && identityPattern.test(value);
}

export function parseWorkspaceProcessReservationDescriptor(
  value: unknown,
): WorkspaceProcessReservationDescriptor | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined;
  }
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return undefined;
  const keys = Reflect.ownKeys(value);
  if (keys.length !== descriptorKeys.length
    || !descriptorKeys.every((key) => Object.hasOwn(value, key))) {
    return undefined;
  }
  // Read data properties only; a local accessor must not run during validation.
  const fields = Object.getOwnPropertyDescriptors(value);
  if (descriptorKeys.some((key) => !Object.hasOwn(fields[key]!, 'value'))) {
    return undefined;
  }
  const generationId: unknown = fields.generationId!.value;
  const identity: unknown = fields.identity!.value;
  const userDataRoot: unknown = fields.userDataRoot!.value;
  if (typeof generationId !== 'string' || !generationPattern.test(generationId)
    || !isWorkspaceProcessReservationIdentity(identity)
    || typeof userDataRoot !== 'string' || userDataRoot.length === 0
    || userDataRoot.length > maximumRootCharacters || userDataRoot.includes('\0')
    || !isAbsolute(userDataRoot) || resolve(userDataRoot) !== userDataRoot) {
    return undefined;
  }
  return Object.freeze({ generationId, identity, userDataRoot });
}

export function matchesWorkspaceProcessReservationDescriptor(
  expected: WorkspaceProcessReservationDescriptor,
  received: WorkspaceProcessReservationDescriptor,
): boolean {
  return expected.generationId === received.generationId
    && expected.identity === received.identity
    && expected.userDataRoot === received.userDataRoot;
}
