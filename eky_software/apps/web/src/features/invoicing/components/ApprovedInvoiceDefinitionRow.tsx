import styles from './ApprovedInvoicePreview.module.css';

interface ApprovedInvoiceDefinitionRowProps {
  label: string;
  value: string;
}

export function ApprovedInvoiceDefinitionRow({
  label,
  value,
}: ApprovedInvoiceDefinitionRowProps): React.JSX.Element {
  return (
    <div className={styles.detailRow}>
      <dt>{label}</dt>
      <dd className={styles.value}>{value}</dd>
    </div>
  );
}
