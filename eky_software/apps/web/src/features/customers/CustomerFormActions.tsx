import styles from './CustomerForm.module.css';
import { uiText } from '../../i18n/fi.js';

interface CustomerFormActionsProps {
  isSaving: boolean;
  isSubmitDisabled: boolean;
  mode: 'create' | 'edit';
  onCancel(): void;
}

export function CustomerFormActions({
  isSaving,
  isSubmitDisabled,
  mode,
  onCancel,
}: CustomerFormActionsProps): React.JSX.Element {
  const submitLabel =
    mode === 'create' ? uiText.customers.add : uiText.customers.saveChanges;

  return (
    <div className={styles.actions}>
      <button
        className="ghost-button"
        disabled={isSaving}
        onClick={onCancel}
        type="button"
      >
        {uiText.customers.cancel}
      </button>
      <button disabled={isSubmitDisabled} type="submit">
        {isSaving ? uiText.customers.saving : submitLabel}
      </button>
    </div>
  );
}
