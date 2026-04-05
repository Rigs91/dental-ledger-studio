'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { formatCurrency } from '@/shared/domain/format';

type PatientPaymentFormProps = {
  claimId: string;
  balanceDue: number;
  expectedCopay?: number | null;
  selfPay?: boolean;
  billingHold?: {
    active: boolean;
    message: string;
  };
};

const DEFAULT_CATEGORY = (selfPay?: boolean) => (selfPay ? 'SELF_PAY' : 'OTHER');

export default function PatientPaymentForm({
  claimId,
  balanceDue,
  expectedCopay,
  selfPay,
  billingHold
}: PatientPaymentFormProps) {
  const router = useRouter();
  const [amount, setAmount] = useState('');
  const [occurredAt, setOccurredAt] = useState(() => new Date().toISOString().slice(0, 10));
  const [category, setCategory] = useState<'COPAY' | 'SELF_PAY' | 'OTHER'>(DEFAULT_CATEGORY(selfPay));
  const [note, setNote] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [overrideHold, setOverrideHold] = useState(false);

  const normalizedBalance = useMemo(() => (balanceDue > 0.005 ? balanceDue : 0), [balanceDue]);
  const canPay = normalizedBalance > 0;
  const canSubmit = canPay && (!billingHold?.active || overrideHold);

  const applyBalance = () => {
    if (!canPay) {
      return;
    }
    setAmount(normalizedBalance.toFixed(2));
  };

  const submit = async () => {
    setStatus(null);
    if (billingHold?.active && !overrideHold) {
      setStatus('Payment is on hold while the resubmitted claim is pending.');
      return;
    }
    const parsedAmount = Number(amount);
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      setStatus('Enter a valid payment amount greater than 0.');
      return;
    }
    if (!occurredAt) {
      setStatus('Select a payment date.');
      return;
    }

    setLoading(true);
    const response = await fetch('/api/payments/patient', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        claimId,
        amount: parsedAmount,
        occurredAt,
        category,
        note: note.trim()
      })
    });
    setLoading(false);

    if (!response.ok) {
      const data = await response.json();
      setStatus(data.error ?? 'Unable to record payment.');
      return;
    }

    setAmount('');
    setNote('');
    setStatus('Payment recorded.');
    router.refresh();
  };

  return (
    <div className="card" style={{ display: 'grid', gap: 12 }}>
      <div className="badge">Record patient payment</div>
      <div style={{ fontWeight: 600 }}>Balance due: {formatCurrency(balanceDue)}</div>
      {expectedCopay ? (
        <div className="text-muted" style={{ fontSize: 13 }}>
          Expected copay: {formatCurrency(expectedCopay)}
        </div>
      ) : null}
      {!canPay ? (
        <div className="text-muted">
          {balanceDue < -0.005
            ? `Credit balance: ${formatCurrency(Math.abs(balanceDue))}. Refund or apply to a future visit.`
            : 'No balance due right now.'}
        </div>
      ) : (
        <>
          {billingHold?.active ? (
            <div className="card" style={{ padding: 12, borderColor: 'rgba(245, 158, 11, 0.4)' }}>
              <div style={{ fontWeight: 600 }}>Resubmission in progress</div>
              <div className="text-muted" style={{ marginTop: 6 }}>
                {billingHold.message}
              </div>
              <label style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                <input
                  type="checkbox"
                  checked={overrideHold}
                  onChange={(event) => setOverrideHold(event.target.checked)}
                />
                Record patient payment anyway
              </label>
            </div>
          ) : null}
          <label>
            <div className="text-muted" style={{ marginBottom: 6 }}>
              Payment amount
            </div>
            <input
              className="input"
              type="number"
              min="0"
              step="0.01"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              placeholder="0.00"
            />
          </label>
          <button className="button secondary" type="button" onClick={applyBalance}>
            Apply remaining balance
          </button>
          <label>
            <div className="text-muted" style={{ marginBottom: 6 }}>
              Payment date
            </div>
            <input
              className="input"
              type="date"
              value={occurredAt}
              onChange={(event) => setOccurredAt(event.target.value)}
            />
          </label>
          <label>
            <div className="text-muted" style={{ marginBottom: 6 }}>
              Payment category
            </div>
            <select
              className="input"
              value={category}
              onChange={(event) => setCategory(event.target.value as 'COPAY' | 'SELF_PAY' | 'OTHER')}
            >
              <option value="COPAY">Copay</option>
              <option value="SELF_PAY">Self-pay</option>
              <option value="OTHER">Other patient payment</option>
            </select>
          </label>
          <label>
            <div className="text-muted" style={{ marginBottom: 6 }}>
              Note (optional)
            </div>
            <textarea className="input" value={note} onChange={(event) => setNote(event.target.value)} />
          </label>
      <button className="button" type="button" onClick={submit} disabled={loading || !canSubmit}>
        Record payment
      </button>
          {status ? <div className="text-muted">{status}</div> : null}
        </>
      )}
    </div>
  );
}

