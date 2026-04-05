'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function ReverifyInsuranceButton({
  policyId,
  payerName,
  compact = false
}: {
  policyId: string;
  payerName?: string;
  compact?: boolean;
}) {
  const router = useRouter();
  const [working, setWorking] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const submit = async () => {
    setWorking(true);
    setStatus(null);

    try {
      const response = await fetch('/api/insurance/reverify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ policyId })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setStatus(data.error ?? 'Unable to re-verify policy.');
        setWorking(false);
        return;
      }
      setStatus('Policy re-verified.');
      router.refresh();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Unable to re-verify policy.');
    } finally {
      setWorking(false);
    }
  };

  return (
    <div style={{ display: 'grid', gap: 6 }}>
      <button className="button secondary" type="button" onClick={submit} disabled={working}>
        {working
          ? 'Re-verifying...'
          : compact
          ? `Re-verify ${payerName ?? 'policy'}`
          : 'Re-verify policy now'}
      </button>
      {status ? <div className="text-muted" style={{ fontSize: 12 }}>{status}</div> : null}
    </div>
  );
}
