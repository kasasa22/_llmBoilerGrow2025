'use client';

import { useState, type KeyboardEvent } from 'react';

interface QueryFormProps {
  disabled: boolean;
  onSubmit: (query: string) => void;
}

export function QueryForm({ disabled, onSubmit }: QueryFormProps) {
  const [value, setValue] = useState('');

  const submit = () => {
    const query = value.trim();
    if (!query) return;
    onSubmit(query);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      submit();
    }
  };

  return (
    <section className="ask">
      <label htmlFor="query">Ask a research question</label>
      <textarea
        id="query"
        rows={3}
        placeholder="e.g. What is the current status of Civo GPU node pricing in LON1?"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={onKeyDown}
        disabled={disabled}
      />
      <div className="controls">
        <button type="button" onClick={submit} disabled={disabled}>
          Send
        </button>
        <span className="hint">Ctrl/⌘+Enter</span>
      </div>
    </section>
  );
}
