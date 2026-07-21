import {
  hasApprovedInvoiceValue,
} from '../approved/approvedInvoiceFormatting.js';
import styles from './ApprovedInvoicePreview.module.css';
import { uiText } from '../../../i18n/fi.js';

interface ApprovedInvoicePartyDetailsProps {
  businessId: string;
  city: string;
  customerNumber?: string;
  email: string;
  name: string;
  phone: string;
  postalCode: string;
  streetAddress: string;
  title: string;
  vatNumber?: string;
  website?: string;
}

export function ApprovedInvoicePartyDetails({
  businessId,
  city,
  customerNumber,
  email,
  name,
  phone,
  postalCode,
  streetAddress,
  title,
  vatNumber,
  website,
}: ApprovedInvoicePartyDetailsProps): React.JSX.Element {
  return (
    <section className={styles.box}>
      <h3>{title}</h3>
      <dl className={styles.detailList}>
        <ApprovedInvoiceDefinitionRow
          label={uiText.customers.name}
          value={name}
        />
        {hasApprovedInvoiceValue(customerNumber ?? '') ? (
          <ApprovedInvoiceDefinitionRow
            label={uiText.customers.customerNumber}
            value={customerNumber ?? ''}
          />
        ) : null}
        {hasApprovedInvoiceValue(businessId) ? (
          <ApprovedInvoiceDefinitionRow
            label={uiText.customers.businessId}
            value={businessId}
          />
        ) : null}
        {hasApprovedInvoiceValue(vatNumber ?? '') ? (
          <ApprovedInvoiceDefinitionRow
            label={uiText.companySettings.vatNumber}
            value={vatNumber ?? ''}
          />
        ) : null}
        {hasApprovedInvoiceValue(streetAddress) ? (
          <ApprovedInvoiceDefinitionRow
            label={uiText.companySettings.streetAddress}
            value={streetAddress}
          />
        ) : null}
        {hasApprovedInvoiceValue(postalCode) ||
        hasApprovedInvoiceValue(city) ? (
          <ApprovedInvoiceDefinitionRow
            label={uiText.invoicing.postalCodeAndCity}
            value={[postalCode, city].filter(hasApprovedInvoiceValue).join(' ')}
          />
        ) : null}
        {hasApprovedInvoiceValue(email) ? (
          <ApprovedInvoiceDefinitionRow
            label={uiText.companySettings.email}
            value={email}
          />
        ) : null}
        {hasApprovedInvoiceValue(phone) ? (
          <ApprovedInvoiceDefinitionRow
            label={uiText.companySettings.phone}
            value={phone}
          />
        ) : null}
        {hasApprovedInvoiceValue(website ?? '') ? (
          <ApprovedInvoiceDefinitionRow
            label={uiText.companySettings.website}
            value={website ?? ''}
          />
        ) : null}
      </dl>
    </section>
  );
}

export function ApprovedInvoiceDefinitionRow({
  label,
  value,
}: {
  label: string;
  value: string;
}): React.JSX.Element {
  return (
    <div className={styles.detailRow}>
      <dt>{label}</dt>
      <dd className={styles.value}>{value}</dd>
    </div>
  );
}
