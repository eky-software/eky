import { describe, expect, it } from 'vitest';

import { matchesWorkspaceDeletionLabel, readWorkspaceDeletionRequest,
  WORKSPACE_LABEL_MAX_CODE_POINTS } from './desktopWorkspaceManagement.js';

const workspaceId = '11111111-1111-4111-8111-111111111111';
const request = () => ({ formatVersion: 1, workspaceId, typedLabel: 'Synthetic company',
  backupChoice: 'explicitDataLoss' });

describe('desktop workspace deletion request', () => {
  it.each(['createBackup', 'explicitDataLoss'])('copies only the exact immutable %s request', backupChoice => {
    const input = { ...request(), backupChoice };
    const parsed = readWorkspaceDeletionRequest(input);
    expect(parsed).toEqual(input);
    expect(Object.isFrozen(parsed)).toBe(true);
    input.typedLabel = 'Changed later';
    expect(parsed.typedLabel).toBe('Synthetic company');
    expect(JSON.stringify(parsed)).not.toMatch(/path|journal|secret|lineage|operationId/);
  });

  it.each([
    null, [], 'invalid', {}, { ...request(), formatVersion: 2 },
    { ...request(), workspaceId: 'invalid' }, { ...request(), workspaceId: workspaceId.toUpperCase().replace('1111', 'ABCD') },
    { ...request(), typedLabel: '' }, { ...request(), typedLabel: ' Synthetic company' },
    { ...request(), typedLabel: 'Synthetic company ' }, { ...request(), typedLabel: 'a\nb' },
    { ...request(), typedLabel: '\ud800' }, { ...request(), typedLabel: 'a'.repeat(81) },
    { ...request(), typedLabel: '\u202ecompany' }, { ...request(), backupChoice: null },
    { ...request(), backupChoice: 'latestBackup' }, { ...request(), confirmed: true },
    { ...request(), backupVerified: true }, { ...request(), path: 'excluded' },
  ])('rejects malformed input at case %# without a raw cause', value => {
    expect(() => readWorkspaceDeletionRequest(value)).toThrow('Invalid workspace deletion request.');
  });

  it('rejects inherited and symbol fields, accessors and throwing proxies safely', () => {
    let reads = 0;
    const getter = Object.defineProperty(request(), 'typedLabel', {
      get() { reads++; throw new Error('SYNTHETIC_PRIVATE_GETTER'); }, enumerable: true,
    });
    for (const input of [getter, { ...request(), [Symbol('extra')]: true },
      Object.assign(Object.create({ inherited: true }), request()),
      new Proxy(request(), { getPrototypeOf() { throw new Error('SYNTHETIC_PRIVATE_PROXY'); } }),
    ]) {
      expect(() => readWorkspaceDeletionRequest(input)).toThrow('Invalid workspace deletion request.');
    }
    expect(reads).toBe(0);
  });

  it('retains the existing Unicode code point limit, not a UTF-16 limit', () => {
    const label = '\u{10400}'.repeat(WORKSPACE_LABEL_MAX_CODE_POINTS);
    expect(label.length).toBe(WORKSPACE_LABEL_MAX_CODE_POINTS * 2);
    expect(readWorkspaceDeletionRequest({ ...request(), typedLabel: label }).typedLabel).toBe(label);
    expect(() => readWorkspaceDeletionRequest({ ...request(), typedLabel: label + 'a' })).toThrow();
  });
});

describe('typed deletion name presentation check', () => {
  it('uses NFC but neither case folding nor whitespace normalization', () => {
    expect(matchesWorkspaceDeletionLabel('Yhtio\u0308', 'Yhti\u00f6')).toBe(true);
    expect(matchesWorkspaceDeletionLabel('Synthetic company', 'Synthetic company')).toBe(true);
    for (const input of ['synthetic company', 'Synthetic  company', 'Synthetic company ', ' Synthetic company']) {
      expect(matchesWorkspaceDeletionLabel(input, 'Synthetic company')).toBe(false);
    }
  });

  it.each([null, undefined, 123, '', '\ud800', 'a'.repeat(81), 'line\nbreak'])('rejects invalid label %j on either side', value => {
    expect(matchesWorkspaceDeletionLabel(value, 'Synthetic company')).toBe(false);
    expect(matchesWorkspaceDeletionLabel('Synthetic company', value)).toBe(false);
  });
});
