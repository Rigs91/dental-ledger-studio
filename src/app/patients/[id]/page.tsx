import Link from 'next/link';
import { prisma } from '@/shared/domain/db';
import { SectionHeader } from '@/components/StatCard';
import { formatCurrency, formatDate } from '@/shared/domain/format';
import { buildLedgerMoneyBreakdown, buildLedgerSummary } from '@/ledger/ledger';
import { splitProcedures } from '@/intake/rules/procedure';
import type { InsuranceSnapshot } from '@/documents/claimPackets';
import { LedgerEventType } from '@prisma/client';
import InsuranceOverrideForm from '@/components/InsuranceOverrideForm';
import ReverifyInsuranceButton from '@/components/ReverifyInsuranceButton';
import { getFlagInsight } from '@/review/flagInsights';
import { getPolicyVerificationDueAt, needsReverification } from '@/insurance/insurance';

function getPlannedItems(planned: unknown): string[] {
  if (!planned || typeof planned !== 'object') {
    return [];
  }
  const record = planned as { rawText?: string; items?: string[] };
  if (record.items && Array.isArray(record.items)) {
    return record.items;
  }
  if (record.rawText) {
    return splitProcedures(record.rawText);
  }
  return [];
}

type ActivityEntry = {
  key: string;
  occurredAt: Date;
  title: string;
  description?: string;
  link?: { href: string; label: string };
};

const formatEffectiveRange = (start: Date, end?: Date | null) =>
  `${formatDate(start)}${end ? ` - ${formatDate(end)}` : ''}`;

