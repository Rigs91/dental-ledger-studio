'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

const denialReasons = [
  { code: 'COVERAGE_INACTIVE', label: 'Coverage inactive on date of service.' },
  { code: 'MISSING_INFO', label: 'Missing tooth number or surface information.' },
  { code: 'PLAN_EXCLUSION', label: 'Procedure not covered under plan benefits.' },
  { code: 'DUPLICATE', label: 'Duplicate claim detected by payer.' },
  { code: 'FREQUENCY_LIMIT', label: 'Frequency limitation exceeded.' }
];

const approvalReasons = [
  { code: 'PAID_AS_BILLED', label: 'Paid as billed by payer.' },
  { code: 'ALLOWED_AMOUNT', label: 'Allowed amount applied with contractual adjustment.' },
  { code: 'DEDUCTIBLE', label: 'Covered after deductible applied.' },
  { code: 'ALTERNATE_BENEFIT', label: 'Covered at alternate benefit level.' }
];

export default function ClaimDecisionForm({
  claimId,
  balanceDue,
  expectedCopay,
  copayCollected
}: {
  claimId: string;
  balanceDue: number;
  expectedCopay?: number | null;
  copayCollected?: number;
}) {
  const router = useRouter();
  const [decision, setDecision] = useState<'DENIED' | 'PAID'>('DENIED');
  const [selectedReason, setSelectedReason] = useState(denialReasons[0]?.label ?? '');
  const [customReason, setCustomReason] = useState('');
  const [insurancePaid, setInsurancePaid] = useState('');
  const [adjustment, setAdjustment] = useState('');
  const [copayPaid, setCopayPaid] = useState('');
  const [occurredAt, setOccurredAt] = useState(() => new Date().toISOString().slice(0, 10));
  const [status, setStatus] = useState<string | null>(null);

  const reasons = decision === 'DENIED' ? denialReasons : approvalReasons;
  const reasonLabel = selectedReason || reasons[0]?.label || '';
  const reasonCode = reasons.find((reason) => reason.label === reasonLabel)?.code;
  const reasonText = customReason.trim().length > 0 ? customReason.trim() : reasonLabel;
  const hasValidReason = reasonText.trim().length >= 3;
  const insurancePaidValue = Number(insurancePaid);
  const adjustmentValue = Number(adjustment);
  const copayPaidValue = Number(copayPaid);
  const requiresAmounts = decision === 'PAID';
  const hasAmounts =
    (Number.isFinite(insurancePaidValue) && insurancePaidValue > 0) ||
    (Number.isFinite(adjustmentValue) && adjustmentValue > 0) ||
    (Number.isFinite(copayPaidValue) && copayPaidValue > 0);
  const canSubmit = hasValidReason && (!requiresAmounts || hasAmounts);
  const projectedBalance =
    decision === 'PAID' && balanceDue > 0
      ? balanceDue -
        (Number.isFinite(insurancePaidValue) ? insurancePaidValue : 0) -
        (Number.isFinite(adjustmentValue) ? adjustmentValue : 0) -
        (Number.isFinite(copayPaidValue) ? copayPaidValue : 0)
      : null;

  const submit = async () => {
    setStatus(null);
    const response = await fetch('/api/claims/decision', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        claimId,
        status: decision,
        reasonCode,
        reasonText,
        insurancePaid: decision === 'PAID' ? insurancePaidValue : undefined,
        adjustment: decision === 'PAID' ? adjustmentValue : undefined,
        copayPaid: decision === 'PAID' ? copayPaidValue : undefined,
        occurredAt
      })
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      setStatus(data.error ?? 'Unable to update claim status.');
      return;
    }

    setStatus(decision === 'DENIED' ? 'Claim marked denied.' : 'Claim marked paid.');
    setCustomReason('');
    setInsurancePaid('');
    setAdjustment('');
    setCopayPaid('');
    router.refresh();
  };

  const copayShortfall =
    expectedCopay && copayCollected !== undefined
      ? Math.max(expectedCopay - copayCollected, 0)
      : expectedCopay ?? null;

  return (
    <div className="card" style={{ display: 'grid', gap: 12 }}>
      <div className="badge">Record claim decision</div>
      <label>
        <div className="text-muted" style={{ marginBottom: 6 }}>
          Decision
        </div>
        <select
          className="input"
          value={decision}
          onChange={(event) => {
            const value = event.target.value === 'PAID' ? 'PAID' : 'DENIED';
            setDecision(value);
            const nextReasons = value === 'DENIED' ? denialReasons : approvalReasons;
            setSelectedReason(nextReasons[0]?.label ?? '');
            setCustomReason('');
          }}
        >
          <option value="DENIED">Denied</option>
          <option value="PAID">Approved / Paid</option>
        </select>
      </label>
      <label>
        <div className="text-muted" style={{ marginBottom: 6 }}>
          Example reason
        </div>
        <select
          className="input"
          value={reasonLabel}
          onChange={(event) => setSelectedReason(event.target.value)}
        >
          {reasons.map((reason) => (
            <option key={reason.code} value={reason.label}>
              {reason.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        <div className="text-muted" style={{ marginBottom: 6 }}>
          Custom note (optional)
        </div>
        <textarea
          className="input"
          value={customReason}
          onChange={(event) => setCustomReason(event.target.value)}
          placeholder="Add payer-specific details or internal notes."
        />
      </label>
      {decision === 'PAID' ? (
        <div className="card" style={{ padding: 12, display: 'grid', gap: 10 }}>
          <div className="text-muted">Enter the payer response amounts to update the ledger.</div>
          <label>
            <div className="text-muted" style={{ marginBottom: 6 }}>
              Insurance payment amount
            </div>
            <input
              className="input"
              type="number"
              min="0"
              step="0.01"
              value={insurancePaid}
              onChange={(event) => setInsurancePaid(event.target.value)}
              placeholder="0.00"
            />
          </label>
          <label>
            <div className="text-muted" style={{ marginBottom: 6 }}>
              Adjustment / write-off amount
            </div>
            <input
              className="input"
              type="number"
              min="0"
              step="0.01"
              value={adjustment}
              onChange={(event) => setAdjustment(event.target.value)}
              placeholder="0.00"
            />
          </label>
          {copayShortfall !== null ? (
            <label>
              <div className="text-muted" style={{ marginBottom: 6 }}>
                Copay collected now (optional)
              </div>
              <input
                className="input"
                type="number"
                min="0"
                step="0.01"
                value={copayPaid}
                onChange={(event) => setCopayPaid(event.target.value)}
                placeholder={copayShortfall > 0 ? copayShortfall.toFixed(2) : '0.00'}
              />
              <div className="text-muted" style={{ fontSize: 12, marginTop: 4 }}>
                Expected copay {expectedCopay ? `$${expectedCopay.toFixed(2)}` : 'N/A'} | Already collected{' '}
                {copayCollected ? `$${copayCollected.toFixed(2)}` : '$0.00'}
              </div>
            </label>
          ) : null}
          <label>
            <div className="text-muted" style={{ marginBottom: 6 }}>
              Decision date
            </div>
            <input
              className="input"
              type="date"
              value={occurredAt}
              onChange={(event) => setOccurredAt(event.target.value)}
            />
          </label>
          {projectedBalance !== null ? (
            <div className="text-muted" style={{ fontSize: 12 }}>
              Projected balance after posting: {projectedBalance <= 0.005 ? 'Paid/credit' : `$${projectedBalance.toFixed(2)} due`}
            </div>
          ) : null}
        </div>
      ) : null}
      <button className="button" type="button" onClick={submit} disabled={!canSubmit}>
        Save decision
      </button>
      {status ? <div className="text-muted">{status}</div> : null}
    </div>
  );
}
