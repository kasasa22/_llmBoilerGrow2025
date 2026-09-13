interface ErrorBannerProps {
  message: string | null;
}

export function ErrorBanner({ message }: ErrorBannerProps) {
  if (!message) return null;
  return (
    <section className="banner error" role="alert">
      {message}
    </section>
  );
}
