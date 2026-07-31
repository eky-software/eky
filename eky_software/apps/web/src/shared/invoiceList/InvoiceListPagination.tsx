interface InvoiceListPaginationProps {
  ariaLabel: string;
  className?: string | undefined;
  disabled?: boolean;
  nextLabel: string;
  onNextPage(): void;
  onPreviousPage(): void;
  page: number;
  pageLabel: string;
  previousLabel: string;
  totalPages: number;
}

export function InvoiceListPagination({
  ariaLabel,
  className,
  disabled = false,
  nextLabel,
  onNextPage,
  onPreviousPage,
  page,
  pageLabel,
  previousLabel,
  totalPages,
}: InvoiceListPaginationProps): React.JSX.Element {
  return (
    <nav aria-label={ariaLabel} className={className}>
      <button
        className="secondary-action"
        disabled={disabled || page <= 1}
        onClick={onPreviousPage}
        type="button"
      >
        {previousLabel}
      </button>
      <span>{pageLabel}</span>
      <button
        className="secondary-action"
        disabled={disabled || totalPages === 0 || page >= totalPages}
        onClick={onNextPage}
        type="button"
      >
        {nextLabel}
      </button>
    </nav>
  );
}
