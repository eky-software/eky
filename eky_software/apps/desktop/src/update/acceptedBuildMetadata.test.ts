import { describe, expect, it } from 'vitest';

import {
  createSelectorAcceptedBuildMetadata,
  parseAcceptedBuildMetadata,
  parseVersionedAcceptedBuildMetadata,
  readAcceptedApplicationBuild,
  readAcceptedBusinessBaseline,
  readAcceptedBusinessBuild,
} from './acceptedBuildMetadata.js';

const source = parseAcceptedBuildMetadata({
  acceptedAt: '2026-10-25T10:00:00.000Z',
  appVersion: '0.2.0',
  buildRevision: 'a'.repeat(40),
  formatVersion: 1,
  releaseChannel: 'pilot',
});
const target = parseAcceptedBuildMetadata({ ...source, appVersion: '0.3.0', buildRevision: 'b'.repeat(40) });
const next = parseAcceptedBuildMetadata({ ...source, appVersion: '0.4.0', buildRevision: 'c'.repeat(40) });
const selector = createSelectorAcceptedBuildMetadata(source, target);

describe('versioned accepted build metadata', () => {
  it('preserves the exact canonical v1 representation and its business meaning', () => {
    const parsed = parseVersionedAcceptedBuildMetadata(source);
    expect(JSON.stringify(parsed)).toBe(JSON.stringify(parseAcceptedBuildMetadata(source)));
    expect(parsed.formatVersion).toBe(1);
    expect(readAcceptedApplicationBuild(parsed)).toBe(parsed);
    expect(readAcceptedBusinessBaseline(parsed)).toBe(parsed);
    expect(readAcceptedBusinessBuild(parsed)).toBe(parsed);
    expect(Object.isFrozen(parsed)).toBe(true);
  });

  it('keeps selector readiness distinct from business acceptance and freezes both identities', () => {
    const parsed = parseVersionedAcceptedBuildMetadata(selector);
    expect(parsed).toEqual(selector);
    expect(readAcceptedApplicationBuild(parsed)).toEqual(target);
    expect(readAcceptedBusinessBaseline(parsed)).toEqual(source);
    expect(readAcceptedBusinessBuild(parsed)).toBeUndefined();
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(Object.isFrozen(readAcceptedApplicationBuild(parsed))).toBe(true);
    expect(Object.isFrozen(readAcceptedBusinessBaseline(parsed))).toBe(true);
    // Existing strict-v1 consumers cannot mistake this value for business acceptance.
    expect(() => parseAcceptedBuildMetadata(selector)).toThrow('ACCEPTED_BUILD_METADATA_INVALID');
  });

  it('retains the last business baseline across repeated selector-only updates', () => {
    const repeated = createSelectorAcceptedBuildMetadata(selector, next);
    expect(readAcceptedApplicationBuild(repeated)).toEqual(next);
    expect(readAcceptedBusinessBaseline(repeated)).toEqual(source);
    expect(readAcceptedBusinessBuild(repeated)).toBeUndefined();
    expect(parseVersionedAcceptedBuildMetadata(repeated)).toEqual(repeated);
    expect(selector.acceptedBuild).toEqual(target);
  });

  it('accepts a business record only when both full metadata values agree', () => {
    const business = parseVersionedAcceptedBuildMetadata({
      formatVersion: 2, acceptanceScope: 'business', acceptedBuild: target, businessBaseline: target,
    });
    expect(readAcceptedBusinessBuild(business)).toEqual(target);
    expect(readAcceptedBusinessBaseline(business)).toEqual(target);
    expect(readAcceptedApplicationBuild(business)).toEqual(target);
    expect(createSelectorAcceptedBuildMetadata(business, next).businessBaseline).toEqual(target);
  });

  it.each([
    { ...target, appVersion: source.appVersion },
    { ...target, buildRevision: source.buildRevision },
    { ...target, acceptedAt: '2026-10-25T11:00:00.000Z' },
  ])('rejects business metadata disagreement', businessBaseline => {
    expect(() => parseVersionedAcceptedBuildMetadata({
      formatVersion: 2, acceptanceScope: 'business', acceptedBuild: target, businessBaseline,
    })).toThrow('ACCEPTED_BUILD_METADATA_INVALID');
  });

  it.each([source, target, { ...target, buildRevision: 'd'.repeat(40) },
    { ...target, appVersion: '0.3.0+different' }])('rejects a non-forward selector publication', attempted => {
    expect(() => createSelectorAcceptedBuildMetadata(selector, attempted)).toThrow('ACCEPTED_BUILD_METADATA_INVALID');
  });

  it('does not use historical timestamps as a version-ordering signal', () => {
    const earlierClock = { ...target, acceptedAt: '2026-10-24T10:00:00.000Z' };
    const parsed = parseVersionedAcceptedBuildMetadata(createSelectorAcceptedBuildMetadata(source, earlierClock));
    expect(readAcceptedApplicationBuild(parsed)).toEqual(earlierClock);
    expect(readAcceptedBusinessBaseline(parsed)).toEqual(source);
  });

  it('does not construct selector acceptance without a valid previous baseline or target', () => {
    expect(() => createSelectorAcceptedBuildMetadata(undefined as never, target))
      .toThrow('ACCEPTED_BUILD_METADATA_INVALID');
    expect(() => createSelectorAcceptedBuildMetadata({ ...selector, businessBaseline: null } as never, next))
      .toThrow('ACCEPTED_BUILD_METADATA_INVALID');
    expect(() => createSelectorAcceptedBuildMetadata(source, { ...target, releaseChannel: 'unknown' } as never))
      .toThrow('ACCEPTED_BUILD_METADATA_INVALID');
  });

  it.each([
    { formatVersion: 3 }, { formatVersion: '2' }, { acceptanceScope: 'unknown' },
    { acceptanceScope: 'business' }, { businessBaseline: null }, { businessBaseline: target },
    { businessBaseline: next }, { businessBaseline: { ...target, buildRevision: source.buildRevision } },
    { businessBaseline: { ...target, appVersion: '0.3.0+other' } },
    { extra: 'not accepted' }, { acceptedBuild: source }, { acceptedBuild: selector },
  ])('rejects an invalid scoped record', delta => {
    expect(() => parseVersionedAcceptedBuildMetadata({ ...selector, ...delta })).toThrow('ACCEPTED_BUILD_METADATA_INVALID');
  });

  it.each([
    { formatVersion: 2 }, { releaseChannel: 'stable' }, { appVersion: 'v0.2.0' },
    { buildRevision: 'invalid' }, { buildRevision: 'a'.repeat(41) },
    { acceptedAt: '2026-10-25' }, { acceptedAt: '2026-02-30T10:00:00.000Z' },
    { extra: 'not accepted' },
  ])('retains strict identity validation in each nested position', delta => {
    expect(() => parseVersionedAcceptedBuildMetadata({ ...selector, acceptedBuild: { ...target, ...delta } }))
      .toThrow('ACCEPTED_BUILD_METADATA_INVALID');
    expect(() => parseVersionedAcceptedBuildMetadata({ ...selector, businessBaseline: { ...source, ...delta } }))
      .toThrow('ACCEPTED_BUILD_METADATA_INVALID');
  });

  it.each(['acceptanceScope', 'acceptedBuild', 'businessBaseline', 'formatVersion'])('rejects a missing %s', field => {
    const value: Record<string, unknown> = { ...selector };
    delete value[field];
    expect(() => parseVersionedAcceptedBuildMetadata(value)).toThrow('ACCEPTED_BUILD_METADATA_INVALID');
  });

  it.each([null, undefined, [], 'metadata', 2])('rejects a non-record', value => {
    expect(() => parseVersionedAcceptedBuildMetadata(value)).toThrow('ACCEPTED_BUILD_METADATA_INVALID');
  });
});
