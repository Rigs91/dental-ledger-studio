'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

type CandidateCode = {
  code: string;
  label?: string;
  confidence?: number;
  rationale?: string;
};

type ProcedureReviewFormProps = {
  procedure: {
    id: string;
    freeText: string;
    selectedCode: string | null;
    selectedLabel: string | null;
    confidence: number;
    rationale: string;
    candidateCodes: unknown;
    reviewStatus: string | null;
  };
};

function normalizeCandidateCodes(value: unknown): CandidateCode[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((entry): entry is CandidateCode => {
    return typeof entry === 'object' && entry !== null && 'code' in entry && typeof entry.code === 'string';
  });
}

export default function ProcedureReviewForm({ procedure }: ProcedureReviewFormProps) {
  const router = useRouter();
  const candidates = useMemo(() => normalizeCandidateCodes(procedure.candidateCodes), [procedure.candidateCodes]);
  const initialCode = procedure.selectedCode ?? candidates[0]?.code ?? '';
  const [action, setAction] = useState<'APPROVE' | 'UPDATE'>('APPROVE');
  const [selectedCode, setSelectedCode] = useState(initialCode);
  const [manualCode, setManualCode] = useState('');
  const [note, setNote] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const effectiveCode = manualCode.trim().length > 0 ? manualCode.trim().toUpperCase() : selectedCode;

  const submit = async () => {
    setStatus(null);
    if (note.trim().length < 3) {
      setStatus('Add a short review note (at least 3 characters).');
      return;
    }
    if (action === 'UPDATE' && !effectiveCode) {
      setStatus('Select or enter a CDT code to update.');
      return;
    }

    setLoading(true);
    const response = await fetch('/api/procedures/review', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        procedureId: procedure.id,
        action,
        selectedCode: action === 'UPDATE' ? effectiveCode : undefined,
        reviewNote: note.trim()
      })
    });
    setLoading(false);

    if (!response.ok) {
      const data = await response.json();
      setStatus(data.error ?? 'Unable to save procedure review.');
      return;
    }

    setStatus('Procedure review saved.');
    router.refresh();
  };

  return (
    <div className="card" style={{ display: 'grid', gap: 12 }}>
      <div className="badge">Procedure review</div>
      <div style={{ fontWeight: 600 }}>{procedure.selectedLabel ?? procedure.freeText}</div>
      <div className="text-muted" style={{ fontSize: 13 }}>
        Current code: {procedure.selectedCode ?? 'Pending'} | Confidence {procedure.confidence.toFixed(2)}
      </div>
      <div className="text-muted" style={{ fontSize: 12 }}>
        Review status: {procedure.reviewStatus ?? 'PENDING'}
      </div>
      <div className="text-muted" style={{ fontSize: 12 }}>
        Rationale: {procedure.rationale}
      </div>

      <label>
        <div className="text-muted" style={{ marginBottom: 6 }}>
          Review action
        </div>
        <select className="input" value={action} onChange={(event) => setAction(event.target.value as 'APPROVE' | 'UPDATE')}>
          <option value="APPROVE">Approve current code</option>
          <option value="UPDATE">Change CDT code</option>
        </select>
      </label>

      {action === 'UPDATE' ? (
        <div style={{ display: 'grid', gap: 10 }}>
          <label>
            <div className="text-muted" style={{ marginBottom: 6 }}>
              Suggested CDT codes
            </div>
            <select
              className="input"
              value={selectedCode}
              onChange={(event) => setSelectedCode(event.target.value)}
            >
              {candidates.length === 0 ? (
                <option value="">No suggestions available</option>
              ) : (
                candidates.map((candidate) => (
                  <option key={candidate.code} value={candidate.code}>
                    {candidate.code} - {candidate.label ?? 'No description'}
                  </option>
                ))
              )}
              {procedure.selectedCode && !candidates.some((candidate) => candidate.code === procedure.selectedCode) ? (
                <option value={procedure.selectedCode}>{procedure.selectedCode} - Current code</option>
              ) : null}
            </select>
          </label>
          <label>
            <div className="text-muted" style={{ marginBottom: 6 }}>
              Manual CDT code (optional)
            </div>
            <input
              className="input"
              value={manualCode}
              onChange={(event) => setManualCode(event.target.value)}
              placeholder="Enter a code like D1110"
            />
          </label>
        </div>
      ) : null}

      <label>
        <div className="text-muted" style={{ marginBottom: 6 }}>
          Review note
        </div>
        <textarea className="input" value={note} onChange={(event) => setNote(event.target.value)} />
      </label>

      <button className="button" type="button" onClick={submit} disabled={loading}>
        {action === 'UPDATE' ? 'Save code change' : 'Approve procedure'}
      </button>
      {status ? <div className="text-muted">{status}</div> : null}
    </div>
  );
}
