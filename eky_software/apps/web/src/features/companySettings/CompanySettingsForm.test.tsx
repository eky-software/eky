import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { CompanySettingsForm } from './CompanySettingsForm.js';
import { initialCompanySettingsForm } from './companySettingsFormModel.js';
import { uiText } from '../../i18n/fi.js';

describe('CompanySettingsForm', () => {
  it('renders company VAT number and bank detail fields', () => {
    const html = renderToStaticMarkup(
      <CompanySettingsForm
        errorMessage={null}
        form={{
          ...initialCompanySettingsForm,
          vatNumber: 'FI12345678',
          iban: 'FI2112345600000785',
          bic: 'NDEAFIHH',
          bankName: 'Test Bank',
          website: 'www.example.fi',
        }}
        isSaving={false}
        onFieldChange={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );

    expect(html).toContain(uiText.companySettings.bankDetails);
    expect(html).toContain(uiText.companySettings.vatNumber);
    expect(html).toContain('FI12345678');
    expect(html).toContain(uiText.companySettings.bankDetailsHelp);
    expect(html).toContain(uiText.companySettings.website);
    expect(html).toContain('www.example.fi');
    expect(html).toContain(uiText.companySettings.iban);
    expect(html).toContain('FI2112345600000785');
    expect(html).toContain(uiText.companySettings.bic);
    expect(html).toContain('NDEAFIHH');
    expect(html).toContain(uiText.companySettings.bankName);
    expect(html).toContain('Test Bank');
  });
});
