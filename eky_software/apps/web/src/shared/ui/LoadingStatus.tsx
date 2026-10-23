import styles from './LoadingStatus.module.css';

interface LoadingStatusProps {
  children: React.ReactNode;
  className?: string | undefined;
  active?: boolean;
}

export function LoadingStatus({
  children,
  className = 'message',
  active = true,
}: LoadingStatusProps): React.JSX.Element {
  return (
    <p
      className={`${styles.status} ${className}`}
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      {active ? (
        <>
          <LoadingMark active />
          <span className={styles.text}>{children}</span>
        </>
      ) : null}
    </p>
  );
}

export function LoadingMark({ active }: { active: boolean }): React.JSX.Element {
  return (
    <span
      aria-hidden="true"
      className={active ? styles.spinner : `${styles.spinner} ${styles.inactiveSpinner}`}
    />
  );
}
