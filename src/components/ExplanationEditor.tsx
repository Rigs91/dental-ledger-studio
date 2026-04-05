'use client';

import { useState } from 'react';

type Explanation = {
  id: string;
  originalText: string;
  editedText: string | null;
  status: string;
};

export default function ExplanationEditor({ explanation }: { explanation: Explanation }) {
  const [editedText, setEditedText] = useState(explanation.editedText ?? explanation.originalText);
  const [status, setStatus] = useState<string | null>(null);

  const save = async () => {
    setStatus(null);
    const response = await fetch('/api/explanations/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ explanationId: explanation.id, editedText })
    });
    if (!response.ok) {
      const data = await response.json();
      setStatus(data.error ?? 'Unable to save explanation.');
      return;
    }
    setStatus('Explanation saved as final.');
  };

  return (
    <div className="card" style={{ display: 'grid', gap: 12 }}>
      <div className="badge">Explain balance</div>
      <div className="text-muted">Original draft:</div>
      <div>{explanation.originalText}</div>
      <div className="text-muted">Editable version:</div>
      <textarea
        className="input"
        style={{ minHeight: 120 }}
        value={editedText}
        onChange={(event) => setEditedText(event.target.value)}
      />
      <button className="button" type="button" onClick={save}>
        Save explanation
      </button>
      {status ? <div className="text-muted">{status}</div> : null}
    </div>
  );
}
