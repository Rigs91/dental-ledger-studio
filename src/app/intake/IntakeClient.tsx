'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { formatCurrency, formatDate } from '@/shared/domain/format';
import { formatDateInput, parseFlexibleDate } from '@/shared/validation/date';

type CandidateCode = {
  code: string;
  label: string;
  confidence: number;
  rationale: string;
  suggested?: boolean;
  category?: string;
  notes?: string;
  patientDescription?: string;
  estimatedCopay?: number;
  copayRate?: number;
  copayBasis?: string;
  matchSource?: 'code' | 'description' | 'notes' | 'patientDescription' | 'category';
};

type ConfidenceFactor = {
  name: string;
  rawValue: number;
  normalizedValue: number;
  weight: number;
  contribution: number;
};

type ProcedureConfidence = {
  confidenceScore: number;
  confidenceLevel: 'high' | 'medium' | 'low';
  factors: ConfidenceFactor[];
  explanation: string;
};

type ProcedurePreview = {
  freeText: string;
  normalizedText: string;
  confidence: number;
  rationale: string;
  candidateCodes: CandidateCode[];
  needsConfirmation: boolean;
  clarifyingQuestion?: string;
  confidenceDetails?: ProcedureConfidence;
};

type InsurancePolicy = {
  id: string;
  payerName: string;
  memberId: string;
  groupId?: string | null;
  priority: string;
  effectiveStart: string;
  effectiveEnd?: string | null;
  subscriberName?: string | null;
  employerName?: string | null;
  lastVerifiedAt?: string | null;
  copayAmount?: string | null;
};

type InsuranceSelection = {
  activePolicies: InsurancePolicy[];
  selectedPolicy: InsurancePolicy | null;
  needsConfirmation: boolean;
  reason: string;
  warnings: string[];
};

type PreviewResponse = {
  patientMatchStatus: 'found' | 'ambiguous' | 'not_found';
  patientOptions: { id: string; name: string; dob: string; policies: InsurancePolicy[] }[];
  procedures: ProcedurePreview[];
  insuranceSelection: InsuranceSelection;
};

type IntakeDefaults = {
  appointmentId?: string;
  patientId?: string;
  patientName?: string;
  dob?: string;
  dateOfService?: string;
  proceduresText?: string;
  appointmentNote?: string;
};

type NewInsuranceDraft = {
  payerName: string;
  memberId: string;
  groupId: string;
  subscriberName: string;
  employerName: string;
  priority: string;
  effectiveStart: string;
  effectiveEnd: string;
  lastVerifiedAt: string;
  copayAmount: string;
};

type InsuranceChoice = 'insurance' | 'self-pay' | 'add-insurance';

const formatMatchSource = (source?: CandidateCode['matchSource']) => {
  switch (source) {
    case 'patientDescription':
      return 'patient description';
    case 'description':
      return 'procedure description';
    case 'notes':
      return 'notes';
    case 'category':
      return 'category';
    case 'code':
      return 'CDT code';
    default:
      return 'catalog';
  }
};

