import type {
  CreditInvoiceDraft,
  UpdateCreditInvoiceDraftInput,
} from '@eky/api-client';
import { useEffect, useState } from 'react';

import styles from './CreditInvoiceDraftEditorView.module.css';
import {
  formatApprovedInvoiceCurrency,
  formatApprovedInvoiceDate,
} from '../approved/approvedInvoiceFormatting.js';
import {
  createManualCreditLineForm,
  hydrateCreditInvoiceDraftForm,
  type CreditInvoiceDraftForm,
  validateAndMapCreditInvoiceDraftForm,
} from '../form/creditInvoiceDraftForm.js';
import { uiText } from '../../../i18n/fi.js';
import { MessageBanner } from '../../../shared/ui/index.js';
import {
  CreditInvoiceDraftLineEditor,
  CreditInvoiceUnitOptions,
} from './CreditInvoiceDraftLineEditor.js';

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
            onChange={(event) => {
              const subject = event.currentTarget.value;
              updateForm((current) => ({
                ...current,
                subject,
              }));
            }}
            type="text"
            value={form.subject}
          />
        </label>
        <label>
          <span>{uiText.invoicing.note}</span>
          <textarea
            maxLength={5_000}
            onChange={(event) => {
              const note = event.currentTarget.value;
              updateForm((current) => ({
                ...current,
                note,
              }));
            }}
            rows={3}
            value={form.note}
          />
        </label>
        <label>
          <span>{uiText.invoicing.creditDraftRefundIban}</span>
          <input
            autoComplete="off"
            inputMode="text"
            maxLength={42}
            onChange={(event) => {
              const refundIban = event.currentTarget.value;
              updateForm((current) => ({
                ...current,
                refundIban,
              }));
            }}
            placeholder={uiText.invoicing.creditDraftRefundIbanPlaceholder}
            type="text"
            value={form.refundIban}
          />
          <small>{uiText.invoicing.creditDraftRefundIbanHelp}</small>
        </label>
      </section>

      <section className={styles.linesSection}>
        <div className={styles.sectionHeader}>
          <div>
            <h3>{uiText.invoicing.creditDraftLines}</h3>
            <p>{uiText.invoicing.creditDraftLinesHelp}</p>
          </div>
          <button
            className="ghost-button"
            onClick={() =>
              updateForm((current) => ({
                ...current,
                lines: [
                  ...current.lines,
                  createManualCreditLineForm(current),
                ],
              }))
            }
            type="button"
          >
            {uiText.invoicing.creditDraftAddManualLine}
          </button>
        </div>
        <CreditInvoiceUnitOptions />
        <div className={styles.lines}>
          {form.lines.map((line, index) => (
            <CreditInvoiceDraftLineEditor
              availableVatRates={form.availableVatRates}
              index={index}
              key={line.key}
              line={line}
              onChange={(nextLine) =>
                updateForm((current) => ({
                  ...current,
                  lines: current.lines.map((item) =>
                    item.key === nextLine.key ? nextLine : item,
                  ),
                }))
              }
              onRemove={() =>
                updateForm((current) => ({
                  ...current,
                  lines: current.lines.filter(
                    (item) => item.key !== line.key,
                  ),
                }))
              }
            />
          ))}
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

function formatParty(party: CreditInvoiceDraft['customer']): string {
  return party.customerNumber.trim() === ''
    ? party.name
    : `${party.customerNumber} – ${party.name}`;
}

function formatCreditCurrency(cents: number): string {
  return formatApprovedInvoiceCurrency(cents === 0 ? 0 : -cents);
}
