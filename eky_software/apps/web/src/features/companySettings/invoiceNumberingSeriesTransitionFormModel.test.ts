import type { InvoiceNumberingSeriesOverviewView } from '@eky/api-client';
import { describe, expect, it } from 'vitest';

import {
  createInvoiceNumberingSeriesTransitionForm,
  hasInvoiceNumberingSeriesTransitionValidationErrors,
  toActivateInvoiceNumberingSeriesRequest,
  toInvoiceNumberingSeriesActivationPreviewQuery,
  validateInvoiceNumberingSeriesTransitionForm,
} from './invoiceNumberingSeriesTransitionFormModel.js';
import { uiText } from '../../i18n/fi.js';

describe('invoiceNumberingSeriesTransitionFormModel', () => {
  it('starts from the public active settings with an empty confirmation', () => {
    const form = createInvoiceNumberingSeriesTransitionForm(
      createOverview(),
      '2026-08-02',
    );

    expect(form).toMatchObject({
      confirmation: '',
      firstSequenceNumber: '1',
      fiscalYearStartMonth: '1',
      mode: 'calendarYearSequence',
      previewDate: '2026-08-02',
      reasonCode: 'accountingRequirement',
      sequencePadding: '4',
    });
  });

  it('requires the backend minimum or a larger safe integer', () => {
    const form = createInvoiceNumberingSeriesTransitionForm(
      createOverview(),
      '2026-08-02',
    );
    form.firstSequenceNumber = '99';

    const errors = validateInvoiceNumberingSeriesTransitionForm(
      form,
      100,
      uiText.companySettings.invoiceNumberingSeriesValidation,
    );

    expect(errors.firstSequenceNumber).toBe(
      uiText.companySettings.invoiceNumberingSeriesValidation
        .safeFirstSequenceNumberRequired,
    );
    expect(
      hasInvoiceNumberingSeriesTransitionValidationErrors(errors),
    ).toBe(true);
  });

  it('maps preview and activation requests without server-owned fields', () => {
    const form = createInvoiceNumberingSeriesTransitionForm(
      createOverview(),
      '2026-08-02',
    );
    form.firstSequenceNumber = '100';
    form.reasonNote = '  Kirjanpidon vaatima muutos  ';
    form.confirmation = 'OTA UUSI LASKUNUMEROSARJA KÄYTTÖÖN';

    expect(toInvoiceNumberingSeriesActivationPreviewQuery(form)).toEqual({
      fiscalYearStartMonth: 1,
      mode: 'calendarYearSequence',
      previewDate: '2026-08-02',
      sequencePadding: 4,
    });
    const request = toActivateInvoiceNumberingSeriesRequest(form, 3);

    expect(request).toEqual({
      confirmation: 'OTA UUSI LASKUNUMEROSARJA KÄYTTÖÖN',
      currentRevision: 3,
      firstSequenceNumber: 100,
      fiscalYearStartMonth: 1,
      mode: 'calendarYearSequence',
      reasonCode: 'accountingRequirement',
      reasonNote: 'Kirjanpidon vaatima muutos',
      sequencePadding: 4,
    });
    expect(request).not.toHaveProperty('companyId');
    expect(request).not.toHaveProperty('actorUserId');
    expect(request).not.toHaveProperty('seriesKey');
    expect(request).not.toHaveProperty('now');
  });
});

function createOverview(): InvoiceNumberingSeriesOverviewView {
  return {
    activeSeries: {
      mode: 'calendarYearSequence',
      fiscalYearStartMonth: 1,
      sequencePadding: 4,
      firstSequenceNumber: 1,
      createdAt: '2026-01-01T00:00:00.000Z',
      activatedAt: '2026-01-01T00:00:00.000Z',
    },
    activationConfirmationText: 'OTA UUSI LASKUNUMEROSARJA KÄYTTÖÖN',
    history: [],
    revision: 1,
  };
}
