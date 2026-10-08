import { vi } from 'vitest';

import type { InvoiceEmailDeliveryDocument } from './loadInvoiceEmailDeliveryDocument.js';
import type { RevisionInvoiceDocumentMetadata } from '../domain/approvedInvoiceDocument.js';
import type { InvoiceDeliveryReservation } from '../domain/invoiceDeliveryReservation.js';
import type { InvoiceDeliveryEventRepository } from '../ports/invoiceDeliveryEventRepository.js';

// Records application port calls only; this is not a persistence/transaction fake.
export class FakeInvoiceDeliveryEventRepository
  implements InvoiceDeliveryEventRepository
{
  invoiceStatusAtReservation: 'approved' | 'sent' = 'approved';
  reservations: InvoiceDeliveryReservation[] = [];

  reserveEmailDelivery = vi.fn<InvoiceDeliveryEventRepository['reserveEmailDelivery']>(
    async (input) => {
      const reservation: InvoiceDeliveryReservation = input.mode === 'customer'
        ? Object.freeze({
            eventId: input.eventId,
            mode: 'customer',
            target: Object.freeze({ ...input.target }),
          })
        : Object.freeze({
            eventId: input.eventId,
            mode: 'smtpTest',
            target: Object.freeze({ ...input.target }),
          });
      this.reservations.push(reservation);

      return {
        outcome: 'reserved',
        reservation,
        invoiceStatusAtReservation: this.invoiceStatusAtReservation,
      };
    },
  );

  completeDeliveryEvent = vi.fn<InvoiceDeliveryEventRepository['completeDeliveryEvent']>(
    async () => ({ outcome: 'completed' }),
  );

  saveDeliveryEvent = vi.fn<InvoiceDeliveryEventRepository['saveDeliveryEvent']>(
    async () => {
      throw new Error('SMTP must reserve delivery instead of using saveDeliveryEvent.');
    },
  );
}

export function createInvoiceEmailDeliveryDocument(
  metadata: RevisionInvoiceDocumentMetadata,
  content: Uint8Array,
): InvoiceEmailDeliveryDocument {
  return {
    content,
    metadata,
    target: {
      companyId: metadata.companyId,
      invoiceId: metadata.invoiceId,
      documentId: metadata.id,
      ...metadata.binding,
      sha256: metadata.sha256,
      sizeBytes: metadata.sizeBytes,
    },
  };
}
