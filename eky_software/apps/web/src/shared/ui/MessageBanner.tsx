export type MessageBannerVariant = 'error' | 'info' | 'success';

interface MessageBannerProps {
  children: React.ReactNode;
  variant: MessageBannerVariant;
}

const variantClassNames: Record<MessageBannerVariant, string> = {
  error: 'error-message',
  info: '',
  success: 'success-message',
};

export function MessageBanner({
  children,
  variant,
}: MessageBannerProps): React.JSX.Element {
  const variantClassName = variantClassNames[variant];

  return (
    <p
      className={variantClassName === '' ? 'message' : `message ${variantClassName}`}
      role={variant === 'error' ? 'alert' : 'status'}
    >
      {children}
    </p>
  );
}
