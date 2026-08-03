import type { EkyApiClient } from '@eky/api-client';
import { useEffect, useState } from 'react';

import { InvoiceNumberingSeriesTransitionForm } from './InvoiceNumberingSeriesTransitionForm.js';
import styles from './InvoiceNumberingSeriesTransitionForm.module.css';
import {
  createInvoiceNumberingSeriesTransitionForm,
  hasInvoiceNumberingSeriesTransitionValidationErrors,
  toActivateInvoiceNumberingSeriesRequest,
  toInvoiceNumberingSeriesActivationPreviewQuery,
  validateInvoiceNumberingSeriesTransitionForm,
  type InvoiceNumberingSeriesTransitionForm as TransitionForm,
  type InvoiceNumberingSeriesTransitionValidationErrors,
} from './invoiceNumberingSeriesTransitionFormModel.js';
import { useInvoiceNumberingSeriesTransition } from './hooks/useInvoiceNumberingSeriesTransition.js';
import { uiText } from '../../i18n/fi.js';

type TransitionClient = Pick<
  EkyApiClient,
  | 'activateInvoiceNumberingSeries'
  | 'getInvoiceNumberingSeriesOverview'
  | 'previewInvoiceNumberingSeriesActivation'
>;

export function InvoiceNumberingSeriesTransitionPanel({
  apiClient,
}: {
  apiClient: TransitionClient;
}): React.JSX.Element {
  const state = useInvoiceNumberingSeriesTransition(apiClient);
  const [form, setForm] = useState<TransitionForm | null>(null);
  const [preview, setPreview] =
    useState<Awaited<ReturnType<typeof state.preview>>>(null);
  const [step, setStep] = useState<'configure' | 'confirm'>('configure');
  const [validationErrors, setValidationErrors] =
    useState<InvoiceNumberingSeriesTransitionValidationErrors>({});

  useEffect(() => {
    if (state.overview && form === null) {
      setForm(
        createInvoiceNumberingSeriesTransitionForm(
          state.overview,
          new Date().toISOString().slice(0, 10),
        ),
      );
    }
  }, [form, state.overview]);

  function resetTransition(): void {
    if (!state.overview) {
      return;
    }

    setForm(
      createInvoiceNumberingSeriesTransitionForm(
        state.overview,
        new Date().toISOString().slice(0, 10),
      ),
    );
    setPreview(null);
    setStep('configure');
    setValidationErrors({});
  }

  function handleFieldChange(
    fieldName: keyof TransitionForm,
    value: string,
  ): void {
    setForm((current) =>
      current
        ? {
            ...current,
            [fieldName]: value,
          }
        : current,
    );
    setValidationErrors((current) => ({
      ...current,
      [fieldName]: undefined,
    }));

    if (
      fieldName === 'mode' ||
      fieldName === 'fiscalYearStartMonth' ||
      fieldName === 'sequencePadding'
    ) {
      setPreview(null);
    }
  }

  async function handlePreview(): Promise<void> {
    if (!form) {
      return;
    }

    const result = await state.preview(
      toInvoiceNumberingSeriesActivationPreviewQuery(form),
    );

    setPreview(result);
    if (result?.minimumFirstSequenceNumber !== null && result !== null) {
      setForm((current) =>
        current
          ? {
              ...current,
              firstSequenceNumber: String(result.minimumFirstSequenceNumber),
            }
          : current,
      );
    }
  }

  function handleContinue(): void {
    if (!form || !preview || preview.capacity !== 'available') {
      return;
    }

    const errors = validateInvoiceNumberingSeriesTransitionForm(
      form,
      preview.minimumFirstSequenceNumber,
      uiText.companySettings.invoiceNumberingSeriesValidation,
    );
    setValidationErrors(errors);

    if (!hasInvoiceNumberingSeriesTransitionValidationErrors(errors)) {
      setStep('confirm');
    }
  }

  async function handleActivate(): Promise<void> {
    if (!form || !state.overview) {
      return;
    }

    const activated = await state.activate(
      toActivateInvoiceNumberingSeriesRequest(form, state.overview.revision),
    );

    if (activated) {
      setForm(
        createInvoiceNumberingSeriesTransitionForm(
          activated,
          new Date().toISOString().slice(0, 10),
        ),
      );
      setPreview(null);
      setStep('configure');
    }
  }

  if (state.isLoading) {
    return (
      <p className="message">
        {uiText.companySettings.invoiceNumberingSeriesLoading}
      </p>
    );
  }

  if (state.errorMessage || !state.overview || !form) {
    return (
      <p className="message error-message">
        {state.errorMessage ??
          uiText.companySettings.invoiceNumberingSeriesLoadError}
      </p>
    );
  }

  return (
    <section className={`panel ${styles.panel}`}>
      <div className="panel-header">
        <div>
          <p className="panel-kicker">
            {uiText.companySettings.invoiceNumberingKicker}
          </p>
          <h2>{uiText.companySettings.invoiceNumberingHeading}</h2>
        </div>
      </div>
      <p className="panel-description">
        {uiText.companySettings.invoiceNumberingSeriesDescription}
      </p>
      <SeriesOverview overview={state.overview} />
      {state.successMessage ? (
        <p className="message success-message">{state.successMessage}</p>
      ) : null}
      <InvoiceNumberingSeriesTransitionForm
        activationErrorMessage={state.activationErrorMessage}
        form={form}
        isActivating={state.isActivating}
        isPreviewLoading={state.isPreviewLoading}
        onActivate={() => void handleActivate()}
        onCancel={resetTransition}
        onContinue={handleContinue}
        onFieldChange={handleFieldChange}
        onPreview={() => void handlePreview()}
        overview={state.overview}
        preview={preview}
        previewErrorMessage={state.previewErrorMessage}
        step={step}
        validationErrors={validationErrors}
      />
    </section>
  );
}

