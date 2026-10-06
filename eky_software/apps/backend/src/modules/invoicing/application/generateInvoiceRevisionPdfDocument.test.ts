import { describe, expect, it } from 'vitest';

import type { RevisionInvoiceDocumentMetadata } from '../domain/approvedInvoiceDocument.js';
import type { InvoiceContentRevision } from '../domain/invoiceContentRevision.js';
import { ApprovedInvoiceNotFoundError } from './approvedInvoiceNotFoundError.js';
import {
  createControlledPromise,
  createDocumentMetadata,
  createPdfGeneratorFixture,
  createRevisionInput,
  publishedDocument,
} from './generateApprovedInvoicePdfDocument.fixture.js';
import { generateInvoiceRevisionPdfDocument } from './generateApprovedInvoicePdfDocument.js';
import { InvoiceContentRevisionIntegrityError } from './invoiceContentRevisionIntegrityError.js';
import { InvoiceDocumentIntegrityError } from './invoiceDocumentIntegrityError.js';
import { InvoiceDocumentPublicationConflictError } from './invoiceDocumentPublicationConflictError.js';
import {
  createCreditRevisionPdfContentFixture,
  createInvoiceRevisionPdfContentFixture,
} from './toInvoiceRevisionPdfContent.fixture.js';
import { InvoiceRevisionPdfContentUnavailableError } from './toInvoiceRevisionPdfContent.js';

