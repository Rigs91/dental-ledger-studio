'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function CheckInButton({ appointmentId }: { appointmentId: string }) {
  const router = useRouter();
  const [status, setStatus] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const checkIn = async () => {
    setStatus(null);
    setIsSaving(true);
    try {
      const response = await fetch('/api/appointments/check-in', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appointmentId })
      });
      if (!response.ok) {
        let message = `Unable to check in (status ${response.status}).`;
        try {
          const data = await response.json();
          message = data.error ?? message;
        } catch {
          // ignore parse errors
        }
        setStatus(message);
        return;
      }
      setStatus('Checked in.');
      router.refresh();
    } catch {
      setStatus('Unable to check in. Try again.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div style={{ display: 'grid', gap: 6 }}>
      <button className="button" type="button" onClick={checkIn} disabled={isSaving}>
        {isSaving ? 'Checking in...' : 'Check in'}
      </button>
      {status ? <div className="text-muted" style={{ fontSize: 12 }}>{status}</div> : null}
    </div>
  );
}