function SeriesOverview({
  overview,
}: {
  overview: NonNullable<
    ReturnType<typeof useInvoiceNumberingSeriesTransition>['overview']
  >;
}): React.JSX.Element {
  return (
    <div className={styles.overview}>
      <h3>{uiText.companySettings.invoiceNumberingSeriesActive}</h3>
      <dl className={styles.overviewGrid}>
        <div>
          <dt>{uiText.companySettings.invoiceNumberingMode}</dt>
          <dd>
            {
              uiText.companySettings.invoiceNumberingModes[
                overview.activeSeries.mode
              ]
            }
          </dd>
        </div>
        <div>
          <dt>{uiText.companySettings.invoiceNumberingFirstSequenceNumber}</dt>
          <dd>{overview.activeSeries.firstSequenceNumber}</dd>
        </div>
        <div>
          <dt>{uiText.companySettings.invoiceNumberingSeriesActivatedAt}</dt>
          <dd>{formatTimestamp(overview.activeSeries.activatedAt)}</dd>
        </div>
      </dl>
      {overview.history.length > 0 ? (
        <details>
          <summary>
            {uiText.companySettings.invoiceNumberingSeriesHistory} (
            {overview.history.length})
          </summary>
          <ol className={styles.history}>
            {overview.history.map((entry) => (
              <li key={`${entry.replacedAt}-${entry.previousSeries.createdAt}`}>
                <strong>
                  {
                    uiText.companySettings.invoiceNumberingModes[
                      entry.previousSeries.mode
                    ]
                  }
                </strong>
                <span>
                  {uiText.companySettings.invoiceNumberingSeriesReplacedAt}{' '}
                  {formatTimestamp(entry.replacedAt)}
                </span>
              </li>
            ))}
          </ol>
        </details>
      ) : null}
    </div>
  );
}

function formatTimestamp(value: string): string {
  return new Intl.DateTimeFormat('fi-FI', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(value));
}
