'use client';

import { useState } from 'react';
import Link from 'next/link';

type InsuranceFormValues = {
  payerName: string;
  memberId: string;
  groupId?: string;
  subscriberName?: string;
  employerName?: string;
  priority: string;
  effectiveStart: string;
  effectiveEnd?: string;
  lastVerifiedAt?: string;
  copayAmount?: string;
};

export default function InsuranceForm({
  mode,
  patientId,
  policyId,
  initialValues
}: {
  mode: 'create' | 'edit';
  patientId: string;
  policyId?: string;
  initialValues?: Partial<InsuranceFormValues>;
}) {
  const [payerName, setPayerName] = useState(initialValues?.payerName ?? '');
  const [memberId, setMemberId] = useState(initialValues?.memberId ?? '');
  const [groupId, setGroupId] = useState(initialValues?.groupId ?? '');
  const [subscriberName, setSubscriberName] = useState(initialValues?.subscriberName ?? '');
  const [employerName, setEmployerName] = useState(initialValues?.employerName ?? '');
  const [priority, setPriority] = useState(initialValues?.priority ?? 'PRIMARY');
  const [effectiveStart, setEffectiveStart] = useState(initialValues?.effectiveStart ?? '');
  const [effectiveEnd, setEffectiveEnd] = useState(initialValues?.effectiveEnd ?? '');
  const [lastVerifiedAt, setLastVerifiedAt] = useState(initialValues?.lastVerifiedAt ?? '');
  const [copayAmount, setCopayAmount] = useState(initialValues?.copayAmount ?? '');
  const [status, setStatus] = useState<string | null>(null);
  const canSubmit = payerName.trim().length > 1 && memberId.trim().length > 1 && effectiveStart.trim().length > 0;

  const submit = async () => {
    setStatus(null);
    const endpoint = mode === 'edit' ? '/api/insurance/update' : '/api/insurance/create';
    const payload = {
      policyId,
      patientId,
      payerName,
      memberId,
      groupId: groupId || undefined,
      subscriberName: subscriberName || undefined,
      employerName: employerName || undefined,
      priority,
      effectiveStart,
      effectiveEnd: effectiveEnd || undefined,
      lastVerifiedAt: lastVerifiedAt || undefined,
      copayAmount: copayAmount || undefined
    };

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const data = await response.json();
      setStatus(data.error ?? 'Unable to save policy.');
      return;
    }

    setStatus('Insurance saved. Any impacted past visit was flagged for review.');
  };

  return (
    <div className="card" style={{ display: 'grid', gap: 12 }}>
      <div className="badge">Insurance details</div>
      <label>
        <div className="text-muted" style={{ marginBottom: 6 }}>
          Payer name
        </div>
        <input className="input" value={payerName} onChange={(event) => setPayerName(event.target.value)} />
      </label>
      <label>
        <div className="text-muted" style={{ marginBottom: 6 }}>
          Member ID
        </div>
        <input className="input" value={memberId} onChange={(event) => setMemberId(event.target.value)} />
      </label>
      <label>
        <div className="text-muted" style={{ marginBottom: 6 }}>
          Group ID (optional)
        </div>
        <input className="input" value={groupId} onChange={(event) => setGroupId(event.target.value)} />
      </label>
      <label>
        <div className="text-muted" style={{ marginBottom: 6 }}>
          Subscriber name (optional)
        </div>
        <input
          className="input"
          value={subscriberName}
          onChange={(event) => setSubscriberName(event.target.value)}
        />
      </label>
      <label>
        <div className="text-muted" style={{ marginBottom: 6 }}>
          Employer name (optional)
        </div>
        <input
          className="input"
          value={employerName}
          onChange={(event) => setEmployerName(event.target.value)}
          placeholder="Employer tied to this plan"
        />
      </label>
      <label>
        <div className="text-muted" style={{ marginBottom: 6 }}>
          Priority
        </div>
        <select className="input" value={priority} onChange={(event) => setPriority(event.target.value)}>
          <option value="PRIMARY">Primary</option>
          <option value="SECONDARY">Secondary</option>
          <option value="TERTIARY">Tertiary</option>
        </select>
      </label>
      <label>
        <div className="text-muted" style={{ marginBottom: 6 }}>
          Effective start
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
          Effective end (optional)
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
          Last verified (optional)
        </div>
        <input
          className="input"
          type="date"
          value={lastVerifiedAt}
          onChange={(event) => setLastVerifiedAt(event.target.value)}
        />
      </label>
      <label>
        <div className="text-muted" style={{ marginBottom: 6 }}>
          Copay amount (optional)
        </div>
        <input
          className="input"
          type="number"
          min="0"
          step="0.01"
          placeholder="e.g., 25.00"
          value={copayAmount}
          onChange={(event) => setCopayAmount(event.target.value)}
        />
      </label>
      <div className="text-muted" style={{ fontSize: 12 }}>
        Policies require re-verification after 12 months from the effective or last verified date. Changes do not alter
        existing claims. Past visits within the effective range will be flagged for review. You can also use the
        one-click re-verification action on the patient insurance panel.
      </div>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        <button className="button" type="button" onClick={submit} disabled={!canSubmit}>
          {mode === 'edit' ? 'Save insurance' : 'Add insurance'}
        </button>
        <Link className="button secondary" href={`/patients/${patientId}`}>
          Back to patient
        </Link>
      </div>
      {status ? <div className="text-muted">{status}</div> : null}
    </div>
  );
}
