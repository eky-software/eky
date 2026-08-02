import type {
  InvoiceNumberingSeriesActivationPreviewView,
  InvoiceNumberingSeriesOverviewView,
} from '@eky/api-client';

import {
  invoiceNumberingModeOptions,
  monthOptions,
} from './invoiceNumberingSettingsFormModel.js';
import {
  invoiceNumberingSeriesReasonCodeOptions,
  type InvoiceNumberingSeriesTransitionForm as TransitionForm,
  type InvoiceNumberingSeriesTransitionValidationErrors,
} from './invoiceNumberingSeriesTransitionFormModel.js';
import styles from './InvoiceNumberingSeriesTransitionForm.module.css';
import { uiText } from '../../i18n/fi.js';

interface InvoiceNumberingSeriesTransitionFormProps {
  activationErrorMessage: string | null;
  form: TransitionForm;
  isActivating: boolean;
  isPreviewLoading: boolean;
  onActivate(): void;
  onCancel(): void;
  onContinue(): void;
  onFieldChange(fieldName: keyof TransitionForm, value: string): void;
  onPreview(): void;
  overview: InvoiceNumberingSeriesOverviewView;
  preview: InvoiceNumberingSeriesActivationPreviewView | null;
  previewErrorMessage: string | null;
  step: 'configure' | 'confirm';
  validationErrors: InvoiceNumberingSeriesTransitionValidationErrors;
}

