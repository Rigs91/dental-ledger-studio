'use client';

import { useState } from 'react';

export default function FlagResolutionForm({ flagId }: { flagId: string }) {
  const [status, setStatus] = useState<'RESOLVED' | 'VERIFIED'>('RESOLVED');
  const [note, setNote] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  const submit = async () => {
    setMessage(null);
    const response = await fetch('/api/flags/resolve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ flagId, status, resolutionNote: note })
    });
    if (!response.ok) {
      const data = await response.json();
      setMessage(data.error ?? 'Unable to update flag.');
      return;
    }
    setMessage('Flag updated.');
  };

  return (
    <div className="card" style={{ display: 'grid', gap: 12 }}>
      <div className="badge">Resolve flag</div>
      <label>
        <div className="text-muted" style={{ marginBottom: 6 }}>
          Status
        </div>
        <select
          className="input"
          value={status}
          onChange={(event) => setStatus(event.target.value as 'RESOLVED' | 'VERIFIED')}
        >
          <option value="RESOLVED">Resolved</option>
          <option value="VERIFIED">Verified Correct</option>
        </select>
      </label>
      <label>
        <div className="text-muted" style={{ marginBottom: 6 }}>
          Resolution note
        </div>
        <textarea className="input" value={note} onChange={(event) => setNote(event.target.value)} />
      </label>
      <button className="button" type="button" onClick={submit}>
        Save resolution
      </button>
      {message ? <div className="text-muted">{message}</div> : null}
    </div>
  );
}