export default function IntakeClient({ initialData }: { initialData?: IntakeDefaults }) {
  const [patientName, setPatientName] = useState(initialData?.patientName ?? '');
  const [dob, setDob] = useState(initialData?.dob ?? '');
  const [dateOfService, setDateOfService] = useState(initialData?.dateOfService ?? '');
  const [proceduresText, setProceduresText] = useState(initialData?.proceduresText ?? '');
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [selectedPatientId, setSelectedPatientId] = useState<string | null>(initialData?.patientId ?? null);
  const [createPatient, setCreatePatient] = useState(false);
  const [selectedCodes, setSelectedCodes] = useState<Record<number, string>>({});
  const [overrideCodes, setOverrideCodes] = useState<Record<number, { code: string; label: string }>>(
    {}
  );
  const [insurancePolicyId, setInsurancePolicyId] = useState<string | null>(null);
  const [selfPayConfirmed, setSelfPayConfirmed] = useState(false);
  const [insuranceChoice, setInsuranceChoice] = useState<InsuranceChoice>('insurance');
  const [insuranceReason, setInsuranceReason] = useState('');
  const [copayCollected, setCopayCollected] = useState(false);
  const [addInsuranceNow, setAddInsuranceNow] = useState(false);
  const [insuranceDraftStatus, setInsuranceDraftStatus] = useState<string | null>(null);
  const [insuranceDraftSavedAt, setInsuranceDraftSavedAt] = useState<string | null>(null);
  const [newInsurance, setNewInsurance] = useState<NewInsuranceDraft>({
    payerName: '',
    memberId: '',
    groupId: '',
    subscriberName: '',
    employerName: '',
    priority: 'PRIMARY',
    effectiveStart: '',
    effectiveEnd: '',
    lastVerifiedAt: '',
    copayAmount: ''
  });
  const [status, setStatus] = useState<string | null>(null);
  const [result, setResult] = useState<{ claimId: string; patientId: string } | null>(null);
  const [previewStatus, setPreviewStatus] = useState<string | null>(null);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);
  const appointmentId = initialData?.appointmentId ?? null;
  const appointmentPatientId = initialData?.patientId ?? null;
  const lastAppointmentId = useRef<string | null>(null);
  const newInsuranceCopay = Number(newInsurance.copayAmount);
  const showNewInsuranceCopay =
    newInsurance.copayAmount.trim().length > 0 && !Number.isNaN(newInsuranceCopay);
  const requiredFields = [
    { id: 'patient-name', label: 'Patient name', value: patientName.trim() },
    { id: 'dob', label: 'Date of birth', value: dob.trim() },
    { id: 'dos', label: 'Date of service', value: dateOfService.trim() },
    { id: 'procedures', label: 'Procedures', value: proceduresText.trim() }
  ];
  const missingFields = requiredFields.filter((field) => field.value.length === 0);
  const isPreviewReady = missingFields.length === 0;
  const activePolicies = preview?.insuranceSelection.activePolicies ?? [];
  const selectedPolicy =
    activePolicies.find((policy) => policy.id === insurancePolicyId) ??
    preview?.insuranceSelection.selectedPolicy ??
    null;
  const resolvedPatientOption = preview
    ? preview.patientOptions.find((option) => option.id === (selectedPatientId ?? appointmentPatientId ?? ''))
    : undefined;
  const policiesOnFile =
    preview?.patientMatchStatus === 'found'
      ? preview.patientOptions[0]?.policies ?? []
      : resolvedPatientOption?.policies ?? [];
  const inactivePolicies = policiesOnFile.filter(
    (policy) => !activePolicies.some((active) => active.id === policy.id)
  );
  const hasActivePolicies = activePolicies.length > 0 || !!preview?.insuranceSelection.selectedPolicy;
  const canAddInsurance = preview ? preview.patientMatchStatus !== 'ambiguous' : false;

  useEffect(() => {
    if (appointmentId === lastAppointmentId.current) {
      return;
    }
    lastAppointmentId.current = appointmentId;
    setPatientName(initialData?.patientName ?? '');
    setDob(initialData?.dob ?? '');
    setDateOfService(initialData?.dateOfService ?? '');
    setProceduresText(initialData?.proceduresText ?? '');
    setSelectedPatientId(initialData?.patientId ?? null);
    setCreatePatient(false);
    setPreview(null);
    setPreviewStatus(null);
    setStatus(null);
    setResult(null);
    setSelectedCodes({});
    setOverrideCodes({});
    setInsurancePolicyId(null);
    setInsuranceChoice('insurance');
    setInsuranceReason('');
    setSelfPayConfirmed(false);
    setAddInsuranceNow(false);
    setCopayCollected(false);
    setNewInsurance({
      payerName: '',
      memberId: '',
      groupId: '',
      subscriberName: '',
      employerName: '',
      priority: 'PRIMARY',
      effectiveStart: '',
      effectiveEnd: '',
      lastVerifiedAt: '',
      copayAmount: ''
    });
    setInsuranceDraftStatus(null);
    setInsuranceDraftSavedAt(null);
  }, [appointmentId, initialData?.patientId, initialData?.patientName, initialData?.dob, initialData?.dateOfService, initialData?.proceduresText]);

  const getInsuranceDraftKey = () => {
    const base =
      appointmentId ??
      selectedPatientId ??
      (patientName.trim().length > 0 && dob.trim().length > 0 ? `${patientName.trim()}|${dob.trim()}` : 'unknown');
    return `intake:insurance-draft:${base}`;
  };

  const saveInsuranceDraft = () => {
    setInsuranceDraftStatus(null);
    if (!addInsuranceNow || insuranceChoice !== 'add-insurance') {
      setInsuranceDraftStatus('Select "Add insurance now" to save this draft.');
      return;
    }
    if (
      newInsurance.payerName.trim().length === 0 ||
      newInsurance.memberId.trim().length === 0 ||
      newInsurance.effectiveStart.trim().length === 0
    ) {
      setInsuranceDraftStatus('Complete payer name, member ID, and effective start before saving.');
      return;
    }
    if (typeof window === 'undefined') {
      setInsuranceDraftStatus('Unable to save draft in this environment.');
      return;
    }
    const timestamp = new Date().toISOString();
    const payload = {
      ...newInsurance,
      savedAt: timestamp,
      context: {
        appointmentId,
        patientId: appointmentPatientId ?? selectedPatientId ?? null,
        patientName: patientName.trim(),
        dob: dob.trim()
      }
    };
    try {
      window.sessionStorage.setItem(getInsuranceDraftKey(), JSON.stringify(payload));
      setInsuranceDraftSavedAt(timestamp);
      setInsuranceDraftStatus('Insurance draft saved.');
    } catch {
      setInsuranceDraftStatus('Unable to save draft in this browser session.');
    }
  };

  const normalizeDateField = (value: string, setter: (value: string) => void) => {
    const parsed = parseFlexibleDate(value, { allowAmbiguous: true });
    if (parsed.date) {
      setter(formatDateInput(parsed.date));
    }
  };

  const runPreview = async (resolvedPatientId?: string | null) => {
    setStatus(null);
    setPreviewStatus(null);
    setResult(null);
    if (!isPreviewReady) {
      setPreviewStatus(
        `Missing required fields: ${missingFields.map((field) => field.label).join(', ')}.`
      );
      return;
    }

    setIsPreviewing(true);
    try {
      const payload = {
        patientName,
        dob,
        dateOfService,
        proceduresText,
        ...(resolvedPatientId ? { patientId: resolvedPatientId } : {})
      };
      const response = await fetch('/api/intake/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const data = await response.json();
        setPreviewStatus(data.error ?? 'Preview failed.');
        return;
      }

      const data = (await response.json()) as PreviewResponse;
      setPreview(data);

      if (appointmentId && appointmentPatientId) {
        setSelectedPatientId(appointmentPatientId);
        setCreatePatient(false);
      } else if (data.patientMatchStatus === 'found') {
        setSelectedPatientId(data.patientOptions[0]?.id ?? null);
        setCreatePatient(false);
      } else if (data.patientMatchStatus === 'ambiguous') {
        setSelectedPatientId(null);
        setCreatePatient(false);
      } else {
        setSelectedPatientId(null);
        setCreatePatient(false);
      }

      const initialCodes: Record<number, string> = {};
      data.procedures.forEach((procedure, index) => {
        if (procedure.needsConfirmation) {
          initialCodes[index] = '';
          return;
        }
        const suggested = procedure.candidateCodes.find((code) => code.suggested);
        initialCodes[index] = suggested?.code ?? procedure.candidateCodes[0]?.code ?? '';
      });
      setSelectedCodes(initialCodes);
      setOverrideCodes({});

      if (data.insuranceSelection.needsConfirmation) {
        setInsurancePolicyId(null);
      } else {
        setInsurancePolicyId(data.insuranceSelection.selectedPolicy?.id ?? null);
      }
      const activePolicyAvailable = data.insuranceSelection.activePolicies.length > 0;
      const patientResolved = data.patientMatchStatus !== 'ambiguous';
      if (activePolicyAvailable || data.insuranceSelection.selectedPolicy) {
        setInsuranceChoice('insurance');
        setSelfPayConfirmed(false);
        setAddInsuranceNow(false);
      } else {
        const choice: InsuranceChoice = addInsuranceNow ? 'add-insurance' : 'self-pay';
        setInsuranceChoice(choice);
        setSelfPayConfirmed(choice === 'self-pay' && patientResolved);
      }
      setInsuranceReason((current) => {
        if (addInsuranceNow) {
          return current.trim().length > 0 ? current : 'New insurance captured during intake.';
        }
        if (!activePolicyAvailable) {
          if (current.trim().length > 0) {
            return current;
          }
          return patientResolved ? 'Self-pay confirmed by staff.' : data.insuranceSelection.reason;
        }
        return data.insuranceSelection.reason;
      });
      setCopayCollected(false);
      setInsuranceDraftStatus(null);
    } catch {
      setPreviewStatus('Unable to reach the preview service. Check the server and try again.');
    } finally {
      setIsPreviewing(false);
    }
  };

  const getConfirmIssues = () => {
    if (!preview) {
      return ['Run Analyze and preview before confirming.'];
    }
    const issues: string[] = [];
    const addInsuranceActive = addInsuranceNow && canAddInsurance;
    const newInsuranceReady =
      addInsuranceActive &&
      newInsurance.payerName.trim().length > 1 &&
      newInsurance.memberId.trim().length > 1 &&
      newInsurance.effectiveStart.trim().length > 0;
    if (preview.patientMatchStatus === 'ambiguous' && !selectedPatientId) {
      issues.push('Select the correct patient match.');
    }
    if (preview.patientMatchStatus === 'not_found' && !createPatient && !appointmentPatientId) {
      issues.push('Confirm creation of the new patient record.');
    }
    preview.procedures.forEach((procedure, index) => {
      const override = overrideCodes[index];
      const selected = selectedCodes[index];
      if (procedure.candidateCodes.length === 0 && !override?.code) {
        issues.push(`Add an override code for "${procedure.freeText}".`);
      }
      if (!override?.code && procedure.candidateCodes.length > 0 && !selected) {
        issues.push(`Select a code for "${procedure.freeText}".`);
      }
      if (override?.code && override.code.trim().length < 4) {
        issues.push(`Provide a valid override code for "${procedure.freeText}".`);
      }
    });
    if (hasActivePolicies) {
      if (preview.insuranceSelection.needsConfirmation && !insurancePolicyId) {
        issues.push('Select the insurance policy used for this claim.');
      }
    } else {
      if (insuranceChoice === 'add-insurance') {
        if (!newInsuranceReady) {
          issues.push('Complete the new insurance details or switch to self-pay.');
        }
      } else if (!selfPayConfirmed) {
        issues.push('Confirm the visit is self-pay or add new insurance details.');
      }
    }
    if (addInsuranceActive && !newInsuranceReady) {
      issues.push('Complete the new insurance details or switch to self-pay.');
    }
    if (!insuranceReason.trim()) {
      issues.push('Provide an insurance selection rationale.');
    }
    return Array.from(new Set(issues));
  };

  const confirmIssues = preview ? getConfirmIssues() : [];
  const canConfirm = confirmIssues.length === 0;

  const confirmIntake = async () => {
    if (!preview) return;
    setStatus(null);
    setIsConfirming(true);
    const resolvedPatientId = appointmentPatientId ?? selectedPatientId;
    const shouldCreatePatient = preview.patientMatchStatus === 'not_found' && !appointmentPatientId;
    const includeNewInsurance =
      addInsuranceNow &&
      canAddInsurance &&
      newInsurance.payerName.trim().length > 1 &&
      newInsurance.memberId.trim().length > 1 &&
      newInsurance.effectiveStart.trim().length > 0;
    const payload = {
      appointmentId: appointmentId ?? undefined,
      patientId: shouldCreatePatient ? undefined : resolvedPatientId ?? undefined,
      newPatient:
        shouldCreatePatient
          ? {
              firstName: patientName.split(' ')[0] ?? patientName,
              lastName: patientName.split(' ').slice(1).join(' '),
              dob
            }
          : undefined,
      dateOfService,
      procedures: preview.procedures.map((procedure, index) => {
        const override = overrideCodes[index];
        const overrideCode = override?.code?.trim();
        const selectedCode = overrideCode ? overrideCode : selectedCodes[index];
        const selected = procedure.candidateCodes.find((code) => code.code === selectedCode);
        return {
          ...procedure,
          selectedCode,
          selectedLabel: override?.label?.trim() || selected?.label || selectedCode
        };
      }),
      insurancePolicyId: insurancePolicyId ?? undefined,
      insuranceReason,
      selfPayConfirmed,
      copayCollected,
      newInsurance:
        includeNewInsurance
          ? {
              payerName: newInsurance.payerName.trim(),
              memberId: newInsurance.memberId.trim(),
              groupId: newInsurance.groupId.trim() || undefined,
              subscriberName: newInsurance.subscriberName.trim() || undefined,
              employerName: newInsurance.employerName.trim() || undefined,
              priority: newInsurance.priority,
              effectiveStart: newInsurance.effectiveStart,
              effectiveEnd: newInsurance.effectiveEnd.trim() || undefined,
              lastVerifiedAt: newInsurance.lastVerifiedAt.trim() || undefined,
              copayAmount: newInsurance.copayAmount.trim() || undefined
            }
          : undefined
    };

    try {
      const response = await fetch('/api/intake/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (response.status === 409) {
        const data = await response.json();
        setStatus(data.error ?? 'Insurance confirmation required.');
        return;
      }

      if (!response.ok) {
        const data = await response.json();
        setStatus(data.error ?? 'Unable to confirm intake.');
        return;
      }

      const data = await response.json();
      setResult(data);
      setStatus('Intake confirmed and claim created.');
    } catch {
      setStatus('Unable to reach the confirmation service. Check the server and try again.');
    } finally {
      setIsConfirming(false);
    }
  };

  return (
    <div style={{ display: 'grid', gap: 20 }}>
      <div className="section-overview">
        <div className="card">
          <div className="badge">Visit intake</div>
          <div className="text-muted" style={{ marginTop: 8 }}>
            Step 1 of 3: capture visit details and describe procedures. Required fields are marked with *.
          </div>
          {appointmentId ? (
            <div className="badge" style={{ marginTop: 12, background: 'rgba(45, 212, 191, 0.2)' }}>
              Appointment context loaded
            </div>
          ) : null}
          {initialData?.appointmentNote ? (
            <div className="text-muted" style={{ marginTop: 8 }}>
              {initialData.appointmentNote}
            </div>
          ) : null}
          <div style={{ display: 'grid', gap: 12, marginTop: 16 }}>
            <label>
              <div className="text-muted" style={{ marginBottom: 6 }}>
                Patient name *
              </div>
              <input
                className="input"
                placeholder="Jane Doe"
                value={patientName}
                onChange={(event) => setPatientName(event.target.value)}
              />
            </label>
            <label>
              <div className="text-muted" style={{ marginBottom: 6 }}>
                Date of birth * (YYYY-MM-DD, MM/DD/YYYY, or Jan 2 2026)
              </div>
              <input
                className="input"
                placeholder="1985-07-14"
                value={dob}
                onChange={(event) => setDob(event.target.value)}
                onBlur={(event) => normalizeDateField(event.target.value, setDob)}
              />
            </label>
            <label>
              <div className="text-muted" style={{ marginBottom: 6 }}>
                Date of service * (YYYY-MM-DD, MM/DD/YYYY, or Jan 2 2026)
              </div>
              <input
                className="input"
                placeholder="2026-02-04"
                value={dateOfService}
                onChange={(event) => setDateOfService(event.target.value)}
                onBlur={(event) => normalizeDateField(event.target.value, setDateOfService)}
              />
            </label>
            <label>
              <div className="text-muted" style={{ marginBottom: 6 }}>
                Procedures * (free text, one per line or comma-separated)
              </div>
              <textarea
                className="input"
                style={{ minHeight: 120 }}
                placeholder="Periodic exam, bitewing X-rays, adult prophy"
                value={proceduresText}
                onChange={(event) => setProceduresText(event.target.value)}
              />
            </label>
            <button
              className="button"
              type="button"
              onClick={() => runPreview(appointmentPatientId ?? selectedPatientId)}
              disabled={isPreviewing || !isPreviewReady}
            >
              {isPreviewing ? 'Analyzing...' : 'Analyze and preview'}
            </button>
            {!isPreviewReady ? (
              <div className="text-muted">
                Complete required fields to continue: {missingFields.map((field) => field.label).join(', ')}.
              </div>
            ) : (
              <div className="text-muted">
                Preview runs normalization and insurance selection. It does not save any changes.
              </div>
            )}
            {previewStatus ? <div className="text-muted">{previewStatus}</div> : null}
          </div>
        </div>

        <div className="insight-stack">
          <div className="card card-glow">
            <div className="badge">Quick start</div>
            <div className="text-muted" style={{ marginTop: 10, display: 'grid', gap: 6 }}>
              <div>Step 1: Enter visit details and procedures.</div>
              <div>Step 2: Analyze to preview patient match, insurance, and codes.</div>
              <div>Step 3: Resolve any review flags, then confirm intake.</div>
            </div>
          </div>
          <div className="card">
            <div className="badge">Preview readiness</div>
            <div style={{ marginTop: 12, display: 'grid', gap: 8 }}>
              {requiredFields.map((field) => (
                <div key={field.id} className="text-muted">
                  {field.value.length > 0 ? 'Ready' : 'Missing'}: {field.label}
                </div>
              ))}
            </div>
          </div>
          {preview ? (
            <div className="card">
              <div className="badge">Preview summary</div>
              <div className="text-muted" style={{ marginTop: 10, display: 'grid', gap: 6 }}>
                <div>Procedures analyzed: {preview.procedures.length}</div>
                <div>
                  Patient match:{' '}
                  {preview.patientMatchStatus === 'found'
                    ? preview.patientOptions[0]?.name ?? 'Resolved'
                    : preview.patientMatchStatus === 'ambiguous'
                    ? 'Multiple matches'
                    : 'New patient needed'}
                </div>
                <div>
                  Insurance:{' '}
                  {preview.insuranceSelection.needsConfirmation
                    ? 'Confirmation required'
                    : preview.insuranceSelection.selectedPolicy
                    ? `${preview.insuranceSelection.selectedPolicy.payerName} (${preview.insuranceSelection.selectedPolicy.priority})`
                    : 'Self-pay'}
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {preview ? (
        <div className="grid-cards">
          <div className="card">
            <div className="badge">Patient resolution</div>
            <div style={{ marginTop: 12, display: 'grid', gap: 12 }}>
              {preview.patientMatchStatus === 'found' ? (
                <div>Matched patient: {preview.patientOptions[0]?.name}</div>
              ) : null}
              {preview.patientMatchStatus === 'ambiguous' ? (
                <div style={{ display: 'grid', gap: 8 }}>
                  <div className="text-muted">
                    Multiple patients match. Select the correct patient before continuing.
                  </div>
                  {preview.patientOptions.map((option) => (
                    <label key={option.id} style={{ display: 'flex', gap: 8 }}>
                      <input
                        type="radio"
                        name="patient"
                        checked={selectedPatientId === option.id}
                        onChange={() => {
                          setSelectedPatientId(option.id);
                          runPreview(option.id);
                        }}
                      />
                      {option.name}
                    </label>
                  ))}
                </div>
              ) : null}
              {preview.patientMatchStatus === 'not_found' ? (
                appointmentId ? (
                  <div className="text-muted">
                    Appointment is tied to an existing patient. Resolve the patient record before continuing.
                  </div>
                ) : (
                  <label style={{ display: 'flex', gap: 8 }}>
                    <input
                      type="checkbox"
                      checked={createPatient}
                      onChange={(event) => setCreatePatient(event.target.checked)}
                    />
                    Create new patient record for {patientName || 'this patient'}
                  </label>
                )
              ) : null}
            </div>
          </div>

          <div className="card">
            <div className="badge">Insurance used</div>
            <div className="text-muted" style={{ marginTop: 8 }}>
              {preview.insuranceSelection.reason}
            </div>
            {preview.insuranceSelection.warnings.length > 0 ? (
              <div style={{ marginTop: 8, display: 'grid', gap: 4 }}>
                {preview.insuranceSelection.warnings.map((warning) => (
                  <div key={warning} className="text-muted">
                    {warning}
                  </div>
                ))}
              </div>
            ) : null}
            <div className="text-muted" style={{ marginTop: 8 }}>
              {dateOfService.trim().length > 0
                ? `Policies shown are active for ${dateOfService}.`
                : 'Policies shown are active for the date of service.'}
            </div>
            {hasActivePolicies ? (
              <div style={{ marginTop: 12, display: 'grid', gap: 8 }}>
                <div className="text-muted">Billing selection: Insurance</div>
                {selectedPolicy ? (
                  <div>
                    Using {selectedPolicy.payerName} - {selectedPolicy.priority}
                  </div>
                ) : null}
                {preview.insuranceSelection.needsConfirmation || activePolicies.length > 1 ? (
                  <div style={{ display: 'grid', gap: 8 }}>
                    <div className="text-muted">Select policy:</div>
                      {activePolicies.map((policy) => (
                        <label key={policy.id} style={{ display: 'flex', gap: 8 }}>
                          <input
                            type="radio"
                            name="insurance"
                            checked={insurancePolicyId === policy.id}
                            onChange={() => {
                              setInsurancePolicyId(policy.id);
                              setInsuranceChoice('insurance');
                              setSelfPayConfirmed(false);
                              setAddInsuranceNow(false);
                              setCopayCollected(false);
                            }}
                          />
                          <div style={{ display: 'grid', gap: 2 }}>
                            <div>
                              {policy.payerName} - {policy.priority}
                            </div>
                            <div className="text-muted" style={{ fontSize: 12 }}>
                              Member {policy.memberId}
                              {policy.employerName ? ` | Employer ${policy.employerName}` : ''}
                              {policy.lastVerifiedAt ? ` | Verified ${formatDate(policy.lastVerifiedAt)}` : ''}
                            </div>
                          </div>
                        </label>
                      ))}
                  </div>
                ) : null}
                {inactivePolicies.length > 0 ? (
                  <div className="text-muted">
                    {inactivePolicies.length} {inactivePolicies.length === 1 ? 'policy' : 'policies'} on file are
                    inactive or need re-verification for this date.
                  </div>
                ) : null}
              </div>
            ) : (
              <div style={{ marginTop: 12, display: 'grid', gap: 10 }}>
                <div className="text-muted">
                  {policiesOnFile.length > 0
                    ? 'Policies on file are inactive or need re-verification for this date of service.'
                    : 'No insurance on file for this patient.'}
                </div>
                {canAddInsurance ? (
                  <div style={{ display: 'grid', gap: 8 }}>
                    <label style={{ display: 'flex', gap: 8 }}>
                      <input
                        type="radio"
                        name="insurance-choice"
                        checked={insuranceChoice === 'self-pay'}
                        onChange={() => {
                          setInsuranceChoice('self-pay');
                          setSelfPayConfirmed(true);
                          setAddInsuranceNow(false);
                          setInsurancePolicyId(null);
                          setCopayCollected(false);
                          if (insuranceReason.trim().length === 0) {
                            setInsuranceReason('Self-pay confirmed by staff.');
                          }
                        }}
                      />
                      Self-pay for this visit
                    </label>
                    <label style={{ display: 'flex', gap: 8 }}>
                      <input
                        type="radio"
                        name="insurance-choice"
                        checked={insuranceChoice === 'add-insurance'}
                        onChange={() => {
                          setInsuranceChoice('add-insurance');
                          setAddInsuranceNow(true);
                          setSelfPayConfirmed(false);
                          setInsurancePolicyId(null);
                          setCopayCollected(false);
                          if (preview.patientMatchStatus === 'not_found' && !appointmentPatientId) {
                            setCreatePatient(true);
                          }
                          if (insuranceReason.trim().length === 0) {
                            setInsuranceReason('New insurance captured during intake.');
                          }
                        }}
                      />
                      Add insurance now
                    </label>
                  </div>
                ) : (
                  <div className="text-muted">Resolve the patient match to add insurance or confirm self-pay.</div>
                )}
              </div>
            )}
            {hasActivePolicies ? (
              <div className="text-muted" style={{ marginTop: 8 }}>
                {selectedPolicy ? (
                  (() => {
                    if (!selectedPolicy.copayAmount) {
                      return 'Expected copay: None recorded';
                    }
                    const value = Number(selectedPolicy.copayAmount);
                    if (Number.isNaN(value)) {
                      return `Expected copay: ${selectedPolicy.copayAmount}`;
                    }
                    return `Expected copay: ${formatCurrency(value)}`;
                  })()
                ) : (
                  'Select a policy to view expected copay.'
                )}
              </div>
            ) : null}
            {addInsuranceNow && canAddInsurance ? (
              <div className="card" style={{ marginTop: 12, padding: 12, display: 'grid', gap: 10 }}>
                <label>
                  <div className="text-muted" style={{ marginBottom: 6 }}>
                    Payer name
                  </div>
                  <input
                    className="input"
                    value={newInsurance.payerName}
                    onChange={(event) =>
                      setNewInsurance((prev) => ({ ...prev, payerName: event.target.value }))
                    }
                  />
                </label>
                <label>
                  <div className="text-muted" style={{ marginBottom: 6 }}>
                    Member ID
                  </div>
                  <input
                    className="input"
                    value={newInsurance.memberId}
                    onChange={(event) =>
                      setNewInsurance((prev) => ({ ...prev, memberId: event.target.value }))
                    }
                  />
                </label>
                <label>
                  <div className="text-muted" style={{ marginBottom: 6 }}>
                    Group ID (optional)
                  </div>
                  <input
                    className="input"
                    value={newInsurance.groupId}
                    onChange={(event) =>
                      setNewInsurance((prev) => ({ ...prev, groupId: event.target.value }))
                    }
                  />
                </label>
                <label>
                  <div className="text-muted" style={{ marginBottom: 6 }}>
                    Subscriber name (optional)
                  </div>
                  <input
                    className="input"
                    value={newInsurance.subscriberName}
                    onChange={(event) =>
                      setNewInsurance((prev) => ({ ...prev, subscriberName: event.target.value }))
                    }
                  />
                </label>
                <label>
                  <div className="text-muted" style={{ marginBottom: 6 }}>
                    Employer name (optional)
                  </div>
                  <input
                    className="input"
                    value={newInsurance.employerName}
                    onChange={(event) =>
                      setNewInsurance((prev) => ({ ...prev, employerName: event.target.value }))
                    }
                  />
                </label>
                <label>
                  <div className="text-muted" style={{ marginBottom: 6 }}>
                    Priority
                  </div>
                  <select
                    className="input"
                    value={newInsurance.priority}
                    onChange={(event) =>
                      setNewInsurance((prev) => ({ ...prev, priority: event.target.value }))
                    }
                  >
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
                    value={newInsurance.effectiveStart}
                    onChange={(event) =>
                      setNewInsurance((prev) => ({ ...prev, effectiveStart: event.target.value }))
                    }
                  />
                </label>
                <label>
                  <div className="text-muted" style={{ marginBottom: 6 }}>
                    Effective end (optional)
                  </div>
                  <input
                    className="input"
                    type="date"
                    value={newInsurance.effectiveEnd}
                    onChange={(event) =>
                      setNewInsurance((prev) => ({ ...prev, effectiveEnd: event.target.value }))
                    }
                  />
                </label>
                <label>
                  <div className="text-muted" style={{ marginBottom: 6 }}>
                    Last verified (optional)
                  </div>
                  <input
                    className="input"
                    type="date"
                    value={newInsurance.lastVerifiedAt}
                    onChange={(event) =>
                      setNewInsurance((prev) => ({ ...prev, lastVerifiedAt: event.target.value }))
                    }
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
                    value={newInsurance.copayAmount}
                    onChange={(event) =>
                      setNewInsurance((prev) => ({ ...prev, copayAmount: event.target.value }))
                    }
                  />
                </label>
                {showNewInsuranceCopay ? (
                  <label style={{ display: 'flex', gap: 8 }}>
                    <input
                      type="checkbox"
                      checked={copayCollected}
                      onChange={(event) => setCopayCollected(event.target.checked)}
                    />
                    Copay collected at visit ({formatCurrency(newInsuranceCopay)})
                  </label>
                ) : null}
                <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                  <button className="button secondary" type="button" onClick={saveInsuranceDraft}>
                    Save insurance draft
                  </button>
                  {insuranceDraftStatus ? <div className="text-muted">{insuranceDraftStatus}</div> : null}
                  {insuranceDraftSavedAt ? (
                    <div className="text-muted">
                      Last saved: {new Date(insuranceDraftSavedAt).toLocaleString()}
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null}
            {(() => {
              const copayAmount = selectedPolicy?.copayAmount ? Number(selectedPolicy.copayAmount) : null;
              if (!selectedPolicy || copayAmount === null || Number.isNaN(copayAmount)) {
                return null;
              }
              return (
                <label style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                  <input
                    type="checkbox"
                    checked={copayCollected}
                    onChange={(event) => setCopayCollected(event.target.checked)}
                  />
                  Copay collected at visit ({formatCurrency(copayAmount)})
                </label>
              );
            })()}
            <label style={{ marginTop: 12, display: 'grid', gap: 6 }}>
              <div className="text-muted">Insurance selection rationale</div>
              <textarea
                className="input"
                value={insuranceReason}
                onChange={(event) => setInsuranceReason(event.target.value)}
              />
            </label>
          </div>

          <div className="card">
            <div className="badge">Review flags</div>
            {confirmIssues.length === 0 ? (
              <div className="text-muted" style={{ marginTop: 10 }}>
                All confirmations resolved. You can proceed to confirm intake.
              </div>
            ) : (
              <div style={{ marginTop: 10, display: 'grid', gap: 6 }}>
                {confirmIssues.map((issue) => (
                  <div key={issue} className="text-muted">
                    {issue}
                  </div>
                ))}
              </div>
            )}
            {preview.insuranceSelection.warnings.length > 0 ? (
              <div style={{ marginTop: 12, display: 'grid', gap: 6 }}>
                <div className="text-muted">Insurance warnings:</div>
                {preview.insuranceSelection.warnings.map((warning) => (
                  <div key={warning} className="text-muted">
                    {warning}
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {preview ? (
        <div className="card">
          <div className="badge">Procedure normalization</div>
          <div style={{ marginTop: 12, display: 'grid', gap: 16 }}>
            {preview.procedures.map((procedure, index) => (
              <div key={`${procedure.freeText}-${index}`} className="card" style={{ padding: 14 }}>
                <div style={{ fontWeight: 600 }}>{procedure.freeText}</div>
                {(() => {
                  const confidenceDetails = procedure.confidenceDetails;
                  const confidenceScore = confidenceDetails?.confidenceScore ?? procedure.confidence;
                  const confidenceLevel = confidenceDetails?.confidenceLevel;
                  const badgeStyle =
                    confidenceLevel === 'high'
                      ? { background: 'rgba(34, 197, 94, 0.2)' }
                      : confidenceLevel === 'medium'
                        ? { background: 'rgba(59, 130, 246, 0.2)' }
                        : { background: 'rgba(239, 68, 68, 0.2)' };
                  return (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginTop: 6 }}>
                      <div className="badge" style={badgeStyle} title={confidenceDetails?.explanation}>
                        Confidence {confidenceScore.toFixed(2)}
                        {confidenceLevel ? ` (${confidenceLevel})` : ''}
                      </div>
                      {!confidenceDetails ? (
                        <div className="text-muted" style={{ fontSize: 13 }}>
                          {procedure.rationale}
                        </div>
                      ) : null}
                    </div>
                  );
                })()}
                {procedure.confidenceDetails ? (
                  <details style={{ marginTop: 8 }}>
                    <summary className="text-muted" style={{ cursor: 'pointer' }}>
                      Confidence explanation and factors
                    </summary>
                    <div className="text-muted" style={{ fontSize: 12, marginTop: 6 }}>
                      {procedure.confidenceDetails.explanation}
                    </div>
                    <div style={{ marginTop: 8, display: 'grid', gap: 6 }}>
                      {procedure.confidenceDetails.factors.map((factor) => (
                        <div key={factor.name} style={{ display: 'grid', gap: 2 }}>
                          <div>{factor.name}</div>
                          <div className="text-muted" style={{ fontSize: 12 }}>
                            Raw {factor.rawValue.toFixed(2)} | Normalized {factor.normalizedValue.toFixed(2)} | Weight{' '}
                            {factor.weight.toFixed(2)} | Contribution {factor.contribution.toFixed(2)}
                          </div>
                        </div>
                      ))}
                    </div>
                  </details>
                ) : (
                  <div className="text-muted" style={{ fontSize: 12, marginTop: 8 }}>
                    Confidence details unavailable.
                  </div>
                )}
                {procedure.needsConfirmation ? (
                  <div className="badge" style={{ marginTop: 8, background: 'rgba(245, 158, 11, 0.2)' }}>
                    Confirmation required
                  </div>
                ) : null}
                {procedure.clarifyingQuestion ? (
                  <div className="badge" style={{ marginTop: 8, background: 'rgba(245, 158, 11, 0.2)' }}>
                    {procedure.clarifyingQuestion}
                  </div>
                ) : null}
                <div style={{ marginTop: 10, display: 'grid', gap: 8 }}>
                  {procedure.candidateCodes.length === 0 ? (
                    <div className="text-muted">
                      No CDT matches found. Enter an override code and label below.
                    </div>
                  ) : (
                    procedure.candidateCodes.map((code) => (
                      <label key={code.code} style={{ display: 'grid', gridTemplateColumns: '18px 1fr', gap: 8 }}>
                        <input
                          type="radio"
                          name={`procedure-${index}`}
                          checked={selectedCodes[index] === code.code}
                          onChange={() =>
                            setSelectedCodes((prev) => ({
                              ...prev,
                              [index]: code.code
                            }))
                          }
                        />
                        <div style={{ display: 'grid', gap: 4 }}>
                          <div>
                            {code.code} - {code.label} ({code.confidence.toFixed(2)})
                          </div>
                          {code.matchSource ? (
                            <div className="text-muted" style={{ fontSize: 12 }}>
                              Matched {formatMatchSource(code.matchSource)}
                            </div>
                          ) : null}
                          {code.category ? (
                            <div className="text-muted" style={{ fontSize: 12 }}>
                              Category: {code.category}
                            </div>
                          ) : null}
                          {code.estimatedCopay !== undefined ? (
                            <div className="text-muted" style={{ fontSize: 12 }}>
                              Estimated copay (typical plan): {formatCurrency(code.estimatedCopay)}
                              {code.copayRate !== undefined
                                ? ` - ${Math.round(code.copayRate * 100)}% patient share`
                                : ''}
                            </div>
                          ) : null}
                          {code.notes ? (
                            <div className="text-muted" style={{ fontSize: 12 }}>
                              Notes: {code.notes}
                            </div>
                          ) : null}
                          {code.patientDescription ? (
                            <div className="text-muted" style={{ fontSize: 12 }}>
                              Patient description: {code.patientDescription}
                            </div>
                          ) : null}
                          {code.copayBasis ? (
                            <div className="text-muted" style={{ fontSize: 11 }}>
                              Copay basis: {code.copayBasis}
                            </div>
                          ) : null}
                        </div>
                      </label>
                    ))
                  )}
                  <div className="text-muted" style={{ fontSize: 12 }}>
                    Override code (required if no match)
                  </div>
                  <div style={{ display: 'grid', gap: 8 }}>
                    <input
                      className="input"
                      placeholder="CDT code (e.g., D0120)"
                      value={overrideCodes[index]?.code ?? ''}
                      onChange={(event) =>
                        setOverrideCodes((prev) => ({
                          ...prev,
                          [index]: { code: event.target.value, label: prev[index]?.label ?? '' }
                        }))
                      }
                    />
                    <input
                      className="input"
                      placeholder="Custom label"
                      value={overrideCodes[index]?.label ?? ''}
                      onChange={(event) =>
                        setOverrideCodes((prev) => ({
                          ...prev,
                          [index]: { code: prev[index]?.code ?? '', label: event.target.value }
                        }))
                      }
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {preview ? (
        <div className="card" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button className="button" type="button" disabled={!canConfirm || isConfirming} onClick={confirmIntake}>
            {isConfirming ? 'Creating claim...' : 'Confirm intake and create claim'}
          </button>
          {!canConfirm ? (
            <div className="text-muted" style={{ maxWidth: 420 }}>
              {confirmIssues.map((issue) => (
                <div key={issue}>- {issue}</div>
              ))}
            </div>
          ) : null}
          {status ? <div className="text-muted">{status}</div> : null}
          {result ? (
            <div style={{ display: 'flex', gap: 12, marginLeft: 'auto' }}>
              <Link className="button secondary" href={`/billing/${result.claimId}`}>
                View billing timeline
              </Link>
              <Link className="button secondary" href={`/patients/${result.patientId}`}>
                Open patient profile
              </Link>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

