import type {
  CreditInvoiceDraft,
  UpdateCreditInvoiceDraftInput,
} from '@eky/api-client';
import { useEffect, useState } from 'react';

import styles from './CreditInvoiceDraftEditorView.module.css';
import {
  formatApprovedInvoiceCurrency,
  formatApprovedInvoiceDate,
  formatApprovedInvoiceDiscount,
  formatApprovedInvoicePercent,
  formatApprovedInvoiceQuantity,
  formatApprovedInvoiceUnit,
} from '../approved/approvedInvoiceFormatting.js';
import {
  hydrateCreditInvoiceDraftForm,
  type CreditInvoiceDraftForm,
  validateAndMapCreditInvoiceDraftForm,
} from '../form/creditInvoiceDraftForm.js';
import { uiText } from '../../../i18n/fi.js';
import { MessageBanner } from '../../../shared/ui/index.js';

interface CreditInvoiceDraftEditorViewProps {
  draft: CreditInvoiceDraft | null;
  approvalErrorMessage: string | null;
  errorMessage: string | null;
  isApproving: boolean;
  isLoading: boolean;
  isSaving: boolean;
  successMessage: string | null;
  onApprove(
    invoiceDraftId: string,
    input: UpdateCreditInvoiceDraftInput,
  ): void;
  onBack(): void;
  onSave(
    invoiceDraftId: string,
    input: UpdateCreditInvoiceDraftInput,
  ): void;
}

