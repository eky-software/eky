import { describe, expect, it } from 'vitest';

import type {
  ApprovedInvoiceResult,
  ApproveInvoiceDraftPersistenceInput,
  InvoiceApprovalRepository,
  ReopenApprovedInvoicePersistenceInput,
  ReopenedApprovedInvoiceResult,
  MarkApprovedInvoiceSentPersistenceInput,
  MarkApprovedInvoiceSentResult,
} from '../ports/invoiceApprovalRepository.js';
import {
  approveInvoiceDraft,
  type ApproveInvoiceDraftInput,
} from './approveInvoiceDraft.js';
import { InvoiceDraftNotFoundError } from './invoiceDraftNotFoundError.js';

class FakeInvoiceApprovalRepository implements InvoiceApprovalRepository {
  approveInputs: ApproveInvoiceDraftPersistenceInput[] = [];

  constructor(private readonly result: ApprovedInvoiceResult | undefined) {}

  async approveDraft(
    input: ApproveInvoiceDraftPersistenceInput,
  ): Promise<ApprovedInvoiceResult | undefined> {
    this.approveInputs.push(input);

    return this.result;
  }

  async markApprovedInvoiceSent(
    _input: MarkApprovedInvoiceSentPersistenceInput,
  ): Promise<MarkApprovedInvoiceSentResult | undefined> {
    throw new Error('Not implemented in this approve test.');
  }

  async reopenApprovedInvoiceForEditing(
    _input: ReopenApprovedInvoicePersistenceInput,
  ): Promise<ReopenedApprovedInvoiceResult | undefined> {
    throw new Error('Not implemented in this approval test.');
  }
}

function createInput(
  overrides: Partial<ApproveInvoiceDraftInput> = {},
): ApproveInvoiceDraftInput {
  return {
    actorUserId: 'user-1',
    approvedAt: '2026-06-25T10:00:00.000Z',
    companyId: 'dev-company',
    draftId: 'draft-1',
    seriesKey: 'default',
    ...overrides,
  };
}

function createResult(
  overrides: Partial<ApprovedInvoiceResult> = {},
): ApprovedInvoiceResult {
  return {
    draftId: 'draft-1',
    invoiceId: 'invoice-1',
    invoiceNumber: '20260001',
    numberingMode: 'calendarYearSequence',
    referenceNumber: '202600017',
    referenceNumberType: 'finnishDomestic',
    sequenceNumber: 1,
    sequenceScope: 'calendar-year:2026',
    status: 'approved',
    ...overrides,
  };
}

describe('approveInvoiceDraft', () => {
  it('validates input and delegates approval to the repository with generated ids', async () => {
    const repository = new FakeInvoiceApprovalRepository(createResult());

    await expect(
      approveInvoiceDraft(createInput(), {
        invoiceApprovalRepository: repository,
      }),
    ).resolves.toEqual(createResult());

    expect(repository.approveInputs).toEqual([
      {
        actorUserId: 'user-1',
        approvedAt: '2026-06-25T10:00:00.000Z',
        auditEventId: expect.stringMatching(
          /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
        ),
        companyId: 'dev-company',
        draftId: 'draft-1',
        invoiceId: expect.stringMatching(
          /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
        ),
        reverseChargeEligibilityConfirmed: false,
        seriesKey: 'default',
      },
    ]);
  });

  it('throws a generic not-found error when the draft is not available', async () => {
    const repository = new FakeInvoiceApprovalRepository(undefined);

    await expect(
      approveInvoiceDraft(createInput(), {
        invoiceApprovalRepository: repository,
      }),
    ).rejects.toEqual(new InvoiceDraftNotFoundError());
    await expect(
      approveInvoiceDraft(createInput(), {
        invoiceApprovalRepository: repository,
      }),
    ).rejects.toThrow('Invoice draft not found.');
  });

  it('passes an explicit reverse charge confirmation to persistence', async () => {
    const repository = new FakeInvoiceApprovalRepository(createResult());

    await approveInvoiceDraft(
      createInput({ reverseChargeEligibilityConfirmed: true }),
      { invoiceApprovalRepository: repository },
    );

    expect(repository.approveInputs[0]).toMatchObject({
      reverseChargeEligibilityConfirmed: true,
    });
  });

  it('keeps a rejected credit draft behind the generic not-found boundary', async () => {
    const repository = new FakeInvoiceApprovalRepository(undefined);

    await expect(
      approveInvoiceDraft(createInput({ draftId: 'credit-draft-1' }), {
        invoiceApprovalRepository: repository,
      }),
    ).rejects.toEqual(new InvoiceDraftNotFoundError());

    expect(repository.approveInputs).toHaveLength(1);
  });

  it('rejects invalid identifiers before calling the repository', async () => {
    const repository = new FakeInvoiceApprovalRepository(createResult());

    await expect(
      approveInvoiceDraft(createInput({ seriesKey: 'default;drop' }), {
        invoiceApprovalRepository: repository,
      }),
    ).rejects.toThrow();

    expect(repository.approveInputs).toEqual([]);
  });
});
