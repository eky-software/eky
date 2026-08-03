import { createActorContext } from '@eky/auth';
import { AuthorizationError } from '@eky/permissions';
import { describe, expect, it } from 'vitest';

import {
  activateInvoiceNumberingSeriesConfirmation,
  type InvoiceNumberingSeriesOverview,
} from '../domain/invoiceNumberingSeries.js';
import type {
  ActivateInvoiceNumberingSeriesPersistenceInput,
  ActivateInvoiceNumberingSeriesPersistenceResult,
  InvoiceNumberingSeriesRepository,
} from '../ports/invoiceNumberingSeriesRepository.js';
import { activateInvoiceNumberingSeries } from './activateInvoiceNumberingSeries.js';
import { getInvoiceNumberingSeriesOverview } from './getInvoiceNumberingSeriesOverview.js';
import { InvoiceNumberingSeriesError } from './invoiceNumberingSeriesError.js';
import { previewInvoiceNumberingSeriesActivation } from './previewInvoiceNumberingSeriesActivation.js';

class FakeInvoiceNumberingSeriesRepository
  implements InvoiceNumberingSeriesRepository
{
  activations: ActivateInvoiceNumberingSeriesPersistenceInput[] = [];

  constructor(
    private readonly overview: InvoiceNumberingSeriesOverview | undefined =
      createOverview(),
    private readonly activationResult:
      | ActivateInvoiceNumberingSeriesPersistenceResult
      | undefined = undefined,
  ) {}

  async getOverview(): Promise<InvoiceNumberingSeriesOverview | undefined> {
    return this.overview;
  }

  async getActivationPreview() {
    return this.overview === undefined
      ? undefined
      : {
          capacity: 'available' as const,
          maximumSequenceNumber: 999_999,
          minimumSafeFirstSequenceNumber: 100,
        };
  }

  async activate(
    input: ActivateInvoiceNumberingSeriesPersistenceInput,
  ): Promise<ActivateInvoiceNumberingSeriesPersistenceResult> {
    this.activations.push(input);
    const activatedOverview = createOverview({
      activeSeriesKey: input.nextSettings.seriesKey,
      revision: input.activeSeries.revision,
      updatedAt: input.activeSeries.updatedAt,
      updatedBy: input.activeSeries.updatedBy,
    });
    activatedOverview.activeSettings = input.nextSettings;

    return (
      this.activationResult ?? {
        outcome: 'activated',
        overview: activatedOverview,
      }
    );
  }
}

