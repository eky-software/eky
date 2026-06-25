import { describe, expect, it } from 'vitest';

import {
  type InvoiceNumberSequenceState,
  type StoredInvoiceNumberingSettings,
} from '../domain/invoiceNumbering.js';
import { InvoiceNumberingError } from '../domain/invoiceNumberingError.js';
import type { InvoiceNumberSequenceRepository } from '../ports/invoiceNumberSequenceRepository.js';
import type { InvoiceNumberingSettingsRepository } from '../ports/invoiceNumberingSettingsRepository.js';
import {
  reserveInvoiceNumber,
  type ReserveInvoiceNumberDependencies,
  type ReserveInvoiceNumberInput,
} from './reserveInvoiceNumber.js';
import { ReserveInvoiceNumberError } from './reserveInvoiceNumberError.js';

class FakeInvoiceNumberingSettingsRepository
  implements InvoiceNumberingSettingsRepository
{
  private readonly settingsByKey = new Map<string, StoredInvoiceNumberingSettings>();

  constructor(settings: StoredInvoiceNumberingSettings[] = [createSettings()]) {
    for (const item of settings) {
      this.settingsByKey.set(createKey(item.companyId, item.seriesKey), item);
    }
  }

  async getSettings(
    companyId: string,
    seriesKey: string,
  ): Promise<StoredInvoiceNumberingSettings | undefined> {
    return this.settingsByKey.get(createKey(companyId, seriesKey));
  }

  async saveSettings(
    settings: StoredInvoiceNumberingSettings,
  ): Promise<StoredInvoiceNumberingSettings> {
    this.settingsByKey.set(
      createKey(settings.companyId, settings.seriesKey),
      settings,
    );

    return settings;
  }

  async hasUsedNumbering(): Promise<boolean> {
    return false;
  }
}

class FakeInvoiceNumberSequenceRepository
  implements InvoiceNumberSequenceRepository
{
  savedSequences: InvoiceNumberSequenceState[] = [];
  private readonly sequencesByKey = new Map<string, InvoiceNumberSequenceState>();

  constructor(sequences: InvoiceNumberSequenceState[] = []) {
    for (const item of sequences) {
      this.sequencesByKey.set(
        createSequenceKey(item.companyId, item.seriesKey, item.sequenceScope),
        item,
      );
    }
  }

  async getSequence(
    companyId: string,
    seriesKey: string,
    sequenceScope: string,
  ): Promise<InvoiceNumberSequenceState | undefined> {
    return this.sequencesByKey.get(
      createSequenceKey(companyId, seriesKey, sequenceScope),
    );
  }

  async saveSequence(
    sequence: InvoiceNumberSequenceState,
  ): Promise<InvoiceNumberSequenceState> {
    this.savedSequences.push(sequence);
    this.sequencesByKey.set(
      createSequenceKey(
        sequence.companyId,
        sequence.seriesKey,
        sequence.sequenceScope,
      ),
      sequence,
    );

    return sequence;
  }
}

class InconsistentInvoiceNumberSequenceRepository
  extends FakeInvoiceNumberSequenceRepository
{
  override async saveSequence(
    sequence: InvoiceNumberSequenceState,
  ): Promise<InvoiceNumberSequenceState> {
    await super.saveSequence(sequence);

    return {
      ...sequence,
      lastSequenceNumber: sequence.lastSequenceNumber + 1,
    };
  }
}

function createKey(companyId: string, seriesKey: string): string {
  return `${companyId}:${seriesKey}`;
}

function createSequenceKey(
  companyId: string,
  seriesKey: string,
  sequenceScope: string,
): string {
  return `${companyId}:${seriesKey}:${sequenceScope}`;
}

