interface ErrorBannerProps {
  message: string | null;
  onRetry?: () => void;
}

export function ErrorBanner({ message, onRetry }: ErrorBannerProps) {
  if (!message) return null;
  return (
    <section className="banner error" role="alert">
      <span>{message}</span>
      {onRetry ? (
        <button type="button" className="banner-action" onClick={onRetry}>
          Reconnect
        </button>
      ) : null}
    </section>
  );
}
