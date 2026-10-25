import { expect, it } from 'vitest';

import { createWorkspaceLabelComparisonKey } from './workspaceLabelComparison.js';
import { validateWorkspaceLabel } from './workspaceLabelValidation.js';

it.each([
  ['Example Oy', 'EXAMPLE OY', 'EXAMPLE OY'],
  ['Example  Oy', 'example Oy', 'EXAMPLE OY'],
  ['Example\u00a0\u202fOy', 'EXAMPLE OY', 'EXAMPLE OY'],
  ['Example\u2003Oy', 'example Oy', 'EXAMPLE OY'],
  ['Example\ufeffOy', 'example Oy', 'EXAMPLE OY'],
  ['\u00c4\u00e4nekoski Oy', '\u00e4\u00e4nekoski oy', '\u00c4\u00c4NEKOSKI OY'],
  ['Cafe\u0301', 'CAF\u00c9', 'CAF\u00c9'],
  ['\u212b', 'A\u030a', '\u00c5'],
  ['Stra\u00dfe', 'STRA\u1e9eE', 'STRASSE'],
  ['\u03bf\u03c2', '\u039f\u03a3', '\u039f\u03a3'],
  ['I', '\u0131', 'I'],
  ['\ufb03', 'ffi', 'FFI'],
  ['\u{10428}', '\u{10400}', '\u{10400}'],
])('compares approved case and spacing vectors without rewriting labels: %#', (first, second, key) => {
  expect(createWorkspaceLabelComparisonKey(first)).toBe(key);
  expect(createWorkspaceLabelComparisonKey(second)).toBe(key);
  expect(validateWorkspaceLabel(first)).toBe(first);
  expect(validateWorkspaceLabel(second)).toBe(second);
});

it.each([
  ['Cafe', 'Caf\u00e9'], ['A-B', 'A B'], ['AB', 'A B'],
  ['A', '\uff21'], ['A', '\u0410'], ['I', '\u0130'],
  ['AB', 'A\u200bB'], ['a+b', 'ab'],
])('does not erase accents, punctuation or distinct scripts: %#', (first, second) => {
  expect(createWorkspaceLabelComparisonKey(first)).not.toBe(createWorkspaceLabelComparisonKey(second));
});

it.each([
  undefined, 1, '', ' Example', 'Example ', '\u00a0Example',
  'Example\tOy', 'Example\nOy', 'A\u202eB', 'A\u0000B', 'A\ud800B', 'a'.repeat(81),
])('validates the original input before comparison: %#', (input) => {
  expect(() => createWorkspaceLabelComparisonKey(input)).toThrow('WORKSPACE_REGISTRY_INVALID');
});

it('preserves the label limit even when the comparison key expands', () => {
  expect(createWorkspaceLabelComparisonKey('\u00df'.repeat(80))).toBe('SS'.repeat(80));
  expect(createWorkspaceLabelComparisonKey('\u{1f3d7}'.repeat(80))).toBe('\u{1f3d7}'.repeat(80));
  expect(() => createWorkspaceLabelComparisonKey('\u{1f3d7}'.repeat(81))).toThrow();
});
