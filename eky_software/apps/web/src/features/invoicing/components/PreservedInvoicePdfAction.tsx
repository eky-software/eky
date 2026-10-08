import { useEffect, useRef, useState } from 'react';

import type { OpenPreservedInvoicePdf } from '../approved/openPreservedInvoicePdf.js';
import { uiText } from '../../../i18n/fi.js';

interface PreservedInvoicePdfActionProps {
  invoiceId: string;
  documentId: string;
  disabled: boolean;
  onOpen: OpenPreservedInvoicePdf;
}

export function PreservedInvoicePdfAction({
  invoiceId, documentId, disabled, onOpen,
}: PreservedInvoicePdfActionProps): React.JSX.Element {
  const mounted = useRef(true);
  const pending = useRef(false);
  const [isOpening, setIsOpening] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  async function open(): Promise<void> {
    if (pending.current || disabled) return;
    pending.current = true;
    setIsOpening(true);
    setFailed(false);
    let opened = false;
    try {
      opened = await onOpen(invoiceId, documentId);
    } catch {
      // Only the fixed UI message is displayed, never native or API details.
    } finally {
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
        disabled={disabled || isOpening}
        onClick={() => void open()}
        type="button"
      >
        {isOpening
          ? uiText.invoicing.invoiceEmailAttachmentOpening
          : uiText.invoicing.invoiceEmailPreservedAttachmentOpen}
      </button>
      {failed ? (
        <p className="message error-message" role="alert">
          {uiText.invoicing.invoiceEmailAttachmentOpenError}
        </p>
      ) : null}
    </>
  );
}