describe('invoice numbering series application services', () => {
  it('returns a company-scoped read-only overview', async () => {
    await expect(
      getInvoiceNumberingSeriesOverview(
        { actorContext: createActorContextForCompany('dev-company') },
        new FakeInvoiceNumberingSeriesRepository(),
      ),
    ).resolves.toMatchObject({
      activeSeries: {
        mode: 'calendarYearSequence',
      },
      revision: 1,
    });
  });

  it('returns a backend-calculated activation preview bound to its date', async () => {
    await expect(
      previewInvoiceNumberingSeriesActivation(
        {
          actorContext: createActorContextForCompany('dev-company'),
          fiscalYearStartMonth: 1,
          mode: 'calendarYearSequence',
          previewDate: '2026-08-02',
          sequencePadding: 4,
        },
        new FakeInvoiceNumberingSeriesRepository(),
      ),
    ).resolves.toEqual({
      capacity: 'available',
      maximumSequenceNumber: 999_999,
      minimumFirstSequenceNumber: 100,
      previewDate: '2026-08-02',
      previewInvoiceNumber: '20260100',
    });
  });

  it('requires the dedicated permission before reading or activating', async () => {
    const actorContext = createActorContext({
      actorId: 'limited-user',
      authenticationMode: 'local',
      companyId: 'dev-company',
      permissions: [],
    });
    const repository = new FakeInvoiceNumberingSeriesRepository();

    await expect(
      getInvoiceNumberingSeriesOverview({ actorContext }, repository),
    ).rejects.toThrow(AuthorizationError);
    await expect(
      activateInvoiceNumberingSeries(
        createActivationInput({ actorContext }),
        createDependencies(repository),
      ),
    ).rejects.toThrow(AuthorizationError);
    expect(repository.activations).toEqual([]);
  });

  it('builds trusted immutable persistence data after exact confirmation', async () => {
    const repository = new FakeInvoiceNumberingSeriesRepository();

    await expect(
      activateInvoiceNumberingSeries(
        createActivationInput({
          reasonNote: '  Kirjanpitäjän vahvistama muutos  ',
        }),
        createDependencies(repository),
      ),
    ).resolves.toMatchObject({
      activeSeries: {
        firstSequenceNumber: 100,
      },
      revision: 2,
    });

    expect(repository.activations).toEqual([
      {
        activeSeries: {
          companyId: 'dev-company',
          activeSeriesKey: 'series-generated',
          revision: 2,
          updatedAt: '2026-08-02T20:00:00.000Z',
          updatedBy: 'local-owner',
        },
        event: {
          id: 'event-generated',
          companyId: 'dev-company',
          actorUserId: 'local-owner',
          previousSeriesKey: 'default',
          nextSeriesKey: 'series-generated',
          reasonCode: 'accountingRequirement',
          reasonNote: 'Kirjanpitäjän vahvistama muutos',
          occurredAt: '2026-08-02T20:00:00.000Z',
        },
        expectedActiveSeriesKey: 'default',
        expectedRevision: 1,
        nextSettings: {
          companyId: 'dev-company',
          seriesKey: 'series-generated',
          mode: 'plainSequence',
          fiscalYearStartMonth: 1,
          sequencePadding: 5,
          firstSequenceNumber: 100,
          createdAt: '2026-08-02T20:00:00.000Z',
          updatedAt: '2026-08-02T20:00:00.000Z',
        },
      },
    ]);
  });

  it('rejects an inexact confirmation and invalid revision without persistence', async () => {
    const repository = new FakeInvoiceNumberingSeriesRepository();

    await expect(
      activateInvoiceNumberingSeries(
        createActivationInput({ confirmation: 'ota käyttöön' }),
        createDependencies(repository),
      ),
    ).rejects.toMatchObject({ code: 'confirmationInvalid' });
    await expect(
      activateInvoiceNumberingSeries(
        createActivationInput({ currentRevision: 0 }),
        createDependencies(repository),
      ),
    ).rejects.toMatchObject({ code: 'conflict' });
    expect(repository.activations).toEqual([]);
  });

  it.each([
    ['conflict', 'conflict'],
    ['notFound', 'notFound'],
    ['unsafeFirstSequenceNumber', 'unsafeFirstSequenceNumber'],
  ] as const)(
    'maps repository outcome %s to a safe application error',
    async (outcome, code) => {
      const repository = new FakeInvoiceNumberingSeriesRepository(
        createOverview(),
        { outcome },
      );

      await expect(
        activateInvoiceNumberingSeries(
          createActivationInput(),
          createDependencies(repository),
        ),
      ).rejects.toEqual(
        expect.objectContaining<Partial<InvoiceNumberingSeriesError>>({ code }),
      );
    },
  );
});

function createActivationInput(
  overrides: Partial<Parameters<typeof activateInvoiceNumberingSeries>[0]> = {},
): Parameters<typeof activateInvoiceNumberingSeries>[0] {
  return {
    actorContext: createActorContextForCompany('dev-company'),
    confirmation: activateInvoiceNumberingSeriesConfirmation,
    currentRevision: 1,
    firstSequenceNumber: 100,
    fiscalYearStartMonth: 1,
    mode: 'plainSequence',
    now: '2026-08-02T20:00:00.000Z',
    reasonCode: 'accountingRequirement',
    sequencePadding: 5,
    ...overrides,
  };
}

function createDependencies(repository: InvoiceNumberingSeriesRepository) {
  return {
    createEventId: () => 'event-generated',
    createSeriesKey: () => 'series-generated',
    repository,
  };
}

function createOverview(
  activeOverrides: Partial<
    InvoiceNumberingSeriesOverview['activeSeries']
  > = {},
): InvoiceNumberingSeriesOverview {
  const activeSeries = {
    companyId: 'dev-company',
    activeSeriesKey: 'default',
    revision: 1,
    updatedAt: '2026-06-25T10:00:00.000Z',
    updatedBy: 'local-owner',
    ...activeOverrides,
  };

  return {
    activeSeries,
    activeSettings: {
      companyId: activeSeries.companyId,
      seriesKey: activeSeries.activeSeriesKey,
      mode: 'calendarYearSequence',
      fiscalYearStartMonth: 1,
      sequencePadding: 4,
      firstSequenceNumber: 1,
      createdAt: '2026-06-25T10:00:00.000Z',
      updatedAt: activeSeries.updatedAt,
    },
    history: [],
  };
}

function createActorContextForCompany(companyId: string) {
  return createActorContext({
    actorId: 'local-owner',
    authenticationMode: 'local',
    companyId,
    permissions: ['manageInvoiceNumberingSeries'],
  });
}