function createSettings(
  overrides: Partial<StoredInvoiceNumberingSettings> = {},
): StoredInvoiceNumberingSettings {
  return {
    companyId: 'dev-company',
    seriesKey: 'default',
    mode: 'calendarYearSequence',
    fiscalYearStartMonth: 1,
    sequencePadding: 4,
    firstSequenceNumber: 1,
    createdAt: '2026-06-25T10:00:00.000Z',
    updatedAt: '2026-06-25T10:00:00.000Z',
    ...overrides,
  };
}

function createSequence(
  overrides: Partial<InvoiceNumberSequenceState> = {},
): InvoiceNumberSequenceState {
  return {
    companyId: 'dev-company',
    seriesKey: 'default',
    sequenceScope: 'calendar-year:2027',
    lastSequenceNumber: 41,
    createdAt: '2026-06-25T10:00:00.000Z',
    updatedAt: '2026-06-25T10:00:00.000Z',
    ...overrides,
  };
}

function createInput(
  overrides: Partial<ReserveInvoiceNumberInput> = {},
): ReserveInvoiceNumberInput {
  return {
    companyId: 'dev-company',
    seriesKey: 'default',
    invoiceDate: '2027-01-15',
    now: '2027-01-15T12:00:00.000Z',
    ...overrides,
  };
}

function createDependencies(options: {
  settings?: StoredInvoiceNumberingSettings[];
  sequences?: InvoiceNumberSequenceState[];
  sequenceRepository?: InvoiceNumberSequenceRepository;
} = {}): ReserveInvoiceNumberDependencies & {
  invoiceNumberSequenceRepository: InvoiceNumberSequenceRepository;
} {
  return {
    invoiceNumberingSettingsRepository:
      new FakeInvoiceNumberingSettingsRepository(options.settings),
    invoiceNumberSequenceRepository:
      options.sequenceRepository ??
      new FakeInvoiceNumberSequenceRepository(options.sequences),
  };
}

function getFakeSequenceRepository(
  dependencies: ReserveInvoiceNumberDependencies,
): FakeInvoiceNumberSequenceRepository {
  return dependencies.invoiceNumberSequenceRepository as FakeInvoiceNumberSequenceRepository;
}