export default async function PatientProfilePage({
  params
}: {
  params: Promise<{ id?: string }>;
}) {
  const { id } = await params;
  if (!id) {
    return <div className="card">Missing patient ID. Return to patient search.</div>;
  }

  const patient = await prisma.patient.findUnique({
    where: { id },
    include: {
      insurances: true,
      insuranceOverrides: {
        include: { policy: true },
        orderBy: { effectiveStart: 'desc' }
      },
      visits: {
        include: {
          claims: { include: { ledger: true, submissions: { orderBy: { createdAt: 'desc' } } } },
          procedures: true,
          appointment: true
        },
        orderBy: { dateOfService: 'desc' }
      },
      appointments: {
        include: { visit: { include: { claims: true, procedures: true } } },
        orderBy: { scheduledAt: 'desc' }
      },
      claims: { include: { ledger: true, visit: true, submissions: { orderBy: { createdAt: 'desc' } } } },
      ledger: true,
      flags: { orderBy: { lastDetectedAt: 'desc' } },
      activityEvents: { orderBy: { occurredAt: 'desc' } }
    }
  });

  if (!patient) {
    return <div className="card">Patient not found.</div>;
  }

  const displayName = [patient.firstName, patient.middleName, patient.lastName].filter(Boolean).join(' ');
  const formatSsn = (value?: string | null) => {
    if (!value) {
      return 'Not recorded';
    }
    const digits = value.replace(/\D/g, '');
    if (digits.length < 4) {
      return 'Not recorded';
    }
    return `***-**-${digits.slice(-4)}`;
  };
  const addressLines = [
    patient.addressLine1,
    patient.addressLine2,
    [patient.city, patient.state, patient.postalCode].filter(Boolean).join(' ')
  ].filter((line): line is string => Boolean(line && line.length > 0));

  const ledgerSummary = buildLedgerSummary(patient.ledger);
  const ledgerBreakdown = buildLedgerMoneyBreakdown(patient.ledger);
  const ledgerTimeline = ledgerSummary.timeline;
  const paymentEntries = ledgerTimeline.filter((entry) => entry.event.type === LedgerEventType.PATIENT_PAYMENT);
  const openFlags = patient.flags.filter((flag) => flag.status === 'OPEN');
  const closedFlags = patient.flags.filter((flag) => flag.status !== 'OPEN');

  const now = new Date();
  const claimsByVisit = new Map(patient.claims.map((claim) => [claim.visitId, claim]));
  const claimsById = new Map(
    patient.claims.map((claim) => [claim.id, { claim, summary: buildLedgerSummary(claim.ledger) }])
  );

  const appointmentEntries = patient.appointments.map((appointment) => ({
    key: `appt-${appointment.id}`,
    date: appointment.scheduledAt,
    status: appointment.status,
    plannedProcedures: appointment.plannedProcedures,
    visit: appointment.visit
  }));

  const standaloneVisits = patient.visits
    .filter((visit) => !visit.appointmentId)
    .map((visit) => ({
      key: `visit-${visit.id}`,
      date: visit.dateOfService,
      status: visit.status,
      plannedProcedures: visit.plannedProcedures,
      visit
    }));

  const visitEntries = [...appointmentEntries, ...standaloneVisits].sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
  );

  const serviceEntries = patient.visits.flatMap((visit) => {
    const claim = claimsByVisit.get(visit.id) ?? visit.claims[0];
    const ledger = claim?.ledger ?? [];
    const summary = claim ? buildLedgerSummary(ledger) : null;
    const hasAdjustment = ledger.some(
      (event) =>
        event.type === LedgerEventType.INSURANCE_ADJUSTMENT ||
        event.type === LedgerEventType.BALANCE_CORRECTION
    );

    return visit.procedures.map((procedure) => {
      let status = 'Unbilled';
      if (claim) {
        if (claim.status === 'DENIED') {
          status = 'Denied';
        } else if (summary && summary.currentBalance <= 0) {
          status = 'Paid';
        } else if (hasAdjustment) {
          status = 'Adjusted';
        } else {
          status = 'Billed';
        }
      }

      return {
        id: procedure.id,
        date: visit.dateOfService,
        code: procedure.selectedCode ?? 'Pending',
        label: procedure.selectedLabel ?? procedure.freeText,
        status,
        claimId: claim?.id
      };
    });
  });

  const policyOptions = patient.insurances.map((policy) => ({
    id: policy.id,
    label: `${policy.payerName} (${policy.priority}) | Member ${policy.memberId}${
      policy.employerName ? ` | ${policy.employerName}` : ''
    }`,
    effectiveStart: formatDate(policy.effectiveStart),
    effectiveEnd: policy.effectiveEnd ? formatDate(policy.effectiveEnd) : null
  }));
  const claimOptions = patient.claims.map((claim) => {
    const summary = buildLedgerSummary(claim.ledger);
    const latestSubmission = claim.submissions?.[0];
    const activeSnapshot = latestSubmission?.insuranceSnapshot ?? claim.insuranceSnapshot;
    const payerLabel = activeSnapshot
      ? `${(activeSnapshot as InsuranceSnapshot).payerName ?? 'Insurance'}`
      : 'Self-pay';
    const dateIso = claim.visit.dateOfService.toISOString().slice(0, 10);
    return {
      id: claim.id,
      dateOfService: dateIso,
      dateLabel: formatDate(claim.visit.dateOfService),
      status: claim.status,
      balance: summary.currentBalance,
      payerLabel
    };
  });

  const insuranceActivityEvents = patient.activityEvents.filter((event) => event.category === 'INSURANCE');
  const loggedPolicyAdds = new Set(
    insuranceActivityEvents
      .filter((event) => event.type === 'INSURANCE_POLICY_ADDED' && event.insurancePolicyId)
      .map((event) => event.insurancePolicyId as string)
  );
  const loggedOverrides = new Set(
    insuranceActivityEvents
      .filter((event) => event.type === 'INSURANCE_OVERRIDE_CREATED' && event.insuranceOverrideId)
      .map((event) => event.insuranceOverrideId as string)
  );

  const insuranceActivityEntries: ActivityEntry[] = [
    ...insuranceActivityEvents.map((event) => ({
      key: `activity-${event.id}`,
      occurredAt: event.occurredAt,
      title: event.title,
      description: event.detail ?? undefined,
      link: event.claimId
        ? { href: `/billing/${event.claimId}`, label: 'View claim' }
        : event.insurancePolicyId
        ? { href: `/patients/${patient.id}/insurance/${event.insurancePolicyId}/edit`, label: 'View policy' }
        : undefined
    })),
    ...patient.insurances
      .filter((policy) => !loggedPolicyAdds.has(policy.id))
      .map((policy) => ({
        key: `policy-${policy.id}`,
        occurredAt: policy.createdAt,
        title: 'Insurance policy added',
        description: `${policy.payerName} (${policy.priority}) - Member ${policy.memberId} - Effective ${formatEffectiveRange(
          policy.effectiveStart,
          policy.effectiveEnd
        )}`,
        link: { href: `/patients/${patient.id}/insurance/${policy.id}/edit`, label: 'View policy' }
      })),
    ...patient.insuranceOverrides
      .filter((override) => !loggedOverrides.has(override.id))
      .map((override) => ({
        key: `override-${override.id}`,
        occurredAt: override.createdAt,
        title: 'Insurance override created',
        description: `${override.policy.payerName} (${override.policy.priority}) - ${formatEffectiveRange(
          override.effectiveStart,
          override.effectiveEnd
        )} - ${override.reason}`
      }))
  ].sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime());

  const patientActionEntries: ActivityEntry[] = patient.ledger
    .filter((event) => event.type === LedgerEventType.PATIENT_PAYMENT)
    .map((event) => {
      const metadata = (event.metadata ?? {}) as Record<string, unknown>;
      const source =
        metadata.source === 'copay'
          ? 'Copay collected'
          : metadata.source === 'self-pay'
          ? 'Self-pay'
          : 'Patient payment';
      const note = typeof metadata.note === 'string' ? metadata.note : null;
      const amount = Math.abs(Number(event.amount.toString()));
      return {
        key: `payment-${event.id}`,
        occurredAt: event.occurredAt,
        title: source,
        description: `${formatCurrency(amount)}${note ? ` - ${note}` : ''}`,
        link: event.claimId ? { href: `/billing/${event.claimId}`, label: 'View claim' } : undefined
      };
    })
    .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime());

  const procedureActivityEntries: ActivityEntry[] = serviceEntries
    .map((entry) => ({
      key: `procedure-${entry.id}`,
      occurredAt: entry.date,
      title: `${entry.code} - ${entry.label}`,
      description: `Status: ${entry.status}`,
      link: entry.claimId ? { href: `/billing/${entry.claimId}`, label: 'View claim' } : undefined
    }))
    .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime());

  return (
    <div style={{ display: 'grid', gap: 24 }}>
      <SectionHeader
        title={displayName}
        subtitle={`Patient ID ${patient.id} | DOB ${formatDate(patient.dob)}`}
        action={
          <div style={{ display: 'flex', gap: 12 }}>
            <Link className="button secondary" href={`/patients/${patient.id}/edit`}>
              Edit profile
            </Link>
            <Link className="button secondary" href={`/patients/${patient.id}/insurance/new`}>
              Add insurance
            </Link>
            <Link className="button secondary" href="/operations">
              Daily operations
            </Link>
            <Link className="button" href="/intake">
              New intake
            </Link>
          </div>
        }
      />

      <div className="grid-cards">
        <div className="card">
          <div className="badge">Balance snapshot</div>
          <div className="section-title" style={{ fontSize: 28, marginTop: 10 }}>
            {formatCurrency(ledgerSummary.currentBalance)}
          </div>
          <div className="text-muted" style={{ marginTop: 8 }}>
            Across {patient.ledger.length} ledger events.
          </div>
          {openFlags.length > 0 ? (
            <div className="badge" style={{ marginTop: 12, background: 'rgba(245, 158, 11, 0.2)' }}>
              {openFlags.length} open flag(s)
            </div>
          ) : null}
          <div className="text-muted" style={{ marginTop: 8, fontSize: 12 }}>
            {openFlags.length} open / {closedFlags.length} closed review flags.
          </div>
          <div className="text-muted" style={{ marginTop: 8, fontSize: 12 }}>
            Insurance paid: {formatCurrency(ledgerBreakdown.insurancePaid)} | Patient payments: {formatCurrency(ledgerBreakdown.patientPayments)}
          </div>
        </div>
        <div className="card">
          <div className="badge">Demographics</div>
          <div style={{ marginTop: 12, display: 'grid', gap: 6 }}>
            <div>Phone: {patient.phone ?? 'Not recorded'}</div>
            <div>Email: {patient.email ?? 'Not recorded'}</div>
            <div>SSN: {formatSsn(patient.ssn)}</div>
            <div>Address:</div>
            {addressLines.length > 0 ? (
              addressLines.map((line) => <div key={line}>{line}</div>)
            ) : (
              <div className="text-muted">Not recorded</div>
            )}
          </div>
        </div>
      </div>

      <div className="card">
        <SectionHeader
          title="Activity timeline"
          subtitle="See patient actions, procedures, and everything else in one place."
        />
        <div
          style={{
            display: 'grid',
            gap: 16,
            gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
            marginTop: 16
          }}
        >
          {[
            {
              key: 'patient',
              title: 'Patient actions',
              subtitle: 'Payments and other patient-driven updates.',
              entries: patientActionEntries
            },
            {
              key: 'procedure',
              title: 'Procedures',
              subtitle: 'Procedures recorded across visits.',
              entries: procedureActivityEntries
            },
            {
              key: 'other',
              title: 'Everything else',
              subtitle: 'Insurance updates, overrides, and coverage changes.',
              entries: insuranceActivityEntries
            }
          ].map((group) => (
            <div key={group.key} className="card" style={{ padding: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline' }}>
                <div className="badge">{group.title}</div>
                <div className="text-muted" style={{ fontSize: 12 }}>
                  {group.entries.length} item{group.entries.length === 1 ? '' : 's'}
                </div>
              </div>
              <div className="text-muted" style={{ fontSize: 12, marginTop: 6 }}>
                {group.subtitle}
              </div>
              <div style={{ display: 'grid', gap: 10, marginTop: 12, maxHeight: 320, overflowY: 'auto', paddingRight: 4 }}>
                {group.entries.length === 0 ? (
                  <div className="text-muted">No activity yet.</div>
                ) : (
                  group.entries.map((entry) => (
                    <div
                      key={entry.key}
                      style={{
                        display: 'grid',
                        gap: 4,
                        padding: 10,
                        borderRadius: 12,
                        border: '1px solid rgba(15, 23, 42, 0.08)',
                        background: 'rgba(255, 255, 255, 0.7)'
                      }}
                    >
                      <div style={{ fontWeight: 600 }}>{entry.title}</div>
                      <div className="text-muted" style={{ fontSize: 12 }}>
                        {formatDate(entry.occurredAt)}
                      </div>
                      {entry.description ? (
                        <div className="text-muted" style={{ fontSize: 12 }}>
                          {entry.description}
                        </div>
                      ) : null}
                      {entry.link ? (
                        <Link className="text-muted" href={entry.link.href}>
                          {entry.link.label}
                        </Link>
                      ) : null}
                    </div>
                  ))
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <SectionHeader
          title="Open review flags"
          subtitle="Active items that still need a billing manager decision."
          action={
            <Link className="button secondary" href={`/review?patientId=${patient.id}`}>
              Open review inbox
            </Link>
          }
        />
        <div style={{ display: 'grid', gap: 12, marginTop: 16 }}>
          {openFlags.length === 0 ? (
            <div className="text-muted">No open flags for this patient.</div>
          ) : (
            openFlags.map((flag) => {
              const insight = getFlagInsight(flag.likelyIssue, flag.recommendedAction);
              const claimContext = flag.claimId ? claimsById.get(flag.claimId) : null;
              const claimDate = claimContext?.claim.visit?.dateOfService;
              const claimBalance = claimContext?.summary.currentBalance;
              return (
                <div key={flag.id} className="card" style={{ padding: 12 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                    <div>
                      <div style={{ fontWeight: 600 }}>{flag.likelyIssue}</div>
                      <div className="text-muted" style={{ fontSize: 13 }}>
                        Last detected {formatDate(flag.lastDetectedAt)}
                      </div>
                      <div className="text-muted" style={{ fontSize: 12 }}>
                        {flag.claimId ? `Claim ${flag.claimId}` : 'Patient-level flag'}
                        {claimDate ? ` | Visit ${formatDate(claimDate)}` : ''}
                        {typeof claimBalance === 'number' ? ` | Balance ${formatCurrency(claimBalance)}` : ''}
                      </div>
                      <div className="text-muted" style={{ fontSize: 12, marginTop: 6 }}>
                        Why flagged: {insight.summary}
                      </div>
                      <div className="text-muted" style={{ fontSize: 12 }}>
                        Root cause: {insight.cause}
                      </div>
                      <div className="text-muted" style={{ fontSize: 12 }}>
                        Next step: {insight.fix}
                      </div>
                    </div>
                    <div style={{ display: 'grid', gap: 8, justifyItems: 'end' }}>
                      <div className="badge">{flag.status}</div>
                      <Link className="button secondary" href={`/review/${flag.id}`}>
                        Review flag
                      </Link>
                      {flag.claimId ? (
                        <Link className="button secondary" href={`/billing/${flag.claimId}`}>
                          Billing timeline
                        </Link>
                      ) : null}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      <div className="card">
        <SectionHeader
          title="Payment history"
          subtitle="Patient payments with remaining balance after each payment."
        />
        <div style={{ display: 'grid', gap: 12, marginTop: 16 }}>
          {paymentEntries.length === 0 ? (
            <div className="text-muted">No patient payments recorded yet.</div>
          ) : (
            paymentEntries.map((entry) => {
              const metadata = (entry.event.metadata ?? {}) as Record<string, unknown>;
              const source =
                metadata.source === 'copay'
                  ? 'Copay'
                  : metadata.source === 'self-pay'
                  ? 'Self-pay'
                  : 'Patient payment';
              const note = typeof metadata.note === 'string' ? metadata.note : '';
              const balanceAfter = entry.runningBalance;
              const balanceStatus =
                balanceAfter <= 0.005
                  ? balanceAfter < -0.005
                    ? `Credit balance ${formatCurrency(Math.abs(balanceAfter))}`
                    : 'Paid in full'
                  : `Balance due ${formatCurrency(balanceAfter)}`;

              return (
                <div key={entry.event.id} className="card" style={{ padding: 12 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                    <div>
                      <div style={{ fontWeight: 600 }}>{source}</div>
                      <div className="text-muted" style={{ fontSize: 13 }}>
                        {formatDate(entry.event.occurredAt)}
                      </div>
                      {note ? (
                        <div className="text-muted" style={{ fontSize: 12 }}>
                          Note: {note}
                        </div>
                      ) : null}
                      <div className="text-muted" style={{ fontSize: 12 }}>
                        {balanceStatus}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontWeight: 600 }}>
                        {formatCurrency(Math.abs(Number(entry.event.amount.toString())))}
                      </div>
                      {entry.event.claimId ? (
                        <Link className="text-muted" href={`/billing/${entry.event.claimId}`}>
                          View claim
                        </Link>
                      ) : null}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      <div className="card">
        <SectionHeader title="Visit history" subtitle="Scheduled and completed visits with planned vs actual services." />
        <div style={{ display: 'grid', gap: 12, marginTop: 16 }}>
          {visitEntries.length === 0 ? (
            <div className="text-muted">No visits or appointments yet.</div>
          ) : (
            visitEntries.map((entry) => {
              const plannedItems = getPlannedItems(entry.plannedProcedures);
              const actualItems = entry.visit
                ? entry.visit.procedures.map((procedure) => procedure.selectedLabel ?? procedure.freeText)
                : [];
              const baseClaim = entry.visit ? claimsByVisit.get(entry.visit.id) ?? entry.visit.claims[0] : null;
              const claim = baseClaim ? claimsById.get(baseClaim.id)?.claim ?? null : null;
              const submissionSnapshot = claim?.submissions?.[0]?.insuranceSnapshot as InsuranceSnapshot | null;
              const snapshot = submissionSnapshot ?? (claim?.insuranceSnapshot as InsuranceSnapshot | null);
              return (
                <div key={entry.key} className="card" style={{ padding: 14 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                    <div>
                      <div style={{ fontWeight: 600 }}>{formatDate(entry.date)}</div>
                      <div className="text-muted" style={{ fontSize: 13 }}>
                        Status: {entry.status}
                      </div>
                      <div className="text-muted" style={{ fontSize: 13 }}>
                        Insurance used:{' '}
                        {snapshot
                          ? `${snapshot.payerName} (${snapshot.priority})${snapshot.employerName ? ` | ${snapshot.employerName}` : ''}`
                          : 'Not billed yet'}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      {claim ? (
                        <>
                          <Link className="button secondary" href={`/billing/${claim.id}`}>
                            Billing timeline
                          </Link>
                          <Link className="button secondary" href={`/claims/${claim.id}?type=PAYER`}>
                            Payer packet
                          </Link>
                          <Link className="button secondary" href={`/claims/${claim.id}?type=PATIENT`}>
                            Patient statement
                          </Link>
                        </>
                      ) : entry.visit ? (
                        <Link className="button secondary" href={`/intake`}>
                          Start intake
                        </Link>
                      ) : (
                        <Link className="button secondary" href={`/intake?appointmentId=${entry.key.replace('appt-', '')}`}>
                          Start intake
                        </Link>
                      )}
                    </div>
                  </div>
                  <div style={{ display: 'grid', gap: 12, marginTop: 12 }}>
                    <div>
                      <div className="text-muted" style={{ fontSize: 12 }}>
                        Planned procedures
                      </div>
                      {plannedItems.length === 0 ? (
                        <div className="text-muted">No planned procedures recorded.</div>
                      ) : (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 6 }}>
                          {plannedItems.map((item, index) => (
                            <span key={`${item}-${index}`} className="badge">
                              {item}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    <div>
                      <div className="text-muted" style={{ fontSize: 12 }}>
                        Actual procedures
                      </div>
                      {actualItems.length === 0 ? (
                        <div className="text-muted">Not completed yet.</div>
                      ) : (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 6 }}>
                          {actualItems.map((item, index) => (
                            <span key={`${item}-${index}`} className="badge">
                              {item}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      <div className="card">
        <SectionHeader title="Service history" subtitle="Procedures across all visits with billing status." />
        <div style={{ display: 'grid', gap: 12, marginTop: 16 }}>
          {serviceEntries.length === 0 ? (
            <div className="text-muted">No procedures recorded yet.</div>
          ) : (
            serviceEntries.map((entry) => (
              <div key={entry.id} className="card" style={{ padding: 14 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                  <div>
                    <div style={{ fontWeight: 600 }}>{entry.label}</div>
                    <div className="text-muted" style={{ fontSize: 13 }}>
                      {formatDate(entry.date)} | {entry.code}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div className="badge">{entry.status}</div>
                    {entry.claimId ? (
                      <Link className="text-muted" href={`/billing/${entry.claimId}`}>
                        View claim
                      </Link>
                    ) : null}
                  </div>
                </div>
                <div className="text-muted" style={{ marginTop: 6, fontSize: 12 }}>
                  Status derived from claim ledger and payment activity.
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="card">
        <SectionHeader title="Insurance" subtitle="Coverage timeline and usage by visit." />
        <div className="text-muted" style={{ marginTop: 8, fontSize: 12 }}>
          Re-verify when staff confirms eligibility/benefits with the payer. This updates the policy
          verification date and refreshes insurance readiness across operations, intake, and billing views.
        </div>
        <div style={{ display: 'grid', gap: 12, marginTop: 16 }}>
          {patient.insurances.length === 0 ? (
            <div className="text-muted">No policies on file. Add insurance to avoid delays.</div>
          ) : (
            patient.insurances.map((policy) => {
              const claims = patient.claims.filter((claim) => claim.insurancePolicyId === policy.id);
              const verificationDueAt = getPolicyVerificationDueAt(policy);
              const verificationRequired = needsReverification(policy, now);
              return (
                <div key={policy.id} className="card" style={{ padding: 14 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                    <div>
                      <div style={{ fontWeight: 600 }}>{policy.payerName}</div>
                      <div className="text-muted" style={{ fontSize: 13 }}>
                        {policy.priority} | Member {policy.memberId}
                        {policy.groupId ? ` | Group ${policy.groupId}` : ''}
                      </div>
                      {policy.employerName ? (
                        <div className="text-muted" style={{ fontSize: 13 }}>
                          Employer: {policy.employerName}
                        </div>
                      ) : null}
                      <div className="text-muted" style={{ fontSize: 13 }}>
                        Effective {formatDate(policy.effectiveStart)}
                        {policy.effectiveEnd ? ` - ${formatDate(policy.effectiveEnd)}` : ''}
                      </div>
                      <div className="text-muted" style={{ fontSize: 13 }}>
                        Last verified: {policy.lastVerifiedAt ? formatDate(policy.lastVerifiedAt) : 'Not recorded'}
                      </div>
                      <div className="text-muted" style={{ fontSize: 13 }}>
                        Verification due: {formatDate(verificationDueAt)}
                      </div>
                      {policy.copayAmount ? (
                        <div className="text-muted" style={{ fontSize: 13 }}>
                          Copay: {formatCurrency(Number(policy.copayAmount.toString()))}
                        </div>
                      ) : null}
                      <div className="text-muted" style={{ fontSize: 13 }}>
                        Subscriber: {policy.subscriberName ?? 'Not recorded'}
                      </div>
                    </div>
                    <div style={{ display: 'grid', gap: 8, justifyItems: 'end' }}>
                      {verificationRequired ? (
                        <div className="badge" style={{ background: 'rgba(245, 158, 11, 0.2)' }}>
                          Reverification needed
                        </div>
                      ) : null}
                      {verificationRequired ? (
                        <ReverifyInsuranceButton policyId={policy.id} payerName={policy.payerName} />
                      ) : null}
                      <Link className="button secondary" href={`/patients/${patient.id}/insurance/${policy.id}/edit`}>
                        Edit
                      </Link>
                    </div>
                  </div>
                  <div style={{ marginTop: 10 }}>
                    <div className="text-muted" style={{ fontSize: 12 }}>
                      Used on claims:
                    </div>
                    {claims.length === 0 ? (
                      <div className="text-muted">No claims yet.</div>
                    ) : (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 6 }}>
                        {claims.map((claim) => (
                          <Link key={claim.id} href={`/billing/${claim.id}`} className="badge">
                            {formatDate(claim.visit.dateOfService)}
                          </Link>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      <div className="card">
        <SectionHeader
          title="Insurance selection overrides"
          subtitle="Explicitly select a policy for a date range when multiple policies are active."
        />
        <div style={{ display: 'grid', gap: 12, marginTop: 16 }}>
          {patient.insuranceOverrides.length === 0 ? (
            <div className="text-muted">No overrides on file.</div>
          ) : (
            patient.insuranceOverrides.map((override) => (
              <div key={override.id} className="card" style={{ padding: 12 }}>
                <div style={{ fontWeight: 600 }}>{override.policy.payerName}</div>
                <div className="text-muted" style={{ fontSize: 13 }}>
                  Effective {formatDate(override.effectiveStart)}
                  {override.effectiveEnd ? ` - ${formatDate(override.effectiveEnd)}` : ''}
                </div>
                <div className="text-muted" style={{ fontSize: 13 }}>
                  Reason: {override.reason}
                </div>
              </div>
            ))
          )}
          <div className="card" style={{ padding: 12 }}>
            <InsuranceOverrideForm patientId={patient.id} policies={policyOptions} claims={claimOptions} />
          </div>
        </div>
      </div>
    </div>
  );
}
