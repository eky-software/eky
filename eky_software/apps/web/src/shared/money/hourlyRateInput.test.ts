import { describe, expect, it } from 'vitest';

import { centsToEuroInput, euroInputToCents } from './hourlyRateInput.js';

describe('hourlyRateInput', () => {
  it('maps empty input to null', () => {
    expect(euroInputToCents('')).toBeNull();
    expect(euroInputToCents('   ')).toBeNull();
  });

  it('trims surrounding whitespace', () => {
    expect(euroInputToCents(' 65,50 ')).toBe(6550);
  });

  it.each([
    ['65', 6500],
    ['65,50', 6550],
    ['65.50', 6550],
    ['0', 0],
    ['0,00', 0],
  ])('maps %s euros to %i cents', (input, expectedCents) => {
    expect(euroInputToCents(input)).toBe(expectedCents);
  });

  it.each(['65,555', '-1', 'abc'])('rejects invalid input %s', (input) => {
    expect(() => euroInputToCents(input)).toThrow('Invalid hourly rate.');
  });

  it('maps null cents to empty input', () => {
    expect(centsToEuroInput(null)).toBe('');
  });

  it('maps cents to a Finnish decimal input value', () => {
    expect(centsToEuroInput(6550)).toBe('65,50');
  });
});
