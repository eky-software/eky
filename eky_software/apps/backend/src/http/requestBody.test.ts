import { describe, expect, it } from 'vitest';

import {
  hasOnlyAllowedFields,
  readOptionalStringFields,
} from './requestBody.js';

describe('hasOnlyAllowedFields', () => {
  const allowedFields = new Set(['name', 'status']);

  it('accepts empty and allowed-field records', () => {
    expect(hasOnlyAllowedFields({}, allowedFields)).toBe(true);
    expect(
      hasOnlyAllowedFields(
        { name: 'Example', status: 'active' },
        allowedFields,
      ),
    ).toBe(true);
  });

  it('rejects any unknown field', () => {
    expect(
      hasOnlyAllowedFields(
        { companyId: 'forged-company', name: 'Example' },
        allowedFields,
      ),
    ).toBe(false);
  });
});

describe('readOptionalStringFields', () => {
  it('reads strings and preserves the existing empty value semantics', () => {
    expect(
      readOptionalStringFields(
        {
          missing: undefined,
          nullable: null,
          present: 'value',
        },
        ['missing', 'nullable', 'present'] as const,
      ),
    ).toEqual({
      missing: '',
      nullable: '',
      present: 'value',
    });
  });

  it.each([123, true, [], {}])(
    'rejects a non-string field value %#',
    (invalidValue) => {
      expect(
        readOptionalStringFields(
          { optionalField: invalidValue },
          ['optionalField'] as const,
        ),
      ).toBeNull();
    },
  );
});
