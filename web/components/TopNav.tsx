interface TopNavProps {
  statusLabel: string | null;
}

export function TopNav({ statusLabel }: TopNavProps) {
  return (
    <header className="topnav">
      <div className="topnav-titleblock">
        <h1>AI Research Agent</h1>
        <p>Accurate answers. Real sources. Powered by AI agents.</p>
      </div>
      <div className="topnav-right">
        {statusLabel ? <span className="topnav-status">{statusLabel}</span> : null}
        <a
          className="topnav-avatar"
          href="https://github.com/kasasa22/_llmBoilerGrow2025"
          target="_blank"
          rel="noopener noreferrer"
          title="View source on GitHub"
        >
          T
        </a>
      </div>
    </header>
  );
}
