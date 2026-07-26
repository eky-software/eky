import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { InvoicePerformancePeriodSection } from './InvoicePerformancePeriodSection.js';
import { createInitialNewInvoiceForm } from '../form/newInvoiceFormState.js';
import { uiText } from '../../../i18n/fi.js';

describe('InvoicePerformancePeriodSection', () => {
  it('uses invoice date as the compact default selection', () => {
    const html = renderSection();

    expect(html).toContain(`>${uiText.invoicing.performancePeriod}<`);
    expect(html).toContain(
      `<option value="invoiceDate" selected="">${uiText.invoicing.performancePeriodInvoiceDate}</option>`,
    );
    expect(html).not.toContain('name="performanceDate"');
    expect(html).not.toContain('name="performancePeriodStart"');
  });

  it('shows one accessible date field for a single performance date', () => {
    const html = renderSection({
      performanceDate: '2026-07-16',
      performancePeriodType: 'singleDate',
    });

    expect(html).toContain(uiText.invoicing.performanceDate);
    expect(html).toContain('name="performanceDate"');
    expect(html).toContain('value="2026-07-16"');
    expect(html).not.toContain('name="performancePeriodStart"');
  });

  it('shows both accessible date fields and validation errors for a range', () => {
    const html = renderSection(
      {
        performancePeriodEnd: '2026-07-31',
        performancePeriodStart: '2026-07-01',
        performancePeriodType: 'dateRange',
      },
      {
        lines: {},
        performancePeriodEnd: 'Tarkista loppupäivä.',
      },
    );

    expect(html).toContain(uiText.invoicing.performancePeriodStart);
    expect(html).toContain(uiText.invoicing.performancePeriodEnd);
    expect(html).toContain('name="performancePeriodStart"');
    expect(html).toContain('name="performancePeriodEnd"');
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('Tarkista loppupäivä.');
  });
});

type Form = ReturnType<typeof createInitialNewInvoiceForm>;

function renderSection(
  overrides: Partial<Form> = {},
  errors: React.ComponentProps<
    typeof InvoicePerformancePeriodSection
  >['errors'] = undefined,
): string {
  return renderToStaticMarkup(
    <InvoicePerformancePeriodSection
      errors={errors}
      form={{
        ...createInitialNewInvoiceForm(new Date(2026, 6, 16)),
        ...overrides,
      }}
      onFieldChange={vi.fn()}
    />,
  );
}
