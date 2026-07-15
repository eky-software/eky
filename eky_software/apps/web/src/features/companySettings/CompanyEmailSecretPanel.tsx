import type { EkyApiClient } from '@eky/api-client';

import { CompanyEmailSecretForm } from './CompanyEmailSecretForm.js';
import { useCompanyEmailSecret } from './hooks/useCompanyEmailSecret.js';
import { uiText } from '../../i18n/fi.js';

interface CompanyEmailSecretPanelProps {
  apiClient: Pick<
    EkyApiClient,
    | 'getCompanyEmailSecretStatus'
    | 'removeCompanyEmailSecret'
    | 'setCompanyEmailSecret'
  >;
}

export function CompanyEmailSecretPanel({
  apiClient,
}: CompanyEmailSecretPanelProps): React.JSX.Element {
  const emailSecretState = useCompanyEmailSecret(apiClient);

  if (emailSecretState.isLoading) {
    return <p className="message">{uiText.companySettings.emailSecretLoading}</p>;
  }

  return (
    <CompanyEmailSecretForm
      configured={emailSecretState.configured}
      errorMessage={emailSecretState.errorMessage}
      isAvailable={emailSecretState.isAvailable}
      isSaving={emailSecretState.isSaving}
      onRemove={async () => {
        if (!window.confirm(uiText.companySettings.emailSecretRemoveConfirm)) {
          return false;
        }

        return await emailSecretState.remove();
      }}
      onSave={emailSecretState.save}
      successMessage={emailSecretState.successMessage}
    />
  );
}
