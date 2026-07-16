import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import {
  CompanyEmailSecretForm,
  readAndClearSecretInput,
} from './CompanyEmailSecretForm.js';
import { uiText } from '../../i18n/fi.js';

describe('CompanyEmailSecretForm', () => {
  it('renders an empty protected password input without returning a secret value', () => {
    const html = renderForm();

    expect(html).toContain('type="password"');
    expect(html).toContain('autoComplete="new-password"');
    expect(html).toContain('maxLength="1024"');
    expect(html).not.toContain('value=');
    expect(html).not.toContain('synthetic-password');
    expect(html).toContain(uiText.companySettings.emailSecretSet);
    expect(html).not.toContain(uiText.companySettings.emailSecretRemove);
  });

  it('shows configured status and controlled change and removal actions', () => {
    const html = renderForm({ configured: true });

    expect(html).toContain(uiText.companySettings.emailSecretConfigured);
    expect(html).toContain(uiText.companySettings.emailSecretChange);
    expect(html).toContain(uiText.companySettings.emailSecretRemove);
    expect(html).not.toContain('responseBody');
    expect(html).not.toContain('stack');
  });

  it('disables secret operations outside the desktop secret runtime', () => {
    const html = renderForm({
      errorMessage: uiText.companySettings.emailSecretDesktopOnly,
      isAvailable: false,
    });

    expect(html).toContain(uiText.companySettings.emailSecretDesktopOnly);
    expect(html).toContain('disabled=""');
  });

  it('clears the password value immediately before an async save can fail', () => {
    const syntheticInput = { value: 'synthetic-password' };

    expect(readAndClearSecretInput(syntheticInput)).toBe('synthetic-password');
    expect(syntheticInput.value).toBe('');
  });
});

function renderForm(
  props: Partial<React.ComponentProps<typeof CompanyEmailSecretForm>> = {},
): string {
  return renderToStaticMarkup(
    <CompanyEmailSecretForm
      configured={false}
      errorMessage={null}
      isAvailable
      isSaving={false}
      onRemove={vi.fn(async () => true)}
      onSave={vi.fn(async () => true)}
      successMessage={null}
      {...props}
    />,
  );
}
