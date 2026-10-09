import { resolve, sep } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import {
  isWorkspaceProcessReservationIdentity,
  matchesWorkspaceProcessReservationDescriptor,
  parseWorkspaceProcessReservationDescriptor,
} from './workspaceProcessReservationDescriptor.js';

function descriptor() {
  return {
    generationId: '11111111-1111-4111-8111-111111111111',
    identity: 'a'.repeat(64),
    userDataRoot: resolve('synthetic-reservation-root'),
  };
}

describe('private workspace process reservation descriptor', () => {
  it('copies and freezes a bounded value without checking or creating filesystem state', () => {
    const input = descriptor();
    const parsed = parseWorkspaceProcessReservationDescriptor(input);
    expect(parsed).toEqual(input);
    expect(parsed).not.toBe(input);
    expect(Object.isFrozen(parsed)).toBe(true);
    input.identity = 'b'.repeat(64);
    expect(parsed?.identity).toBe('a'.repeat(64));
  });

  it('accepts a plain record without a prototype', () => {
    expect(parseWorkspaceProcessReservationDescriptor(
      Object.assign(Object.create(null) as object, descriptor()),
    )).toEqual(descriptor());
  });

  it.each([null, undefined, [], 'descriptor', 1, true, new Date()])(
    'rejects non-record value %#', (input) => {
      expect(parseWorkspaceProcessReservationDescriptor(input)).toBeUndefined();
    },
  );

  it.each(['generationId', 'identity', 'userDataRoot'] as const)(
    'requires own field %s', (key) => {
      const input: Record<string, unknown> = descriptor();
      delete input[key];
      expect(parseWorkspaceProcessReservationDescriptor(input)).toBeUndefined();
      expect(parseWorkspaceProcessReservationDescriptor(
        Object.assign(Object.create({ [key]: descriptor()[key] }) as object, input),
      )).toBeUndefined();
    },
  );

  it.each(['operationId', 'runtimeSession', 'companyId', 'granted', 'extra'])(
    'rejects an unowned field %s', (key) => {
      expect(parseWorkspaceProcessReservationDescriptor({
        ...descriptor(), [key]: true,
      })).toBeUndefined();
    },
  );

  it('rejects extra symbol and non-enumerable fields', () => {
    for (const key of [Symbol('extra'), 'extra']) {
      const input = descriptor();
      Object.defineProperty(input, key, { value: true });
      expect(parseWorkspaceProcessReservationDescriptor(input)).toBeUndefined();
    }
  });

  it.each(['generationId', 'identity', 'userDataRoot'] as const)(
    'does not execute a %s accessor', (key) => {
      const getter = vi.fn(() => descriptor()[key]);
      const input = descriptor();
      Object.defineProperty(input, key, { get: getter });
      expect(parseWorkspaceProcessReservationDescriptor(input)).toBeUndefined();
      expect(getter).not.toHaveBeenCalled();
    },
  );

  it.each([
    undefined, null, 1, '', 'a'.repeat(63), 'a'.repeat(65),
    'A'.repeat(64), 'g'.repeat(64), `${'a'.repeat(64)}\n`,
  ])('rejects non-canonical root identity %#', (identity) => {
    expect(isWorkspaceProcessReservationIdentity(identity)).toBe(false);
    expect(parseWorkspaceProcessReservationDescriptor({
      ...descriptor(), identity,
    })).toBeUndefined();
  });

  it.each([
    undefined, null, 1, '', 'old-generation',
    '11111111-1111-0111-8111-111111111111',
    '11111111-1111-4111-0111-111111111111',
    'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA',
    '11111111-1111-4111-8111-111111111111\n',
  ])('rejects non-canonical generation %#', (generationId) => {
    expect(parseWorkspaceProcessReservationDescriptor({
      ...descriptor(), generationId,
    })).toBeUndefined();
  });

  it.each([
    undefined, null, 1, '', 'relative-root',
    `${resolve('root')}\0`,
    `${resolve('root')}${sep}..${sep}other`,
    `${resolve('root')}${sep}.`,
    `${resolve('root')}${sep}`,
    resolve('a'.repeat(4_096)),
  ])('rejects unbounded or non-canonical root %#', (userDataRoot) => {
    expect(parseWorkspaceProcessReservationDescriptor({
      ...descriptor(), userDataRoot,
    })).toBeUndefined();
  });

  it('accepts the root length boundary and rejects one character beyond it', () => {
    const prefix = resolve('root') + sep;
    const userDataRoot = prefix + 'a'.repeat(4_096 - prefix.length);
    expect(parseWorkspaceProcessReservationDescriptor({
      ...descriptor(), userDataRoot,
    })?.userDataRoot).toBe(userDataRoot);
    expect(parseWorkspaceProcessReservationDescriptor({
      ...descriptor(), userDataRoot: userDataRoot + 'a',
    })).toBeUndefined();
  });

  it('matches only the same generation, identity and root', () => {
    const expected = parseWorkspaceProcessReservationDescriptor(descriptor())!;
    const same = parseWorkspaceProcessReservationDescriptor(descriptor())!;
    expect(matchesWorkspaceProcessReservationDescriptor(expected, same)).toBe(true);
    for (const changed of [
      { generationId: '22222222-2222-4222-8222-222222222222' },
      { identity: 'b'.repeat(64) },
      { userDataRoot: resolve('other-synthetic-root') },
    ]) {
      const received = parseWorkspaceProcessReservationDescriptor({
        ...descriptor(), ...changed,
      })!;
      expect(matchesWorkspaceProcessReservationDescriptor(expected, received)).toBe(false);
    }
  });
});
