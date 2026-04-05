'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

type PolicyOption = {
  id: string;
  label: string;
  effectiveStart: string;
  effectiveEnd?: string | null;
};

type ClaimOption = {
  id: string;
  dateOfService: string;
  dateLabel: string;
  status: string;
  balance: number;
  payerLabel: string;
};

type OverrideResponse = {
  updatedClaims?: string[];
  skippedClaims?: string[];
  error?: string;
};

export default function InsuranceOverrideForm({
  patientId,
  policies,
  claims
}: {
  patientId: string;
  policies: PolicyOption[];
  claims: ClaimOption[];
}) {
  const router = useRouter();
  const today = new Date().toISOString().slice(0, 10);
  const [policyId, setPolicyId] = useState(policies[0]?.id ?? '');
  const [effectiveStart, setEffectiveStart] = useState(today);
  const [effectiveEnd, setEffectiveEnd] = useState('');
  const [reason, setReason] = useState('');
  const [applyMode, setApplyMode] = useState<'all' | 'selected'>('all');
  const [selectedClaims, setSelectedClaims] = useState<string[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; tone: 'success' | 'error' } | null>(null);

  useEffect(() => {
    if (!toast) {
      return;
    }
    const timer = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(timer);
  }, [toast]);

  if (policies.length === 0) {
    return (
      <div className="text-muted">
        Add an insurance policy before creating an override.
      </div>
    );
  }

  const parseDate = (value: string) => new Date(`${value}T00:00:00`);
  const rangeStart = effectiveStart ? parseDate(effectiveStart) : null;
  const rangeEnd = effectiveEnd ? parseDate(effectiveEnd) : null;
  const claimsInRange = claims.filter((claim) => {
    if (!rangeStart) {
      return false;
    }
    const claimDate = parseDate(claim.dateOfService);
    if (rangeEnd) {
      return claimDate >= rangeStart && claimDate <= rangeEnd;
    }
    return claimDate >= rangeStart;
  });

  const submit = async () => {
    setStatus(null);
    const response = await fetch('/api/insurance/override/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        patientId,
        insurancePolicyId: policyId,
        effectiveStart,
        effectiveEnd: effectiveEnd || undefined,
        reason,
        claimIds: applyMode === 'selected' ? selectedClaims : undefined
      })
    });

    let data: OverrideResponse | null = null;
    try {
      const contentType = response.headers.get('content-type') ?? '';
      if (contentType.includes('application/json')) {
        data = (await response.json()) as OverrideResponse;
      }
    } catch {
      data = null;
    }

    if (!response.ok || !data) {
      const message = data?.error ?? 'Unable to save override. Please sign in again and retry.';
      setStatus(message);
      setToast({ message, tone: 'error' });
      return;
    }

    const updatedCount = Array.isArray(data.updatedClaims) ? data.updatedClaims.length : 0;
    const skippedCount = Array.isArray(data.skippedClaims) ? data.skippedClaims.length : 0;
    const successMessage =
      updatedCount > 0
        ? `Override saved. Updated ${updatedCount} claim(s).${
            skippedCount > 0 ? ` Skipped ${skippedCount} already on the selected policy.` : ''
          }`
        : 'Override saved. No existing claims needed updates.';
    setStatus(successMessage);
    setToast({ message: successMessage, tone: 'success' });
    setEffectiveStart('');
    setEffectiveEnd('');
    setReason('');
    setSelectedClaims([]);
    router.refresh();
  };

  return (
    <div style={{ display: 'grid', gap: 12, position: 'relative' }}>
      <label>
        <div className="text-muted" style={{ marginBottom: 6 }}>
          Policy to use
        </div>
        <select className="input" value={policyId} onChange={(event) => setPolicyId(event.target.value)}>
          {policies.map((policy) => (
            <option key={policy.id} value={policy.id}>
              {policy.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        <div className="text-muted" style={{ marginBottom: 6 }}>
          Override start
        </div>
        <input
          className="input"
          type="date"
          value={effectiveStart}
          onChange={(event) => setEffectiveStart(event.target.value)}
        />
      </label>
      <label>
        <div className="text-muted" style={{ marginBottom: 6 }}>
          Override end (optional)
        </div>
        <input
          className="input"
          type="date"
          value={effectiveEnd}
          onChange={(event) => setEffectiveEnd(event.target.value)}
        />
      </label>
      <label>
        <div className="text-muted" style={{ marginBottom: 6 }}>
          Reason
        </div>
        <input
          className="input"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="Staff confirmed primary for this date range."
        />
      </label>
      <div style={{ display: 'grid', gap: 8 }}>
        <div className="text-muted">Apply override to claims</div>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            type="radio"
            name="applyMode"
            checked={applyMode === 'all'}
            onChange={() => setApplyMode('all')}
          />
          <span>All claims in the date range</span>
        </label>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            type="radio"
            name="applyMode"
            checked={applyMode === 'selected'}
            onChange={() => setApplyMode('selected')}
          />
          <span>Select specific claims</span>
        </label>
        {applyMode === 'selected' ? (
          <div className="card" style={{ padding: 12, display: 'grid', gap: 8 }}>
            <div className="text-muted" style={{ fontSize: 12 }}>
              {claimsInRange.length} claim(s) in range.
            </div>
            {claimsInRange.length === 0 ? (
              <div className="text-muted">No claims fall within the selected date range.</div>
            ) : (
              <>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button
                    className="button secondary"
                    type="button"
                    onClick={() => setSelectedClaims(claimsInRange.map((claim) => claim.id))}
                  >
                    Select all in range
                  </button>
                  <button
                    className="button secondary"
                    type="button"
                    onClick={() => setSelectedClaims([])}
                  >
                    Clear selection
                  </button>
                </div>
                <div style={{ display: 'grid', gap: 8 }}>
                  {claimsInRange.map((claim) => {
                    const isChecked = selectedClaims.includes(claim.id);
                    return (
                      <label key={claim.id} className="card" style={{ padding: 10, cursor: 'pointer' }}>
                        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={(event) => {
                              if (event.target.checked) {
                                setSelectedClaims((prev) => [...prev, claim.id]);
                              } else {
                                setSelectedClaims((prev) => prev.filter((id) => id !== claim.id));
                              }
                            }}
                          />
                          <div>
                            <div style={{ fontWeight: 600 }}>
                              {claim.dateLabel} | {claim.status}
                            </div>
                            <div className="text-muted" style={{ fontSize: 12 }}>
                              {claim.payerLabel} | Balance {claim.balance.toFixed(2)}
                            </div>
                          </div>
                        </div>
                      </label>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        ) : null}
      </div>
      <button
        className="button"
        type="button"
        onClick={submit}
        disabled={
          !policyId ||
          effectiveStart.trim().length === 0 ||
          reason.trim().length < 3 ||
          (applyMode === 'selected' && selectedClaims.length === 0)
        }
      >
        Save override
      </button>
      {status ? <div className="text-muted">{status}</div> : null}
      {toast ? (
        <div
          style={{
            position: 'fixed',
            right: 24,
            bottom: 24,
            padding: '12px 16px',
            borderRadius: 14,
            background: toast.tone === 'success' ? '#0f172a' : '#b45309',
            color: '#fff',
            boxShadow: '0 18px 30px -22px rgba(15, 23, 42, 0.45)',
            zIndex: 50
          }}
        >
          {toast.message}
        </div>
      ) : null}
    </div>
  );
}
