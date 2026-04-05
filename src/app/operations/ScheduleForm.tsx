'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function ScheduleForm({
  patients,
  defaultDate
}: {
  patients: { id: string; name: string }[];
  defaultDate?: string;
}) {
  const router = useRouter();
  const [patientId, setPatientId] = useState(patients[0]?.id ?? '');
  const [scheduledAt, setScheduledAt] = useState(defaultDate ?? '');
  const [plannedProcedures, setPlannedProcedures] = useState('');
  const [status, setStatus] = useState<string | null>(null);

  if (patients.length === 0) {
    return (
      <div className="card">
        <div className="badge">Schedule appointment</div>
        <div className="text-muted" style={{ marginTop: 12 }}>
          No patients on file yet. Create a patient record from intake first.
        </div>
      </div>
    );
  }

  const submit = async () => {
    setStatus(null);
    const response = await fetch('/api/appointments/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ patientId, scheduledAt, plannedProcedures })
    });

    if (!response.ok) {
      const data = await response.json();
      setStatus(data.error ?? 'Unable to schedule appointment.');
      return;
    }

    setStatus('Appointment scheduled.');
    setPlannedProcedures('');
    router.refresh();
  };

  return (
    <div className="card" style={{ display: 'grid', gap: 12 }}>
      <div className="badge">Schedule appointment</div>
      <label>
        <div className="text-muted" style={{ marginBottom: 6 }}>
          Patient
        </div>
        <select
          className="input"
          value={patientId}
          onChange={(event) => setPatientId(event.target.value)}
          suppressHydrationWarning
        >
          {patients.map((patient) => (
            <option key={patient.id} value={patient.id}>
              {patient.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        <div className="text-muted" style={{ marginBottom: 6 }}>
          Date and time
        </div>
        <input
          className="input"
          type="datetime-local"
          value={scheduledAt}
          onChange={(event) => setScheduledAt(event.target.value)}
          suppressHydrationWarning
        />
      </label>
      <label>
        <div className="text-muted" style={{ marginBottom: 6 }}>
          Planned procedures
        </div>
        <textarea
          className="input"
          style={{ minHeight: 100 }}
          value={plannedProcedures}
          onChange={(event) => setPlannedProcedures(event.target.value)}
          suppressHydrationWarning
        />
      </label>
      <button className="button" type="button" onClick={submit} disabled={!patientId}>
        Schedule appointment
      </button>
      {status ? <div className="text-muted">{status}</div> : null}
    </div>
  );
}
