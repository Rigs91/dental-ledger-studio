'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

type PatientDemographics = {
  firstName: string;
  middleName?: string | null;
  lastName: string;
  phone?: string | null;
  email?: string | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  ssn?: string | null;
};

const toValue = (value?: string | null) => value ?? '';

export default function PatientDemographicsForm({
  patientId,
  initialValues
}: {
  patientId: string;
  initialValues: PatientDemographics;
}) {
  const router = useRouter();
  const [firstName, setFirstName] = useState(initialValues.firstName);
  const [middleName, setMiddleName] = useState(toValue(initialValues.middleName));
  const [lastName, setLastName] = useState(initialValues.lastName);
  const [phone, setPhone] = useState(toValue(initialValues.phone));
  const [email, setEmail] = useState(toValue(initialValues.email));
  const [addressLine1, setAddressLine1] = useState(toValue(initialValues.addressLine1));
  const [addressLine2, setAddressLine2] = useState(toValue(initialValues.addressLine2));
  const [city, setCity] = useState(toValue(initialValues.city));
  const [state, setState] = useState(toValue(initialValues.state));
  const [postalCode, setPostalCode] = useState(toValue(initialValues.postalCode));
  const [ssn, setSsn] = useState(toValue(initialValues.ssn));
  const [status, setStatus] = useState<string | null>(null);
  const canSubmit = firstName.trim().length > 0 && lastName.trim().length > 0;

  const submit = async () => {
    setStatus(null);
    const payload = {
      patientId,
      firstName,
      middleName: middleName || undefined,
      lastName,
      phone: phone || undefined,
      email: email || undefined,
      addressLine1: addressLine1 || undefined,
      addressLine2: addressLine2 || undefined,
      city: city || undefined,
      state: state || undefined,
      postalCode: postalCode || undefined,
      ssn: ssn || undefined
    };

    const response = await fetch('/api/patients/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const data = await response.json();
      setStatus(data.error ?? 'Unable to update patient profile.');
      return;
    }

    setStatus('Patient profile updated.');
    router.refresh();
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
          Save profile
        </button>
        <Link className="button secondary" href={`/patients/${patientId}`}>
          Back to patient
        </Link>
      </div>
      {status ? <div className="text-muted">{status}</div> : null}
    </div>
  );
}