describe('reserveInvoiceNumber', () => {
  it('reserves the first number from the numbering settings first sequence number', async () => {
    const dependencies = createDependencies();

    await expect(
      reserveInvoiceNumber(createInput(), dependencies),
    ).resolves.toEqual({
      invoiceNumber: '20270001',
      seriesKey: 'default',
      sequenceScope: 'calendar-year:2027',
      sequenceNumber: 1,
      numberingMode: 'calendarYearSequence',
    });
    expect(getFakeSequenceRepository(dependencies).savedSequences).toEqual([
      {
        companyId: 'dev-company',
        seriesKey: 'default',
        sequenceScope: 'calendar-year:2027',
        lastSequenceNumber: 1,
        createdAt: '2027-01-15T12:00:00.000Z',
        updatedAt: '2027-01-15T12:00:00.000Z',
      },
    ]);
  });

  it('reserves the next number from the current sequence state', async () => {
    const dependencies = createDependencies({
      sequences: [createSequence()],
    });

    await expect(
      reserveInvoiceNumber(createInput(), dependencies),
    ).resolves.toMatchObject({
      invoiceNumber: '20270042',
      sequenceNumber: 42,
      sequenceScope: 'calendar-year:2027',
    });
    expect(getFakeSequenceRepository(dependencies).savedSequences).toEqual([
      {
        ...createSequence(),
        lastSequenceNumber: 42,
        createdAt: '2026-06-25T10:00:00.000Z',
        updatedAt: '2027-01-15T12:00:00.000Z',
      },
    ]);
  });

  it('uses the plain sequence scope for plain numbering', async () => {
    const dependencies = createDependencies({
      settings: [
        createSettings({
          mode: 'plainSequence',
          firstSequenceNumber: 1000,
          sequencePadding: 0,
        }),
      ],
    });

    await expect(
      reserveInvoiceNumber(createInput(), dependencies),
    ).resolves.toEqual({
      invoiceNumber: '1000',
      seriesKey: 'default',
      sequenceScope: 'plain',
      sequenceNumber: 1000,
      numberingMode: 'plainSequence',
    });
  });

  it('uses the fiscal year scope for fiscal-year numbering', async () => {
    const dependencies = createDependencies({
      settings: [
        createSettings({
          mode: 'fiscalYearSequence',
          fiscalYearStartMonth: 2,
        }),
      ],
    });

    await expect(
      reserveInvoiceNumber(
        createInput({ invoiceDate: '2027-01-31' }),
        dependencies,
      ),
    ).resolves.toMatchObject({
      invoiceNumber: '20260001',
      sequenceScope: 'fiscal-year:2026',
      sequenceNumber: 1,
    });
  });

  it('uses calendar year scope independently from fiscal year start month', async () => {
    const dependencies = createDependencies({
      settings: [
        createSettings({
          mode: 'calendarYearSequence',
          fiscalYearStartMonth: 2,
        }),
      ],
    });

    await expect(
      reserveInvoiceNumber(
        createInput({ invoiceDate: '2027-01-31' }),
        dependencies,
      ),
    ).resolves.toMatchObject({
      invoiceNumber: '20270001',
      sequenceScope: 'calendar-year:2027',
      sequenceNumber: 1,
    });
  });

  it('keeps different sequence scopes independent from each other', async () => {
    const dependencies = createDependencies({
      sequences: [
        createSequence({
          sequenceScope: 'calendar-year:2027',
          lastSequenceNumber: 9,
        }),
      ],
    });

    await expect(
      reserveInvoiceNumber(
        createInput({ invoiceDate: '2028-01-01' }),
        dependencies,
      ),
    ).resolves.toMatchObject({
      invoiceNumber: '20280001',
      sequenceScope: 'calendar-year:2028',
      sequenceNumber: 1,
    });
  });

  it('throws when numbering settings are missing', async () => {
    const dependencies = createDependencies({ settings: [] });

    await expect(
      reserveInvoiceNumber(createInput(), dependencies),
    ).rejects.toThrow(ReserveInvoiceNumberError);
  });

  it('throws when invoice date is invalid', async () => {
    const dependencies = createDependencies();

    await expect(
      reserveInvoiceNumber(
        createInput({ invoiceDate: '2027/01/15' }),
        dependencies,
      ),
    ).rejects.toThrow(InvoiceNumberingError);
  });

  it('throws when series key is invalid', async () => {
    const dependencies = createDependencies();

    await expect(
      reserveInvoiceNumber(
        createInput({ seriesKey: 'default;drop' }),
        dependencies,
      ),
    ).rejects.toThrow(InvoiceNumberingError);
  });

  it('throws when required application input is empty', async () => {
    const dependencies = createDependencies();

    await expect(
      reserveInvoiceNumber(createInput({ companyId: '   ' }), dependencies),
    ).rejects.toThrow(ReserveInvoiceNumberError);
    await expect(
      reserveInvoiceNumber(createInput({ now: '' }), dependencies),
    ).rejects.toThrow(ReserveInvoiceNumberError);
  });

  it('throws before saving when the next sequence number is unsafe', async () => {
    const dependencies = createDependencies({
      sequences: [
        createSequence({
          lastSequenceNumber: Number.MAX_SAFE_INTEGER,
        }),
      ],
    });

    await expect(
      reserveInvoiceNumber(createInput(), dependencies),
    ).rejects.toThrow(InvoiceNumberingError);
    expect(getFakeSequenceRepository(dependencies).savedSequences).toEqual([]);
  });

  it('throws if repository returns an inconsistent saved sequence state', async () => {
    const dependencies = createDependencies({
      sequenceRepository: new InconsistentInvoiceNumberSequenceRepository(),
    });

    await expect(
      reserveInvoiceNumber(createInput(), dependencies),
    ).rejects.toThrow(ReserveInvoiceNumberError);
  });
});
