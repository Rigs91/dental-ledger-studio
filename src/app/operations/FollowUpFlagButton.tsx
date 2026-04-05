'use client';

import { useState } from 'react';

export default function FollowUpFlagButton({
  patientId,
  context
}: {
  patientId: string;
  context: string;
}) {
  const [status, setStatus] = useState<string | null>(null);

  const createFlag = async () => {
    setStatus(null);
    const response = await fetch('/api/flags/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        patientId,
        likelyIssue: `Front desk follow-up needed for ${context}.`,
        recommendedAction: 'Contact patient and confirm insurance coverage before the visit.'
      })
    });

    if (!response.ok) {
      const data = await response.json();
      setStatus(data.error ?? 'Unable to create follow-up flag.');
      return;
    }

    setStatus('Follow-up flag created.');
  };

  return (
    <div style={{ display: 'grid', gap: 6 }}>
      <button className="button warn" type="button" onClick={createFlag}>
        Flag follow-up
      </button>
      {status ? <div className="text-muted" style={{ fontSize: 12 }}>
        {status}
      </div> : null}
    </div>
  );
}
