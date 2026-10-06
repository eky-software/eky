import { useEffect, useRef, useState } from 'react';

import type { OpenInvoiceDeliveryEventPdf } from '../approved/openInvoiceDeliveryEventPdf.js';
import { uiText } from '../../../i18n/fi.js';

interface InvoiceDeliveryPdfActionProps {
  invoiceId: string;
  eventId: string;
  onOpen: OpenInvoiceDeliveryEventPdf;
}

export function InvoiceDeliveryPdfAction({
  invoiceId, eventId, onOpen,
}: InvoiceDeliveryPdfActionProps): React.JSX.Element {
  const mounted = useRef(true);
  const pending = useRef(false);
  const [isOpening, setIsOpening] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  async function open(): Promise<void> {
    if (pending.current) return;
    pending.current = true;
    setIsOpening(true);
    setFailed(false);
    let opened = false;
    try { opened = await onOpen(invoiceId, eventId); }
    catch { /* Never display raw native or HTTP details. */ }
    finally {
      pending.current = false;
      if (mounted.current) {
        setIsOpening(false);
        setFailed(!opened);
      }
    }
  }

  return (
    <>
      <button
        aria-busy={isOpening}
        className="ghost-button"
        disabled={isOpening}
        onClick={() => void open()}
        type="button"
      >
        {isOpening
          ? uiText.invoicing.invoiceEmailAttachmentOpening
          : uiText.invoicing.invoiceDeliveryPdfOpen}
      </button>
      {failed ? (
        <p className="message error-message" role="alert">
          {uiText.invoicing.invoiceDeliveryPdfOpenError}
        </p>
      ) : null}
    </>
  );
}
