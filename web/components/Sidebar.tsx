'use client';

import type { HistoryItem } from '@/hooks/useQueryHistory';

interface SidebarProps {
  items: HistoryItem[];
  activeChatId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  onClear: () => void;
  modelName: string;
}

function formatWhen(iso: string): string {
  try {
    const then = new Date(iso).getTime();
    const diff = Math.max(0, Date.now() - then);
    const m = Math.floor(diff / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return `${m}m`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h`;
    return `${Math.floor(h / 24)}d`;
  } catch {
    return '';
  }
}

export function Sidebar({
  items,
  activeChatId,
  onSelect,
  onNew,
  onDelete,
  onClear,
  modelName,
}: SidebarProps) {
  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <span className="sidebar-brand-icon" aria-hidden>◆</span>
        <span className="sidebar-brand-text">
          AI Research <span className="sidebar-brand-accent">Agent</span>
        </span>
      </div>

      <button className="sidebar-new-primary" onClick={onNew}>
        <span aria-hidden>＋</span> New Research
      </button>

      <div className="sidebar-history-block">
        <div className="sidebar-history-header">
          <span className="sidebar-section-label">Chat history</span>
          {items.length > 0 ? (
            <button className="sidebar-clear-mini" onClick={onClear} title="Clear all history">
              Clear
            </button>
          ) : null}
        </div>

        {items.length === 0 ? (
          <p className="sidebar-history-empty">No chats yet — ask a question to start.</p>
        ) : (
          <ul className="sidebar-history">
            {items.map((it) => (
              <li key={it.id}>
                <div
                  className={
                    it.id === activeChatId
                      ? 'sidebar-chat sidebar-chat--active'
                      : 'sidebar-chat'
                  }
                >
                  <button
                    className="sidebar-chat-body"
                    onClick={() => onSelect(it.id)}
                    title={it.query}
                  >
                    <span className="sidebar-chat-query">{it.query}</span>
                    <span className="sidebar-chat-meta">
                      <span
                        className={
                          it.status === 'done'
                            ? 'sidebar-chat-status sidebar-chat-status--done'
                            : it.status === 'running'
                              ? 'sidebar-chat-status sidebar-chat-status--running'
                              : 'sidebar-chat-status sidebar-chat-status--failed'
                        }
                        aria-hidden
                      />
                      <span>{formatWhen(it.submittedAt)}</span>
                    </span>
                  </button>
                  <button
                    className="sidebar-chat-delete"
                    onClick={() => onDelete(it.id)}
                    title="Delete this chat"
                    aria-label="Delete"
                  >
                    ×
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="sidebar-status-card">
        <div className="sidebar-status-header">
          <span className="sidebar-status-dot" aria-hidden />
          <span>System Online</span>
        </div>
        <div className="sidebar-status-line">Cluster: Civo (LON1)</div>
        <div className="sidebar-status-line">Model: {modelName}</div>
      </div>
    </aside>
  );
}
