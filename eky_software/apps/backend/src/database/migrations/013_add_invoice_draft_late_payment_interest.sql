ALTER TABLE invoice_drafts
  ADD COLUMN late_payment_interest_basis_points INTEGER NOT NULL DEFAULT 0
    CHECK (
      late_payment_interest_basis_points >= 0
      AND late_payment_interest_basis_points <= 100000
    );
