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
import type { InvoiceDocumentStorage } from '../ports/invoiceDocumentStorage.js';
import { ApprovedInvoiceNotFoundError } from './approvedInvoiceNotFoundError.js';
import {
  reopenApprovedInvoiceForEditing,
  type ReopenApprovedInvoiceForEditingInput,
} from './reopenApprovedInvoiceForEditing.js';

class FakeInvoiceApprovalRepository implements InvoiceApprovalRepository {
  reopenInputs: ReopenApprovedInvoicePersistenceInput[] = [];

  constructor(
    private readonly result: ReopenedApprovedInvoiceResult | undefined,
  ) {}

  async approveDraft(
    _input: ApproveInvoiceDraftPersistenceInput,
  ): Promise<ApprovedInvoiceResult | undefined> {
    throw new Error('Not implemented in this reopen test.');
  }

  async markApprovedInvoiceSent(
    _input: MarkApprovedInvoiceSentPersistenceInput,
  ): Promise<MarkApprovedInvoiceSentResult | undefined> {
    throw new Error('Not implemented in this reopen test.');
  }

  async reopenApprovedInvoiceForEditing(
    input: ReopenApprovedInvoicePersistenceInput,
  ): Promise<ReopenedApprovedInvoiceResult | undefined> {
    this.reopenInputs.push(input);

    return this.result;
  }
}

function createInput(
  overrides: Partial<ReopenApprovedInvoiceForEditingInput> = {},
): ReopenApprovedInvoiceForEditingInput {
  return {
    actorUserId: 'user-1',
    companyId: 'dev-company',
    invoiceId: 'invoice-1',
    reopenedAt: '2026-07-05T10:00:00.000Z',
    ...overrides,
  };
}

describe('reopenApprovedInvoiceForEditing', () => {
  it('validates input and delegates reopening to the repository', async () => {
    const repository = new FakeInvoiceApprovalRepository({
      draftId: 'draft-1',
      invoiceId: 'invoice-1',
      removedDocumentStoragePaths: [],
    });

    await expect(
      reopenApprovedInvoiceForEditing(createInput(), {
        invoiceApprovalRepository: repository,
      }),
    ).resolves.toEqual({
      draftId: 'draft-1',
      invoiceId: 'invoice-1',
      removedDocumentStoragePaths: [],
    });

    expect(repository.reopenInputs).toEqual([
      {
        actorUserId: 'user-1',
        auditEventId: expect.stringMatching(
          /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
        ),
        companyId: 'dev-company',
        invoiceId: 'invoice-1',
        reopenedAt: '2026-07-05T10:00:00.000Z',
      },
    ]);
  });

  it('throws a generic not-found error when the invoice cannot be reopened', async () => {
    const repository = new FakeInvoiceApprovalRepository(undefined);

    await expect(
      reopenApprovedInvoiceForEditing(createInput(), {
        invoiceApprovalRepository: repository,
      }),
    ).rejects.toEqual(new ApprovedInvoiceNotFoundError());
  });

  it('rejects invalid identifiers before calling the repository', async () => {
    const repository = new FakeInvoiceApprovalRepository({
      draftId: 'draft-1',
      invoiceId: 'invoice-1',
      removedDocumentStoragePaths: [],
    });

    await expect(
      reopenApprovedInvoiceForEditing(createInput({ invoiceId: '' }), {
        invoiceApprovalRepository: repository,
      }),
    ).rejects.toThrow();

    expect(repository.reopenInputs).toEqual([]);
  });

  it('removes old PDF files from storage after the invoice is reopened', async () => {
    const repository = new FakeInvoiceApprovalRepository({
      draftId: 'draft-1',
      invoiceId: 'invoice-1',
      removedDocumentStoragePaths: ['dev-company/invoice-1/approved-invoice.pdf'],
    });
    const storage = new FakeInvoiceDocumentStorage();

    await reopenApprovedInvoiceForEditing(createInput(), {
      invoiceApprovalRepository: repository,
      invoiceDocumentStorage: storage,
    });

    expect(storage.deletedPaths).toEqual([
      'dev-company/invoice-1/approved-invoice.pdf',
    ]);
  });
});

class FakeInvoiceDocumentStorage implements InvoiceDocumentStorage {
  deletedPaths: string[] = [];

  async deleteFile(storagePath: string): Promise<void> {
    this.deletedPaths.push(storagePath);
  }

  async readFile(_storagePath: string): Promise<Uint8Array> {
    throw new Error('Not implemented in this reopen test.');
  }

  async writeFile(_storagePath: string, _content: Uint8Array): Promise<void> {
    throw new Error('Not implemented in this reopen test.');
  }
}