export function CreditInvoiceDraftEditorView({
  draft,
  approvalErrorMessage,
  errorMessage,
  isApproving,
  isLoading,
  isSaving,
  successMessage,
  onApprove,
  onBack,
  onSave,
}: CreditInvoiceDraftEditorViewProps): React.JSX.Element {
  const [form, setForm] = useState<CreditInvoiceDraftForm | null>(() =>
    draft === null ? null : hydrateCreditInvoiceDraftForm(draft),
  );
  const [validationMessage, setValidationMessage] = useState<string | null>(
    null,
  );
  const [isApprovalConfirmationVisible, setIsApprovalConfirmationVisible] =
    useState(false);

  useEffect(() => {
    setForm(draft === null ? null : hydrateCreditInvoiceDraftForm(draft));
    setValidationMessage(null);
    setIsApprovalConfirmationVisible(false);
  }, [draft]);

  if (isLoading) {
    return (
      <section className={`panel ${styles.statePanel}`}>
        <p>{uiText.invoicing.creditDraftLoading}</p>
      </section>
    );
  }

  if (errorMessage !== null) {
    return (
      <section className={`panel ${styles.statePanel}`}>
        <MessageBanner variant="error">{errorMessage}</MessageBanner>
        <button className="ghost-button" onClick={onBack} type="button">
          {uiText.invoicing.backToDrafts}
        </button>
      </section>
    );
  }

  if (draft === null || form === null) {
    return (
      <section className={`panel ${styles.statePanel}`}>
        <p>{uiText.invoicing.creditDraftOpenPrompt}</p>
        <button className="ghost-button" onClick={onBack} type="button">
          {uiText.invoicing.backToDrafts}
        </button>
      </section>
    );
  }

  const activeDraft = draft;
  const activeForm = form;

  function updateForm(
    updater: (current: CreditInvoiceDraftForm) => CreditInvoiceDraftForm,
  ): void {
    setForm((current) => (current === null ? null : updater(current)));
    setValidationMessage(null);
  }

  function submit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();

    const validation = validateAndMapCreditInvoiceDraftForm(activeForm);

    if (validation.input === null) {
      setValidationMessage(uiText.invoicing.creditDraftValidationError);
      return;
    }

    onSave(activeDraft.id, validation.input);
  }

  function requestApproval(): void {
    const validation = validateAndMapCreditInvoiceDraftForm(activeForm);

    if (validation.input === null) {
      setValidationMessage(uiText.invoicing.creditDraftValidationError);
      return;
    }

    setValidationMessage(null);
    setIsApprovalConfirmationVisible(true);
  }

  function confirmApproval(): void {
    const validation = validateAndMapCreditInvoiceDraftForm(activeForm);

    if (validation.input === null) {
      setValidationMessage(uiText.invoicing.creditDraftValidationError);
      setIsApprovalConfirmationVisible(false);
      return;
    }

    onApprove(activeDraft.id, validation.input);
  }

  return (
    <form className={`panel ${styles.editor}`} onSubmit={submit}>
      <header className={styles.header}>
        <div>
          <p className="panel-kicker">{uiText.invoicing.creditDraftKicker}</p>
          <h2>{uiText.invoicing.creditDraftTitle}</h2>
          <p className={styles.help}>
            {uiText.invoicing.creditDraftHelp(
              draft.creditedInvoiceNumber,
              formatApprovedInvoiceDate(draft.creditedInvoiceDate),
            )}
          </p>
        </div>
        <button className="ghost-button" onClick={onBack} type="button">
          {uiText.invoicing.backToDrafts}
        </button>
      </header>

      <dl className={styles.facts} aria-label={uiText.invoicing.creditDraftFacts}>
        <Definition
          label={uiText.invoicing.creditDraftSourceInvoice}
          value={draft.creditedInvoiceNumber}
        />
        <Definition
          label={uiText.invoicing.invoiceDate}
          value={formatApprovedInvoiceDate(draft.invoiceDate)}
        />
        <Definition
          label={uiText.invoicing.customer}
          value={formatParty(draft.customer)}
        />
        <Definition
          label={uiText.invoicing.billingRecipient}
          value={formatParty(draft.billingRecipient)}
        />
        <Definition
          label={uiText.invoicing.priceInputMode}
          value={
            draft.priceInputMode === 'net'
              ? uiText.invoicing.priceInputNet
              : uiText.invoicing.priceInputGross
          }
        />
      </dl>

      <section className={styles.textFields}>
        <label>
          <span>{uiText.invoicing.subject}</span>
          <input
            maxLength={500}
            onChange={(event) =>
              updateForm((current) => ({
                ...current,
                subject: event.currentTarget.value,
              }))
            }
            type="text"
            value={form.subject}
          />
        </label>
        <label>
          <span>{uiText.invoicing.note}</span>
          <textarea
            maxLength={5_000}
            onChange={(event) =>
              updateForm((current) => ({
                ...current,
                note: event.currentTarget.value,
              }))
            }
            rows={3}
            value={form.note}
          />
        </label>
      </section>

      <section className={styles.linesSection}>
        <div className={styles.sectionHeader}>
          <div>
            <h3>{uiText.invoicing.creditDraftLines}</h3>
            <p>{uiText.invoicing.creditDraftLinesHelp}</p>
          </div>
        </div>
        <div className={styles.lines}>
          {draft.lines.map((line, index) => {
            const lineForm = form.lines[index];

            if (lineForm === undefined) {
              return null;
            }

            return (
              <fieldset className={styles.line} key={line.sourceInvoiceLineId}>
                <legend>
                  {uiText.invoicing.row} {index + 1}
                </legend>
                <label className={styles.include}>
                  <input
                    checked={lineForm.isIncluded}
                    onChange={(event) =>
                      updateForm((current) => ({
                        ...current,
                        lines: current.lines.map((item, itemIndex) =>
                          itemIndex === index
                            ? {
                                ...item,
                                isIncluded: event.currentTarget.checked,
                                quantity:
                                  event.currentTarget.checked &&
                                  item.quantity === '0,00'
                                    ? formatMaximumQuantity(
                                        item.maximumQuantityHundredths,
                                      )
                                    : item.quantity,
                              }
                            : item,
                        ),
                      }))
                    }
                    type="checkbox"
                  />
                  <span>{uiText.invoicing.creditDraftIncludeLine}</span>
                </label>
                <label className={styles.description}>
                  <span>{uiText.invoicing.rowDescription}</span>
                  <input
                    disabled={!lineForm.isIncluded}
                    maxLength={5_000}
                    onChange={(event) =>
                      updateForm((current) => ({
                        ...current,
                        lines: current.lines.map((item, itemIndex) =>
                          itemIndex === index
                            ? {
                                ...item,
                                description: event.currentTarget.value,
                              }
                            : item,
                        ),
                      }))
                    }
                    type="text"
                    value={lineForm.description}
                  />
                </label>
                <label>
                  <span>{uiText.invoicing.creditDraftQuantity}</span>
                  <input
                    disabled={!lineForm.isIncluded}
                    inputMode="decimal"
                    onChange={(event) =>
                      updateForm((current) => ({
                        ...current,
                        lines: current.lines.map((item, itemIndex) =>
                          itemIndex === index
                            ? { ...item, quantity: event.currentTarget.value }
                            : item,
                        ),
                      }))
                    }
                    type="text"
                    value={lineForm.quantity}
                  />
                  <small>
                    {uiText.invoicing.creditDraftMaximumQuantity(
                      formatApprovedInvoiceQuantity(
                        line.maximumQuantityHundredths,
                      ),
                      formatApprovedInvoiceUnit(line.unit),
                    )}
                  </small>
                </label>
                <ReadonlyValue
                  label={uiText.invoicing.rowUnit}
                  value={formatApprovedInvoiceUnit(line.unit)}
                />
                <ReadonlyValue
                  label={uiText.invoicing.rowUnitPrice}
                  value={formatApprovedInvoiceCurrency(line.unitPriceCents)}
                />
                <ReadonlyValue
                  label={uiText.invoicing.rowVat}
                  value={formatApprovedInvoicePercent(
                    line.vatRateBasisPoints,
                  )}
                />
                <ReadonlyValue
                  label={uiText.invoicing.rowDiscountType}
                  value={
                    formatApprovedInvoiceDiscount(line.discount) ??
                    uiText.invoicing.discountNone
                  }
                />
                <ReadonlyValue
                  label={uiText.invoicing.creditDraftSavedLineTotal}
                  value={formatCreditCurrency(line.grossCents)}
                />
              </fieldset>
            );
          })}
        </div>
      </section>

      <section className={styles.totals}>
        <div>
          <p>{uiText.invoicing.creditDraftTotalsHelp}</p>
        </div>
        <dl>
          <Definition
            label={uiText.invoicing.netTotal}
            value={formatCreditCurrency(draft.totals.netTotalCents)}
          />
          <Definition
            label={uiText.invoicing.vatTotal}
            value={formatCreditCurrency(draft.totals.vatTotalCents)}
          />
          <Definition
            label={uiText.invoicing.total}
            value={formatCreditCurrency(draft.totals.grossTotalCents)}
          />
        </dl>
      </section>

      {validationMessage !== null ? (
        <MessageBanner variant="error">{validationMessage}</MessageBanner>
      ) : null}
      {successMessage !== null ? (
        <MessageBanner variant="success">{successMessage}</MessageBanner>
      ) : null}
      {approvalErrorMessage !== null ? (
        <MessageBanner variant="error">{approvalErrorMessage}</MessageBanner>
      ) : null}

      {isApprovalConfirmationVisible ? (
        <section
          aria-labelledby="credit-invoice-approval-heading"
          className={`message ${styles.confirmation}`}
        >
          <div>
            <h3 id="credit-invoice-approval-heading">
              {uiText.invoicing.creditDraftApprovalTitle}
            </h3>
            <p>{uiText.invoicing.creditDraftApprovalHelp}</p>
          </div>
          <div className={styles.confirmationActions}>
            <button
              className="ghost-button"
              disabled={isApproving}
              onClick={() => setIsApprovalConfirmationVisible(false)}
              type="button"
            >
              {uiText.invoicing.cancel}
            </button>
            <button
              disabled={isApproving || isSaving}
              onClick={confirmApproval}
              type="button"
            >
              {isApproving
                ? uiText.invoicing.creditDraftApproving
                : uiText.invoicing.creditDraftApprovalConfirm}
            </button>
          </div>
        </section>
      ) : null}

      <footer className={styles.footer}>
        <button className="ghost-button" onClick={onBack} type="button">
          {uiText.invoicing.backToDrafts}
        </button>
        <button className="primary-action" disabled={isSaving} type="submit">
          {isSaving
            ? uiText.invoicing.creditDraftSaving
            : uiText.invoicing.creditDraftSave}
        </button>
        <button
          disabled={isApproving || isSaving}
          onClick={requestApproval}
          type="button"
        >
          {uiText.invoicing.creditDraftApprove}
        </button>
      </footer>
    </form>
  );
}

function Definition({
  label,
  value,
}: {
  label: string;
  value: string;
}): React.JSX.Element {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function ReadonlyValue({
  label,
  value,
}: {
  label: string;
  value: string;
}): React.JSX.Element {
  return (
    <div aria-readonly="true" className={styles.readonlyValue}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function formatParty(party: CreditInvoiceDraft['customer']): string {
  return party.customerNumber.trim() === ''
    ? party.name
    : `${party.customerNumber} – ${party.name}`;
}

function formatCreditCurrency(cents: number): string {
  return formatApprovedInvoiceCurrency(cents === 0 ? 0 : -cents);
}

function formatMaximumQuantity(quantityHundredths: number): string {
  return formatApprovedInvoiceQuantity(quantityHundredths);
}
