import { describe, expect, it } from 'vitest';
import { createActorContext } from '@eky/auth';

import type {
  ApproveCreditInvoiceDraftPersistenceInput,
  ApproveCreditInvoiceDraftPersistenceResult,
  InvoiceCreditApprovalRepository,
} from '../ports/invoiceCreditApprovalRepository.js';
import {
  approveCreditInvoiceDraft,
  type ApproveCreditInvoiceDraftInput,
} from './approveCreditInvoiceDraft.js';
import { InvoiceCreditConflictError } from './invoiceCreditConflictError.js';
import { InvoiceDraftNotFoundError } from './invoiceDraftNotFoundError.js';

class FakeInvoiceCreditApprovalRepository
  implements InvoiceCreditApprovalRepository
{
  inputs: ApproveCreditInvoiceDraftPersistenceInput[] = [];

  constructor(
    private readonly result: ApproveCreditInvoiceDraftPersistenceResult,
  ) {}

  async approveCreditDraft(
    input: ApproveCreditInvoiceDraftPersistenceInput,
  ): Promise<ApproveCreditInvoiceDraftPersistenceResult> {
    this.inputs.push(input);

    return this.result;
  }
}

describe('approveCreditInvoiceDraft', () => {
  it('validates trusted context and delegates with generated ids', async () => {
    const repository = new FakeInvoiceCreditApprovalRepository({
      outcome: 'approved',
      invoice: createResult(),
    });

    await expect(
      approveCreditInvoiceDraft(createInput(), {
        invoiceCreditApprovalRepository: repository,
      }),
    ).resolves.toEqual(createResult());

    expect(repository.inputs).toEqual([
      {
        actorUserId: 'user-1',
        approvedAt: '2026-07-23T12:00:00.000Z',
        auditEventId: expect.stringMatching(
          /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
        ),
        companyId: 'company-1',
        draftId: 'credit-draft-1',
        invoiceId: expect.stringMatching(
          /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
        ),
        seriesKey: 'default',
      },
    ]);
  });

  it('keeps missing and inaccessible drafts behind one generic error', async () => {
    const repository = new FakeInvoiceCreditApprovalRepository({
      outcome: 'notFound',
    });

    await expect(
      approveCreditInvoiceDraft(createInput(), {
        invoiceCreditApprovalRepository: repository,
      }),
    ).rejects.toEqual(new InvoiceDraftNotFoundError());
  });

  it('maps changed source eligibility to a safe conflict', async () => {
    const repository = new FakeInvoiceCreditApprovalRepository({
      outcome: 'conflict',
    });

    await expect(
      approveCreditInvoiceDraft(createInput(), {
        invoiceCreditApprovalRepository: repository,
      }),
    ).rejects.toEqual(new InvoiceCreditConflictError());
  });

  it('rejects empty identifiers before persistence', async () => {
    const repository = new FakeInvoiceCreditApprovalRepository({
      outcome: 'approved',
      invoice: createResult(),
    });

    await expect(
      approveCreditInvoiceDraft(createInput({ draftId: '   ' }), {
        invoiceCreditApprovalRepository: repository,
      }),
    ).rejects.toThrow();
    expect(repository.inputs).toEqual([]);
  });
});

function createInput(
  overrides: Partial<ApproveCreditInvoiceDraftInput> = {},
): ApproveCreditInvoiceDraftInput {
  return {
    actorContext: createActorContext({
      actorId: 'user-1',
      authenticationMode: 'local',
      companyId: 'company-1',
      permissions: ['manageInvoiceCorrections'],
    }),
    approvedAt: '2026-07-23T12:00:00.000Z',
    draftId: 'credit-draft-1',
    seriesKey: 'default',
    ...overrides,
  };
}

function createResult() {
  return {
    invoiceId: 'credit-invoice-1',
    draftId: 'credit-draft-1',
    invoiceNumber: '20260002',
    sequenceNumber: 2,
    sequenceScope: 'calendar-year:2026',
    numberingMode: 'calendarYearSequence' as const,
    status: 'approved' as const,
  };
}
