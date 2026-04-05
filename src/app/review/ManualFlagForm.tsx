'use client';

import { useState } from 'react';

export default function ManualFlagForm({
  claimOptions
}: {
  claimOptions: { id: string; label: string }[];
}) {
  const [claimId, setClaimId] = useState(claimOptions[0]?.id ?? '');
  const [likelyIssue, setLikelyIssue] = useState('');
  const [recommendedAction, setRecommendedAction] = useState('');
  const [status, setStatus] = useState<string | null>(null);

  const submit = async () => {
    setStatus(null);
    const response = await fetch('/api/flags/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ claimId, likelyIssue, recommendedAction })
    });
    if (!response.ok) {
      const data = await response.json();
      setStatus(data.error ?? 'Unable to create flag.');
      return;
    }
    setStatus('Manual flag created.');
    setLikelyIssue('');
    setRecommendedAction('');
  };

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <label>
        <div className="text-muted" style={{ marginBottom: 6 }}>
          Claim
        </div>
        <select className="input" value={claimId} onChange={(event) => setClaimId(event.target.value)}>
          {claimOptions.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        <div className="text-muted" style={{ marginBottom: 6 }}>
          Likely issue
        </div>
        <input
          className="input"
          value={likelyIssue}
          onChange={(event) => setLikelyIssue(event.target.value)}
        />
      </label>
      <label>
        <div className="text-muted" style={{ marginBottom: 6 }}>
          Recommended action
        </div>
        <input
          className="input"
          value={recommendedAction}
          onChange={(event) => setRecommendedAction(event.target.value)}
        />
      </label>
      <button className="button" type="button" onClick={submit} disabled={!claimId}>
        Create manual flag
      </button>
      {status ? <div className="text-muted">{status}</div> : null}
    </div>
  );
}
