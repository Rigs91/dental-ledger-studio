'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { formatCurrency } from '@/shared/domain/format';

type PolicyOption = {
  id: string;
  payerName: string;
  memberId: string;
  priority: string;
  effectiveStart: string;
  effectiveEnd?: string | null;
  employerName?: string | null;
  lastVerifiedAt?: string | null;
  copayAmount?: string | null;
  activeOnDos: boolean;
};

type SnapshotSummary = {
  payerName: string;
  memberId: string;
  priority: string;
  employerName?: string | null;
  lastVerifiedAt?: string | null;
  copayAmount?: string | null;
};

export default function ClaimResubmissionForm({
  claimId,
  policies,
  originalSnapshot
}: {
  claimId: string;
  policies: PolicyOption[];
  originalSnapshot: SnapshotSummary | null;
}) {
  const router = useRouter();
  const hasOriginal = Boolean(originalSnapshot);
  const [mode, setMode] = useState<'original' | 'policy'>(hasOriginal ? 'original' : 'policy');
  const [policyId, setPolicyId] = useState(policies[0]?.id ?? '');
  const [reason, setReason] = useState('');
  const [status, setStatus] = useState<string | null>(null);

  const selectedPolicy = policies.find((policy) => policy.id === policyId) ?? policies[0] ?? null;
  const selectedCopay = selectedPolicy?.copayAmount ? Number(selectedPolicy.copayAmount) : null;

  const submit = async () => {
    setStatus(null);
    const response = await fetch('/api/claims/resubmit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        claimId,
        reason,
        useOriginalSnapshot: mode === 'original',
        insurancePolicyId: mode === 'policy' ? policyId : undefined
      })
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      setStatus(data.error ?? 'Unable to resubmit claim.');
      return;
    }

    setStatus('Claim resubmitted. New payer packet generated.');
    setReason('');
    router.refresh();
  };

  return (
    <div className="card" style={{ display: 'grid', gap: 12 }}>
      <div className="badge">Resubmit claim</div>
      {hasOriginal ? (
        <label style={{ display: 'flex', gap: 8 }}>
          <input
            type="radio"
            name="resubmit-mode"
            checked={mode === 'original'}
            onChange={() => setMode('original')}
          />
          Use original insurance snapshot ({originalSnapshot?.payerName} | Member {originalSnapshot?.memberId}
          {originalSnapshot?.employerName ? ` | ${originalSnapshot.employerName}` : ''})
        </label>
      ) : null}
      <label style={{ display: 'flex', gap: 8 }}>
        <input
          type="radio"
          name="resubmit-mode"
          checked={mode === 'policy'}
          onChange={() => setMode('policy')}
        />
        Select policy from patient file
      </label>
      {mode === 'policy' ? (
        <div style={{ display: 'grid', gap: 8, marginLeft: 22 }}>
          <select
            className="input"
            value={policyId}
            onChange={(event) => setPolicyId(event.target.value)}
          >
            {policies.map((policy) => (
              <option key={policy.id} value={policy.id}>
                {policy.payerName} ({policy.priority}) | Member {policy.memberId}
                {policy.employerName ? ` | ${policy.employerName}` : ''}
              </option>
            ))}
          </select>
          {selectedPolicy ? (
            <div className="text-muted" style={{ fontSize: 12 }}>
              Effective {selectedPolicy.effectiveStart}
              {selectedPolicy.effectiveEnd ? ` - ${selectedPolicy.effectiveEnd}` : ''} | {selectedPolicy.activeOnDos ? 'Active on DOS' : 'Not active on DOS'}
              {selectedPolicy.lastVerifiedAt ? ` | Verified ${selectedPolicy.lastVerifiedAt}` : ''}
              {selectedCopay !== null && !Number.isNaN(selectedCopay)
                ? ` | Copay ${formatCurrency(selectedCopay)}`
                : ''}
            </div>
          ) : null}
        </div>
      ) : null}
      <label>
        <div className="text-muted" style={{ marginBottom: 6 }}>
          Resubmission reason
        </div>
        <textarea
          className="input"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="Example: Original policy inactive on DOS. Resubmitting with spouse policy."
        />
      </label>
      <button
        className="button"
        type="button"
        onClick={submit}
        disabled={reason.trim().length < 5 || (mode === 'policy' && !policyId)}
      >
        Resubmit claim
      </button>
      {status ? <div className="text-muted">{status}</div> : null}
    </div>
  );
}