describe('generateInvoiceRevisionPdfDocument', () => {
  it.each([
    { kind: 'standard', createRevision: createInvoiceRevisionPdfContentFixture },
    { kind: 'credit', createRevision: createCreditRevisionPdfContentFixture },
  ])('uses the approval hook $kind key without a latest-revision lookup', async ({ createRevision }) => {
    const revision = createRevision();
    const fixture = createPdfGeneratorFixture(revision);
    fixture.reader.getCurrentRevision.mockRejectedValue(new Error('Approval hooks must not read latest.'));
    const input = createRevisionInput(revision);

    const metadata = await generateInvoiceRevisionPdfDocument(input, fixture.dependencies);

    expect(fixture.reader.getRevision).toHaveBeenCalledExactlyOnceWith(input.key);
    expect(fixture.reader.getCurrentRevision).not.toHaveBeenCalled();
    expect(fixture.repository.findDocumentForRevision).toHaveBeenCalledExactlyOnceWith(input.key);
    expect(fixture.repository.publishDocumentIfCurrent.mock.calls[0]![0].key).toStrictEqual(input.key);
    expect(metadata.binding).toStrictEqual({ kind: 'revision', revisionId: revision.revisionId });
    expect(fixture.renderApprovedInvoicePdf.mock.calls[0]![0].vatBreakdown).toStrictEqual(revision.vatBreakdown);
    expect(fixture.repository.publishPreservedLegacyDocument).not.toHaveBeenCalled();
  });

  it('does not fall back to an available latest revision when the exact key is missing', async () => {
    const fixture = createPdfGeneratorFixture();
    fixture.reader.getCurrentRevision.mockResolvedValue({
      ...createInvoiceRevisionPdfContentFixture(), revisionId: 'newer-revision',
    });
    fixture.reader.getRevision.mockResolvedValue(undefined);

    await expect(generateInvoiceRevisionPdfDocument(createRevisionInput(), fixture.dependencies))
      .rejects.toEqual(new ApprovedInvoiceNotFoundError());

    expect(fixture.reader.getRevision).toHaveBeenCalledExactlyOnceWith(createRevisionInput().key);
    expect(fixture.reader.getCurrentRevision).not.toHaveBeenCalled();
    expect(fixture.repository.findDocumentForRevision).not.toHaveBeenCalled();
    expect(fixture.renderApprovedInvoicePdf).not.toHaveBeenCalled();
    expect(fixture.storage.writeCandidate).not.toHaveBeenCalled();
    expect(fixture.repository.publishDocumentIfCurrent).not.toHaveBeenCalled();
  });

  it.each(['companyId', 'invoiceId', 'revisionId'] as const)(
    'rejects a revision reader result with foreign %s before cache or rendering', async (field) => {
      const fixture = createPdfGeneratorFixture();
      fixture.reader.getRevision.mockResolvedValue({
        ...createInvoiceRevisionPdfContentFixture(), [field]: 'foreign-source',
      });

      await expect(generateInvoiceRevisionPdfDocument(createRevisionInput(), fixture.dependencies))
        .rejects.toEqual(new InvoiceContentRevisionIntegrityError());

      expect(fixture.reader.getCurrentRevision).not.toHaveBeenCalled();
      expect(fixture.repository.findDocumentForRevision).not.toHaveBeenCalled();
      expect(fixture.renderApprovedInvoicePdf).not.toHaveBeenCalled();
      expect(fixture.storage.writeCandidate).not.toHaveBeenCalled();
      expect(fixture.repository.publishDocumentIfCurrent).not.toHaveBeenCalled();
    },
  );

  it('preserves a revision integrity error rather than treating it as missing or latest', async () => {
    const fixture = createPdfGeneratorFixture();
    const error = new InvoiceContentRevisionIntegrityError();
    fixture.reader.getRevision.mockRejectedValue(error);

    await expect(generateInvoiceRevisionPdfDocument(createRevisionInput(), fixture.dependencies))
      .rejects.toBe(error);

    expect(fixture.reader.getCurrentRevision).not.toHaveBeenCalled();
    expect(fixture.repository.findDocumentForRevision).not.toHaveBeenCalled();
    expect(fixture.renderApprovedInvoicePdf).not.toHaveBeenCalled();
    expect(fixture.storage.writeCandidate).not.toHaveBeenCalled();
  });

  it('keeps legacyUnavailable distinct from a renderable empty VAT breakdown', async () => {
    const revision: InvoiceContentRevision = {
      ...createInvoiceRevisionPdfContentFixture(),
      origin: 'legacySnapshot', vatBreakdownState: 'unavailable', vatBreakdown: null,
    };
    const before = structuredClone(revision);
    const fixture = createPdfGeneratorFixture(revision);

    await expect(generateInvoiceRevisionPdfDocument(createRevisionInput(revision), fixture.dependencies))
      .rejects.toEqual(new InvoiceRevisionPdfContentUnavailableError());

    expect(revision).toStrictEqual(before);
    expect(fixture.reader.getCurrentRevision).not.toHaveBeenCalled();
    expect(fixture.repository.findDocumentForRevision).not.toHaveBeenCalled();
    expect(fixture.renderApprovedInvoicePdf).not.toHaveBeenCalled();
    expect(fixture.storage.writeCandidate).not.toHaveBeenCalled();
    expect(fixture.repository.publishDocumentIfCurrent).not.toHaveBeenCalled();
    expect(fixture.repository.publishPreservedLegacyDocument).not.toHaveBeenCalled();
  });

  it('allows an authoritative validated legacy snapshot as the exact rendering source', async () => {
    const revision = { ...createInvoiceRevisionPdfContentFixture(), origin: 'validatedLegacySnapshot' as const };
    const fixture = createPdfGeneratorFixture(revision);

    await generateInvoiceRevisionPdfDocument(createRevisionInput(revision), fixture.dependencies);

    expect(fixture.renderApprovedInvoicePdf.mock.calls[0]![0].totals).toStrictEqual({
      netTotalCents: 104, vatTotalCents: 15, grossTotalCents: 119,
    });
    expect(fixture.repository.publishDocumentIfCurrent).toHaveBeenCalledOnce();
    expect(fixture.repository.publishPreservedLegacyDocument).not.toHaveBeenCalled();
  });

  it.each(['render', 'write'] as const)('propagates a %s failure without publishing or claiming cleanup', async (stage) => {
    const fixture = createPdfGeneratorFixture();
    const error = new Error(`Synthetic ${stage} failure.`);
    if (stage === 'render') fixture.renderApprovedInvoicePdf.mockRejectedValue(error);
    else fixture.storage.writeCandidate.mockRejectedValue(error);

    await expect(generateInvoiceRevisionPdfDocument(createRevisionInput(), fixture.dependencies))
      .rejects.toBe(error);

    expect(fixture.renderApprovedInvoicePdf).toHaveBeenCalledOnce();
    expect(fixture.storage.writeCandidate).toHaveBeenCalledTimes(stage === 'write' ? 1 : 0);
    expect(fixture.repository.publishDocumentIfCurrent).not.toHaveBeenCalled();
    expect(fixture.discardCandidate).not.toHaveBeenCalled();
    expect(fixture.retainedCandidates.size).toBe(0);
  });

  it.each([false, true])('retains a safe conflict and reports candidateCleanupFailed=%s', async (cleanupFailed) => {
    const fixture = createPdfGeneratorFixture();
    fixture.retainedCandidates.set('unrelated-document', fixture.pdf);
    fixture.repository.publishDocumentIfCurrent.mockResolvedValue({ outcome: 'conflict' });
    if (cleanupFailed) fixture.discardCandidate.mockRejectedValue(new Error('Synthetic private cleanup detail.'));

    const error = await generateInvoiceRevisionPdfDocument(createRevisionInput(), fixture.dependencies)
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(InvoiceDocumentPublicationConflictError);
    expect(error).toMatchObject({
      name: 'InvoiceDocumentPublicationConflictError',
      message: 'Invoice changed before the PDF operation completed.',
      candidateCleanupFailed: cleanupFailed,
    });
    expect(error).not.toHaveProperty('cause');
    expect(fixture.repository.publishDocumentIfCurrent).toHaveBeenCalledOnce();
    const { candidate } = fixture.repository.publishDocumentIfCurrent.mock.calls[0]![0];
    expect(fixture.discardCandidate).toHaveBeenCalledExactlyOnceWith(candidate.id);
    expect(fixture.retainedCandidates.has(candidate.id)).toBe(cleanupFailed);
    expect(fixture.retainedCandidates.get('unrelated-document')).toBe(fixture.pdf);
    expect(fixture.storage.readVerifiedDocument).not.toHaveBeenCalled();
    expect(fixture.reader.getCurrentRevision).not.toHaveBeenCalled();
  });

  it('retains its candidate when publication throws with an uncertain commit outcome', async () => {
    const fixture = createPdfGeneratorFixture();
    const error = new Error('Synthetic publication acknowledgement failure.');
    fixture.repository.publishDocumentIfCurrent.mockRejectedValue(error);

    await expect(generateInvoiceRevisionPdfDocument(createRevisionInput(), fixture.dependencies))
      .rejects.toBe(error);

    expect(fixture.repository.publishDocumentIfCurrent).toHaveBeenCalledOnce();
    const { candidate } = fixture.repository.publishDocumentIfCurrent.mock.calls[0]![0];
    expect(fixture.retainedCandidates.get(candidate.id)).toStrictEqual(fixture.pdf);
    expect(fixture.discardCandidate).not.toHaveBeenCalled();
    expect(fixture.storage.readVerifiedDocument).not.toHaveBeenCalled();
    expect(fixture.reader.getCurrentRevision).not.toHaveBeenCalled();
  });

  it.each(['published', 'existing'] as const)('keeps its own acknowledged %s candidate', async (outcome) => {
    const fixture = createPdfGeneratorFixture();
    fixture.repository.publishDocumentIfCurrent.mockImplementation(async (input) => ({
      outcome, document: publishedDocument(input),
    }));

    const document = await generateInvoiceRevisionPdfDocument(createRevisionInput(), fixture.dependencies);

    expect(fixture.retainedCandidates.get(document.id)).toStrictEqual(fixture.pdf);
    expect(fixture.discardCandidate).not.toHaveBeenCalled();
    expect(fixture.storage.readVerifiedDocument).not.toHaveBeenCalled();
  });

  it.each([
    { id: 'foreign-document' },
    { storagePath: 'foreign-document.pdf' },
    { sha256: 'b'.repeat(64) },
    { sizeBytes: 999 },
    { companyId: 'foreign-company' },
    { invoiceId: 'foreign-invoice' },
    { binding: { kind: 'revision' as const, revisionId: 'foreign-revision' } },
  ])('rejects inconsistent published metadata without discarding uncertain evidence: %j', async (overrides) => {
    const fixture = createPdfGeneratorFixture();
    fixture.repository.publishDocumentIfCurrent.mockImplementation(async (input) => ({
      outcome: 'published', document: { ...publishedDocument(input), ...overrides },
    }));

    await expect(generateInvoiceRevisionPdfDocument(createRevisionInput(), fixture.dependencies))
      .rejects.toEqual(new InvoiceDocumentIntegrityError());

    const { candidate } = fixture.repository.publishDocumentIfCurrent.mock.calls[0]![0];
    expect(fixture.retainedCandidates.get(candidate.id)).toStrictEqual(fixture.pdf);
    expect(fixture.discardCandidate).not.toHaveBeenCalled();
  });

  it('rejects an existing winner sharing the candidate path without deleting either', async () => {
    const fixture = createPdfGeneratorFixture();
    fixture.repository.publishDocumentIfCurrent.mockImplementation(async (input) => ({
      outcome: 'existing', document: { ...publishedDocument(input), id: 'other-winner' },
    }));

    await expect(generateInvoiceRevisionPdfDocument(createRevisionInput(), fixture.dependencies))
      .rejects.toEqual(new InvoiceDocumentIntegrityError());

    expect(fixture.discardCandidate).not.toHaveBeenCalled();
    expect(fixture.retainedCandidates.size).toBe(1);
    expect(fixture.storage.readVerifiedDocument).not.toHaveBeenCalled();
  });

  it.each(['verified', 'corrupt', 'no-longer-current'] as const)(
    'discards only its loser and checks the existing winner: %s', async (state) => {
      const fixture = createPdfGeneratorFixture();
      const winner = createDocumentMetadata();
      fixture.retainedCandidates.set(winner.id, fixture.pdf);
      fixture.repository.publishDocumentIfCurrent.mockResolvedValue({ outcome: 'existing', document: winner });
      fixture.repository.findCurrentDocumentForRevision.mockResolvedValue(state === 'no-longer-current' ? undefined : winner);
      const corruption = new InvoiceDocumentIntegrityError();
      if (state === 'corrupt') fixture.storage.readVerifiedDocument.mockRejectedValue(corruption);

      const pending = generateInvoiceRevisionPdfDocument(createRevisionInput(), fixture.dependencies);
      if (state === 'verified') await expect(pending).resolves.toBe(winner);
      else if (state === 'corrupt') await expect(pending).rejects.toBe(corruption);
      else await expect(pending).rejects.toBeInstanceOf(InvoiceDocumentPublicationConflictError);

      const { candidate } = fixture.repository.publishDocumentIfCurrent.mock.calls[0]![0];
      expect(candidate.id).not.toBe(winner.id);
      expect(fixture.discardCandidate).toHaveBeenCalledExactlyOnceWith(candidate.id);
      expect([...fixture.retainedCandidates.keys()]).toEqual([winner.id]);
      expect(fixture.retainedCandidates.get(winner.id)).toBe(fixture.pdf);
      expect(fixture.storage.readVerifiedDocument).toHaveBeenCalledExactlyOnceWith(winner);
      expect(fixture.repository.findCurrentDocumentForRevision).toHaveBeenCalledTimes(state === 'corrupt' ? 0 : 1);
      expect(fixture.repository.publishDocumentIfCurrent).toHaveBeenCalledOnce();
      expect(fixture.renderApprovedInvoicePdf).toHaveBeenCalledOnce();
      expect(fixture.reader.getCurrentRevision).not.toHaveBeenCalled();
    },
  );

  it('returns one verified winner to competing writers and discards only the late loser', async () => {
    const fixture = createPdfGeneratorFixture();
    const renderingStarted = createControlledPromise<void>();
    const releaseRendering = createControlledPromise<Uint8Array>();
    fixture.renderApprovedInvoicePdf.mockImplementationOnce(() => {
      renderingStarted.resolve();
      return releaseRendering.promise;
    });
    let winner: RevisionInvoiceDocumentMetadata | undefined;
    fixture.repository.publishDocumentIfCurrent.mockImplementation(async (input) => {
      if (winner !== undefined) return { outcome: 'existing', document: winner };
      winner = publishedDocument(input);
      return { outcome: 'published', document: winner };
    });
    fixture.repository.findCurrentDocumentForRevision.mockImplementation(async () => winner);
    const input = createRevisionInput();

    const late = generateInvoiceRevisionPdfDocument(input, fixture.dependencies);
    let early: RevisionInvoiceDocumentMetadata;
    try {
      await renderingStarted.promise;
      early = await generateInvoiceRevisionPdfDocument(input, fixture.dependencies);
    } finally {
      releaseRendering.resolve(fixture.pdf);
      await late;
    }

    expect(await late).toBe(early);
    expect(winner).toBe(early);
    expect(fixture.repository.publishDocumentIfCurrent).toHaveBeenCalledTimes(2);
    const loser = fixture.repository.publishDocumentIfCurrent.mock.calls[1]![0].candidate;
    expect(loser.id).not.toBe(early.id);
    expect(loser.storagePath).not.toBe(early.storagePath);
    expect(fixture.discardCandidate).toHaveBeenCalledExactlyOnceWith(loser.id);
    expect([...fixture.retainedCandidates.keys()]).toEqual([early.id]);
    expect(fixture.storage.readVerifiedDocument).toHaveBeenCalledExactlyOnceWith(early);
    expect(fixture.repository.findCurrentDocumentForRevision).toHaveBeenCalledExactlyOnceWith(input.key);
  });

  it('cannot replace a newer revision when an older approval PDF finishes late', async () => {
    const oldRevision = createInvoiceRevisionPdfContentFixture();
    const newRevision = {
      ...oldRevision, revisionId: 'synthetic-new-revision', note: 'New approved revision',
    };
    const fixture = createPdfGeneratorFixture(oldRevision);
    const oldInput = createRevisionInput(oldRevision);
    const newInput = createRevisionInput(newRevision);
    const renderingStarted = createControlledPromise<void>();
    const releaseRendering = createControlledPromise<Uint8Array>();
    fixture.reader.getRevision.mockImplementation(async (key) =>
      key.revisionId === oldRevision.revisionId ? oldRevision : newRevision);
    fixture.renderApprovedInvoicePdf.mockImplementationOnce(() => {
      renderingStarted.resolve();
      return releaseRendering.promise;
    });
    let currentRevisionId = oldRevision.revisionId;
    let winner: RevisionInvoiceDocumentMetadata | undefined;
    // Only the port models current eligibility here; SQLite atomicity has separate integration tests.
    fixture.repository.publishDocumentIfCurrent.mockImplementation(async (input) => {
      if (input.key.revisionId !== currentRevisionId) return { outcome: 'conflict' };
      winner = publishedDocument(input);
      return { outcome: 'published', document: winner };
    });

    const late = generateInvoiceRevisionPdfDocument(oldInput, fixture.dependencies);
    const lateOutcome = late.catch((error: unknown) => error);
    let newer: RevisionInvoiceDocumentMetadata;
    try {
      await renderingStarted.promise;
      currentRevisionId = newRevision.revisionId;
      newer = await generateInvoiceRevisionPdfDocument(newInput, fixture.dependencies);
    } finally {
      releaseRendering.resolve(fixture.pdf);
      await lateOutcome;
    }

    expect(await lateOutcome).toBeInstanceOf(InvoiceDocumentPublicationConflictError);
    expect(winner).toBe(newer);
    expect(winner?.binding).toStrictEqual({ kind: 'revision', revisionId: newRevision.revisionId });
    expect(fixture.repository.publishDocumentIfCurrent.mock.calls.map(([input]) => input.key))
      .toStrictEqual([newInput.key, oldInput.key]);
    const loser = fixture.repository.publishDocumentIfCurrent.mock.calls[1]![0].candidate;
    expect(fixture.discardCandidate).toHaveBeenCalledExactlyOnceWith(loser.id);
    expect([...fixture.retainedCandidates.keys()]).toEqual([newer.id]);
    expect(fixture.reader.getRevision.mock.calls).toStrictEqual([[oldInput.key], [newInput.key]]);
    expect(fixture.reader.getCurrentRevision).not.toHaveBeenCalled();
    expect(fixture.renderApprovedInvoicePdf.mock.calls.map(([content]) => content.note))
      .toEqual([oldRevision.note, newRevision.note]);
  });
});
