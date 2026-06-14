import { describe, expect, it } from 'vitest';

import {
  createInitialNewInvoiceForm,
  updateNewInvoiceFormField,
} from './newInvoiceFormState.js';

describe('createInitialNewInvoiceForm', () => {
  it('uses the selected day and a 14 day payment term as UI defaults', () => {
    const form = createInitialNewInvoiceForm(new Date(2026, 5, 14));

    expect(form).toMatchObject({
      dueDate: '2026-06-28',
      invoiceDate: '2026-06-14',
      paymentTermDays: '14',
      priceInputMode: 'net',
    });
  });

  it('moves the due date across month and year boundaries', () => {
    const form = createInitialNewInvoiceForm(new Date(2026, 11, 24));

    expect(form.dueDate).toBe('2027-01-07');
  });

  it('starts without customer or optional text values', () => {
    const form = createInitialNewInvoiceForm(new Date(2026, 5, 14));

    expect(form).toMatchObject({
      customerId: '',
      note: '',
      orderNumber: '',
      subject: '',
    });
  });

  it('updates one field without changing the other form values', () => {
    const form = createInitialNewInvoiceForm(new Date(2026, 5, 14));
    const updatedForm = updateNewInvoiceFormField(
      form,
      'priceInputMode',
      'gross',
    );

    expect(updatedForm.priceInputMode).toBe('gross');
    expect(updatedForm.invoiceDate).toBe(form.invoiceDate);
    expect(updatedForm.dueDate).toBe(form.dueDate);
  });
});