export function InvoiceNumberingSeriesTransitionForm({
  activationErrorMessage,
  form,
  isActivating,
  isPreviewLoading,
  onActivate,
  onCancel,
  onContinue,
  onFieldChange,
  onPreview,
  overview,
  preview,
  previewErrorMessage,
  step,
  validationErrors,
}: InvoiceNumberingSeriesTransitionFormProps): React.JSX.Element {
  const canActivate =
    form.confirmation === overview.activationConfirmationText &&
    !isActivating;

  if (step === 'confirm') {
    return (
      <form
        className={styles.transition}
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          onActivate();
        }}
      >
        <h3>{uiText.companySettings.invoiceNumberingSeriesConfirmHeading}</h3>
        <p className={styles.dangerText}>
          {uiText.companySettings.invoiceNumberingSeriesIrreversibleWarning}
        </p>
        <div className={styles.comparison}>
          <SeriesSummary
            heading={uiText.companySettings.invoiceNumberingSeriesCurrent}
            series={overview.activeSeries}
          />
          <SeriesSummary
            heading={uiText.companySettings.invoiceNumberingSeriesNew}
            series={{
              mode: form.mode,
              fiscalYearStartMonth: Number(form.fiscalYearStartMonth),
              sequencePadding: Number(form.sequencePadding),
              firstSequenceNumber: Number(form.firstSequenceNumber),
            }}
          />
        </div>
        <label htmlFor="invoice-numbering-series-confirmation">
          {uiText.companySettings.invoiceNumberingSeriesConfirmationLabel}
          <strong className={styles.confirmationText}>
            {overview.activationConfirmationText}
          </strong>
          <input
            autoComplete="off"
            id="invoice-numbering-series-confirmation"
            onChange={(event) =>
              onFieldChange('confirmation', event.target.value)
            }
            value={form.confirmation}
          />
        </label>
        {activationErrorMessage ? (
          <p className="message error-message">{activationErrorMessage}</p>
        ) : null}
        <div className={styles.actions}>
          <button
            autoFocus
            className="button-secondary"
            disabled={isActivating}
            onClick={onCancel}
            type="button"
          >
            {uiText.companySettings.invoiceNumberingSeriesCancel}
          </button>
          <button disabled={!canActivate} type="submit">
            {isActivating
              ? uiText.companySettings.invoiceNumberingSeriesActivating
              : uiText.companySettings.invoiceNumberingSeriesActivate}
          </button>
        </div>
      </form>
    );
  }

  return (
    <form
      className={styles.transition}
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        onContinue();
      }}
    >
      <h3>{uiText.companySettings.invoiceNumberingSeriesConfigureHeading}</h3>
      <div className={styles.grid}>
        <label htmlFor="invoice-numbering-series-mode">
          {uiText.companySettings.invoiceNumberingMode}
          <select
            id="invoice-numbering-series-mode"
            onChange={(event) => onFieldChange('mode', event.target.value)}
            value={form.mode}
          >
            {invoiceNumberingModeOptions.map((mode) => (
              <option key={mode} value={mode}>
                {uiText.companySettings.invoiceNumberingModes[mode]}
              </option>
            ))}
          </select>
          <FieldError message={validationErrors.mode} />
        </label>
        <label htmlFor="invoice-numbering-series-fiscal-month">
          {uiText.companySettings.invoiceNumberingFiscalYearStartMonth}
          <select
            id="invoice-numbering-series-fiscal-month"
            onChange={(event) =>
              onFieldChange('fiscalYearStartMonth', event.target.value)
            }
            value={form.fiscalYearStartMonth}
          >
            {monthOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {uiText.companySettings.invoiceNumberingMonths[option.labelKey]}
              </option>
            ))}
          </select>
          <FieldError message={validationErrors.fiscalYearStartMonth} />
        </label>
        <label htmlFor="invoice-numbering-series-padding">
          {uiText.companySettings.invoiceNumberingSequencePadding}
          <input
            id="invoice-numbering-series-padding"
            inputMode="numeric"
            onChange={(event) =>
              onFieldChange('sequencePadding', event.target.value)
            }
            value={form.sequencePadding}
          />
          <FieldError message={validationErrors.sequencePadding} />
        </label>
        <label htmlFor="invoice-numbering-series-preview-date">
          {uiText.companySettings.invoiceNumberingSeriesPreviewDate}
          <input
            id="invoice-numbering-series-preview-date"
            readOnly
            type="date"
            value={form.previewDate}
          />
        </label>
      </div>
      <p className={styles.previewWarning}>
        {uiText.companySettings.invoiceNumberingSeriesPreviewWarning}
      </p>
      <div className={styles.previewActions}>
        <button
          className="button-secondary"
          disabled={isPreviewLoading}
          onClick={onPreview}
          type="button"
        >
          {isPreviewLoading
            ? uiText.companySettings.invoiceNumberingSeriesPreviewLoading
            : uiText.companySettings.invoiceNumberingSeriesPreviewAction}
        </button>
      </div>
      {previewErrorMessage ? (
        <p className="message error-message">{previewErrorMessage}</p>
      ) : null}
      {preview ? (
        preview.capacity === 'available' ? (
          <div className={styles.previewResult}>
            <p>
              <strong>
                {uiText.companySettings.invoiceNumberingSeriesMinimum}
              </strong>{' '}
              {preview.minimumFirstSequenceNumber}
            </p>
            <p>
              <strong>
                {uiText.companySettings.invoiceNumberingSeriesNumberPreview}
              </strong>{' '}
              {preview.previewInvoiceNumber}
            </p>
          </div>
        ) : (
          <p className="message error-message">
            {uiText.companySettings.invoiceNumberingSeriesExhausted}
          </p>
        )
      ) : null}
      <div className={styles.grid}>
        <label htmlFor="invoice-numbering-series-first-number">
          {uiText.companySettings.invoiceNumberingSeriesChosenFirstNumber}
          <input
            disabled={!preview || preview.capacity !== 'available'}
            id="invoice-numbering-series-first-number"
            inputMode="numeric"
            onChange={(event) =>
              onFieldChange('firstSequenceNumber', event.target.value)
            }
            value={form.firstSequenceNumber}
          />
          <FieldError message={validationErrors.firstSequenceNumber} />
        </label>
        <label htmlFor="invoice-numbering-series-reason">
          {uiText.companySettings.invoiceNumberingSeriesReason}
          <select
            id="invoice-numbering-series-reason"
            onChange={(event) =>
              onFieldChange('reasonCode', event.target.value)
            }
            value={form.reasonCode}
          >
            {invoiceNumberingSeriesReasonCodeOptions.map((reasonCode) => (
              <option key={reasonCode} value={reasonCode}>
                {
                  uiText.companySettings.invoiceNumberingSeriesReasons[
                    reasonCode
                  ]
                }
              </option>
            ))}
          </select>
        </label>
      </div>
      <label htmlFor="invoice-numbering-series-reason-note">
        {uiText.companySettings.invoiceNumberingSeriesReasonNote}
        <textarea
          id="invoice-numbering-series-reason-note"
          maxLength={500}
          onChange={(event) =>
            onFieldChange('reasonNote', event.target.value)
          }
          rows={3}
          value={form.reasonNote}
        />
        <FieldError message={validationErrors.reasonNote} />
      </label>
      <div className={styles.actions}>
        <button className="button-secondary" onClick={onCancel} type="button">
          {uiText.companySettings.invoiceNumberingSeriesCancel}
        </button>
        <button
          disabled={!preview || preview.capacity !== 'available'}
          type="submit"
        >
          {uiText.companySettings.invoiceNumberingSeriesContinue}
        </button>
      </div>
    </form>
  );
}

function SeriesSummary({
  heading,
  series,
}: {
  heading: string;
  series: {
    firstSequenceNumber: number;
    fiscalYearStartMonth: number;
    mode: keyof typeof uiText.companySettings.invoiceNumberingModes;
    sequencePadding: number;
  };
}): React.JSX.Element {
  return (
    <section>
      <h4>{heading}</h4>
      <dl>
        <div>
          <dt>{uiText.companySettings.invoiceNumberingMode}</dt>
          <dd>{uiText.companySettings.invoiceNumberingModes[series.mode]}</dd>
        </div>
        <div>
          <dt>{uiText.companySettings.invoiceNumberingFiscalYearStartMonth}</dt>
          <dd>{series.fiscalYearStartMonth}</dd>
        </div>
        <div>
          <dt>{uiText.companySettings.invoiceNumberingSequencePadding}</dt>
          <dd>{series.sequencePadding}</dd>
        </div>
        <div>
          <dt>{uiText.companySettings.invoiceNumberingFirstSequenceNumber}</dt>
          <dd>{series.firstSequenceNumber}</dd>
        </div>
      </dl>
    </section>
  );
}

function FieldError({
  message,
}: {
  message: string | undefined;
}): React.JSX.Element | null {
  return message ? <span className={styles.fieldError}>{message}</span> : null;
}
