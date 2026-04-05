'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

const toValue = (value?: string | null) => value ?? '';

export default function NewPatientForm() {
  const router = useRouter();
  const [firstName, setFirstName] = useState('');
  const [middleName, setMiddleName] = useState('');
  const [lastName, setLastName] = useState('');
  const [dob, setDob] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [addressLine1, setAddressLine1] = useState('');
  const [addressLine2, setAddressLine2] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [postalCode, setPostalCode] = useState('');
  const [ssn, setSsn] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const canSubmit = firstName.trim().length > 0 && lastName.trim().length > 0 && dob.trim().length > 0;

  const submit = async () => {
    setStatus(null);
    const payload = {
      firstName,
      middleName: toValue(middleName) || undefined,
      lastName,
      dob,
      phone: toValue(phone) || undefined,
      email: toValue(email) || undefined,
      addressLine1: toValue(addressLine1) || undefined,
      addressLine2: toValue(addressLine2) || undefined,
      city: toValue(city) || undefined,
      state: toValue(state) || undefined,
      postalCode: toValue(postalCode) || undefined,
      ssn: toValue(ssn) || undefined
    };

    const response = await fetch('/api/patients/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const data = await response.json();
      setStatus(data.error ?? 'Unable to create patient.');
      return;
    }

    const data = await response.json();
    setStatus('Patient created.');
    router.push(`/patients/${data.patientId}`);
  };

  return (
    <div className="card" style={{ display: 'grid', gap: 12 }}>
      <div className="badge">Patient demographics</div>
      <label>
        <div className="text-muted" style={{ marginBottom: 6 }}>
          First name
        </div>
        <input className="input" value={firstName} onChange={(event) => setFirstName(event.target.value)} />
      </label>
      <label>
        <div className="text-muted" style={{ marginBottom: 6 }}>
          Middle name
        </div>
        <input className="input" value={middleName} onChange={(event) => setMiddleName(event.target.value)} />
      </label>
      <label>
        <div className="text-muted" style={{ marginBottom: 6 }}>
          Last name
        </div>
        <input className="input" value={lastName} onChange={(event) => setLastName(event.target.value)} />
      </label>
      <label>
        <div className="text-muted" style={{ marginBottom: 6 }}>
          Date of birth
        </div>
        <input className="input" type="date" value={dob} onChange={(event) => setDob(event.target.value)} />
      </label>
      <label>
        <div className="text-muted" style={{ marginBottom: 6 }}>
          Phone
        </div>
        <input className="input" value={phone} onChange={(event) => setPhone(event.target.value)} />
      </label>
      <label>
        <div className="text-muted" style={{ marginBottom: 6 }}>
          Email
        </div>
        <input className="input" value={email} onChange={(event) => setEmail(event.target.value)} />
      </label>
      <label>
        <div className="text-muted" style={{ marginBottom: 6 }}>
          Address line 1
        </div>
        <input className="input" value={addressLine1} onChange={(event) => setAddressLine1(event.target.value)} />
      </label>
      <label>
        <div className="text-muted" style={{ marginBottom: 6 }}>
          Address line 2
        </div>
        <input className="input" value={addressLine2} onChange={(event) => setAddressLine2(event.target.value)} />
      </label>
      <label>
        <div className="text-muted" style={{ marginBottom: 6 }}>
          City
        </div>
        <input className="input" value={city} onChange={(event) => setCity(event.target.value)} />
      </label>
      <label>
        <div className="text-muted" style={{ marginBottom: 6 }}>
          State
        </div>
        <input className="input" value={state} onChange={(event) => setState(event.target.value)} />
      </label>
      <label>
        <div className="text-muted" style={{ marginBottom: 6 }}>
          Postal code
        </div>
        <input className="input" value={postalCode} onChange={(event) => setPostalCode(event.target.value)} />
      </label>
      <label>
        <div className="text-muted" style={{ marginBottom: 6 }}>
          Social Security (4 or 9 digits)
        </div>
        <input className="input" value={ssn} onChange={(event) => setSsn(event.target.value)} />
      </label>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        <button className="button" type="button" onClick={submit} disabled={!canSubmit}>
          Create patient
        </button>
        <Link className="button secondary" href="/patients">
          Back to patient search
        </Link>
      </div>
      {status ? <div className="text-muted">{status}</div> : null}
    </div>
  );
}
