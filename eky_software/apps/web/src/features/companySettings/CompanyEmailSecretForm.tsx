import { useEffect, useRef } from 'react';

import styles from './CompanyEmailSecretForm.module.css';
import { uiText } from '../../i18n/fi.js';

interface CompanyEmailSecretFormProps {
  configured: boolean;
  errorMessage: string | null;
  isAvailable: boolean;
  isSaving: boolean;
  onRemove(): Promise<boolean>;
  onSave(secret: string): Promise<boolean>;
  successMessage: string | null;
}

export function CompanyEmailSecretForm({
  configured,
  errorMessage,
  isAvailable,
  isSaving,
  onRemove,
  onSave,
  successMessage,
}: CompanyEmailSecretFormProps): React.JSX.Element {
  const secretInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    return () => {
      clearSecretInput(secretInputRef.current);
    };
  }, []);

  return (
    <section className={`panel ${styles.panel}`}>
      <div className="panel-header">
        <div>
          <p className="panel-kicker">{uiText.companySettings.emailSecretKicker}</p>
          <h2>{uiText.companySettings.emailSecretHeading}</h2>
        </div>
      </div>

      <p className="panel-description">
        {uiText.companySettings.emailSecretDescription}
      </p>
      {errorMessage ? (
        <p className={`message ${isAvailable ? 'error-message' : ''}`}>
          {errorMessage}
        </p>
      ) : null}
      {successMessage ? (
        <p className="message success-message">{successMessage}</p>
      ) : null}

      <div className={styles.statusRow}>
        <span className={styles.statusLabel}>
          {uiText.companySettings.emailSecretStatus}
        </span>
        <span className={configured ? styles.configured : styles.notConfigured}>
          {configured
            ? uiText.companySettings.emailSecretConfigured
            : uiText.companySettings.emailSecretNotConfigured}
        </span>
      </div>

      <form
        className={styles.form}
        onSubmit={(event) => {
          event.preventDefault();
          const secret = readAndClearSecretInput(secretInputRef.current);

          void onSave(secret);
        }}
      >
        <label htmlFor="company-email-secret">
          {configured
            ? uiText.companySettings.emailSecretNewPassword
            : uiText.companySettings.emailSecretPassword}
          <input
            autoComplete="new-password"
            disabled={!isAvailable || isSaving}
            id="company-email-secret"
            maxLength={1024}
            ref={secretInputRef}
            spellCheck={false}
            type="password"
          />
        </label>
        <p className={styles.help}>{uiText.companySettings.emailSecretHelp}</p>

        <div className={styles.actions}>
          {configured ? (
            <button
              className="secondary-button"
              disabled={!isAvailable || isSaving}
              onClick={() => {
                clearSecretInput(secretInputRef.current);
                void onRemove();
              }}
              type="button"
            >
              {uiText.companySettings.emailSecretRemove}
            </button>
          ) : null}
          <button
            className="primary-button"
            disabled={!isAvailable || isSaving}
            type="submit"
          >
            {isSaving
              ? uiText.companySettings.emailSecretSaving
              : configured
                ? uiText.companySettings.emailSecretChange
                : uiText.companySettings.emailSecretSet}
          </button>
        </div>
      </form>
    </section>
  );
}

export function readAndClearSecretInput(
  input: Pick<HTMLInputElement, 'value'> | null,
): string {
  const secret = input?.value ?? '';
  clearSecretInput(input);

  return secret;
}

function clearSecretInput(
  input: Pick<HTMLInputElement, 'value'> | null,
): void {
  if (input !== null) {
    input.value = '';
  }
}
