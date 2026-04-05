import Link from 'next/link';
import { prisma } from '@/shared/domain/db';
import { SectionHeader } from '@/components/StatCard';
import { Timeline } from '@/components/Timeline';
import ExplanationEditor from '@/components/ExplanationEditor';
import { buildLedgerMoneyBreakdown, buildLedgerSummary } from '@/ledger/ledger';
import { formatCurrency, formatDate, formatDateTime } from '@/shared/domain/format';
import ClaimDecisionForm from '@/components/ClaimDecisionForm';
import ClaimResubmissionForm from '@/components/ClaimResubmissionForm';
import { isPolicyActive } from '@/insurance/insurance';
import PatientPaymentForm from '@/components/PatientPaymentForm';

export default async function BillingTimelinePage({
  params
}: {
  params: Promise<{ claimId?: string }>;
}) {
  const { claimId } = await params;
  if (!claimId || claimId === 'undefined' || claimId === 'null') {
    return (
      <div className="card">
        Missing claim ID. Return to the dashboard or search for the patient again.
      </div>
    );
  }

  const claim = await prisma.claim.findUnique({
    where: { id: claimId },
    include: {
      patient: { include: { insurances: true } },
      visit: true,
      insurancePolicy: true,
      ledger: true,
      packets: true,
      explanations: { orderBy: { createdAt: 'desc' } },
      submissions: {
        include: { insurancePolicy: true, packet: true },
        orderBy: { createdAt: 'desc' }
      },
      decisions: {
        orderBy: { occurredAt: 'desc' }
      }
    }
  });

  if (!claim) {
    return <div className="card">Claim not found.</div>;
  }

  const summary = buildLedgerSummary(claim.ledger);
  const breakdown = buildLedgerMoneyBreakdown(claim.ledger);
  const explanation = claim.explanations[0];
  const latestSubmission = claim.submissions[0] ?? null;
  const snapshot = claim.insuranceSnapshot as
    | {
        payerName: string;
        memberId: string;
        priority: string;
        effectiveStart: string;
        effectiveEnd?: string | null;
        employerName?: string | null;
        lastVerifiedAt?: string | null;
        copayAmount?: string | null;
      }
    | null;
  const submissionSnapshot = latestSubmission?.insuranceSnapshot as typeof snapshot | null;
  const activeSnapshot = submissionSnapshot ?? snapshot;
  const insuranceReasonText = latestSubmission?.reason ?? claim.insuranceReason;
  const policyOptions = claim.patient.insurances.map((policy) => ({
    id: policy.id,
    payerName: policy.payerName,
    memberId: policy.memberId,
    priority: policy.priority,
    effectiveStart: formatDate(policy.effectiveStart),
    effectiveEnd: policy.effectiveEnd ? formatDate(policy.effectiveEnd) : null,
    employerName: policy.employerName ?? null,
    lastVerifiedAt: policy.lastVerifiedAt ? formatDate(policy.lastVerifiedAt) : null,
    copayAmount: policy.copayAmount ? policy.copayAmount.toString() : null,
    activeOnDos: isPolicyActive(policy, claim.visit.dateOfService)
  }));
  const isSelfPay = !activeSnapshot;
  const paidToDate = breakdown.insurancePaid + breakdown.patientPayments;
  const patientPaymentLabel = isSelfPay ? 'Self-pay payments' : 'Patient payments';
  const copayExpected = activeSnapshot?.copayAmount ? Number(activeSnapshot.copayAmount) : null;
  const resubmissionInProgress = claim.submissions.length > 1 && claim.status === 'SUBMITTED';
  const resubmissionNote = latestSubmission
    ? `Resubmitted ${formatDateTime(latestSubmission.createdAt)}. Hold patient billing until payer responds.`
    : 'Resubmitted claim pending payer response.';

  return (
    <div style={{ display: 'grid', gap: 24 }}>
      <SectionHeader
        title="Billing Timeline"
        subtitle={`Claim ${claim.id} - ${claim.patient.firstName} ${claim.patient.lastName}`}
        action={
          <Link className="button secondary" href={`/patients/${claim.patientId}`}>
            Back to patient
          </Link>
        }
      />

      <div className="grid-cards">
        <div className="card">
          <div className="badge">Insurance used</div>
          <div style={{ marginTop: 10 }}>
            {activeSnapshot ? (
              <div>
                  <div style={{ fontWeight: 600 }}>{activeSnapshot.payerName}</div>
                  <div className="text-muted" style={{ fontSize: 13 }}>
                    {activeSnapshot.priority} - Member {activeSnapshot.memberId}
                  </div>
                  {activeSnapshot.employerName ? (
                    <div className="text-muted" style={{ fontSize: 13 }}>
                      Employer: {activeSnapshot.employerName}
                    </div>
                  ) : null}
                  {activeSnapshot.lastVerifiedAt ? (
                    <div className="text-muted" style={{ fontSize: 13 }}>
                      Last verified: {formatDate(activeSnapshot.lastVerifiedAt)}
                    </div>
                  ) : null}
                  <div className="text-muted" style={{ fontSize: 13, marginTop: 6 }}>
                    Reason: {insuranceReasonText}
                  </div>
                  {activeSnapshot.copayAmount ? (
                    <div className="text-muted" style={{ fontSize: 13, marginTop: 6 }}>
                      Expected copay: {formatCurrency(Number(activeSnapshot.copayAmount))}
                    </div>
                  ) : null}
                  {submissionSnapshot ? (
                    <div className="text-muted" style={{ fontSize: 12, marginTop: 6 }}>
                      Current submission uses the latest insurance snapshot.
                    </div>
                  ) : null}
              </div>
            ) : (
              <div>
                <div style={{ fontWeight: 600 }}>Self-pay visit</div>
                <div className="text-muted" style={{ fontSize: 13, marginTop: 6 }}>
                  No insurance snapshot on file. Patient is responsible for the balance.
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="card">
          <div className="badge">Balance summary</div>
          <div className="section-title" style={{ fontSize: 26, marginTop: 10 }}>
            {formatCurrency(summary.currentBalance)}
          </div>
          <div className="text-muted" style={{ marginTop: 8 }}>
            Charges {formatCurrency(summary.totalCharges)} - Credits {formatCurrency(summary.totalCredits)}
          </div>
          <div className="text-muted" style={{ marginTop: 6 }}>
            Insurance paid: {formatCurrency(breakdown.insurancePaid)}
          </div>
          <div className="text-muted" style={{ marginTop: 6 }}>
            {patientPaymentLabel}: {formatCurrency(breakdown.patientPayments)}
          </div>
          {breakdown.copayCollected > 0 ? (
            <div className="text-muted" style={{ marginTop: 6 }}>
              Copay collected: {formatCurrency(breakdown.copayCollected)}
            </div>
          ) : copayExpected ? (
            <div className="text-muted" style={{ marginTop: 6 }}>
              Copay collected: {formatCurrency(0)}
            </div>
          ) : null}
          <div className="text-muted" style={{ marginTop: 6 }}>
            Adjustments: {formatCurrency(breakdown.adjustments)}
          </div>
          <div className="text-muted" style={{ marginTop: 6 }}>
            Paid to date: {formatCurrency(paidToDate)}
          </div>
          {summary.currentBalance < -0.005 ? (
            <div className="text-muted" style={{ marginTop: 6 }}>
              Credit balance: {formatCurrency(Math.abs(summary.currentBalance))}
            </div>
          ) : null}
          <div className="text-muted" style={{ marginTop: 8 }}>
            Last zero balance: {summary.lastZeroAt ? formatDate(summary.lastZeroAt) : 'Not reached'}
          </div>
          {resubmissionInProgress ? (
            <div style={{ marginTop: 10, display: 'grid', gap: 6 }}>
              <div className="badge" style={{ width: 'fit-content', background: 'rgba(245, 158, 11, 0.2)' }}>
                Resubmitted claim in progress
              </div>
              <div className="text-muted">{resubmissionNote}</div>
              <div className="text-muted" style={{ fontSize: 12 }}>
                If the patient pays now and insurance later pays, a credit will appear on the account.
              </div>
            </div>
          ) : null}
          {summary.unappliedCredits.length > 0 ? (
            <div className="badge" style={{ marginTop: 12, background: 'rgba(245, 158, 11, 0.2)' }}>
              Unapplied credits: {summary.unappliedCredits.length}
            </div>
          ) : null}
        </div>
      </div>

      <div className="grid-cards">
        <ClaimDecisionForm
          claimId={claim.id}
          balanceDue={summary.currentBalance}
          expectedCopay={copayExpected}
          copayCollected={breakdown.copayCollected}
        />
        <ClaimResubmissionForm
          claimId={claim.id}
          policies={policyOptions}
          originalSnapshot={
            snapshot
              ? {
                  payerName: snapshot.payerName,
                  memberId: snapshot.memberId,
                  priority: snapshot.priority,
                  employerName: snapshot.employerName ?? null,
                  lastVerifiedAt: snapshot.lastVerifiedAt ?? null,
                  copayAmount: snapshot.copayAmount ?? null
                }
              : null
          }
        />
        <PatientPaymentForm
          claimId={claim.id}
          balanceDue={summary.currentBalance}
          expectedCopay={copayExpected}
          selfPay={isSelfPay}
          billingHold={
            resubmissionInProgress
              ? {
                  active: true,
                  message: resubmissionNote
                }
              : undefined
          }
        />
      </div>

      <div className="grid-cards">
        <div className="card">
          <SectionHeader title="Claim decisions" subtitle="Denials and approvals with payer notes." />
          <div style={{ display: 'grid', gap: 12, marginTop: 12 }}>
            {claim.decisions.length === 0 ? (
              <div className="text-muted">No decisions recorded yet.</div>
            ) : (
              claim.decisions.map((decision) => (
                <div key={decision.id} className="card" style={{ padding: 12 }}>
                  <div style={{ fontWeight: 600 }}>
                    {decision.status} - {formatDate(decision.occurredAt)}
                  </div>
                  <div className="text-muted" style={{ marginTop: 6 }}>
                    {decision.reasonText}
                  </div>
                  {decision.reasonCode ? (
                    <div className="text-muted" style={{ fontSize: 12 }}>
                      Code: {decision.reasonCode}
                    </div>
                  ) : null}
                </div>
              ))
            )}
          </div>
        </div>

        <div className="card">
          <SectionHeader title="Submission history" subtitle="Each submission snapshot is captured immutably." />
          <div style={{ display: 'grid', gap: 12, marginTop: 12 }}>
            {claim.submissions.length === 0 ? (
              <div className="text-muted">No submissions recorded yet.</div>
            ) : (
              claim.submissions.map((submission, index) => (
                <div key={submission.id} className="card" style={{ padding: 12 }}>
                  <div style={{ fontWeight: 600 }}>
                    {index === claim.submissions.length - 1 ? 'Initial submission' : 'Resubmission'} -{' '}
                    {formatDate(submission.createdAt)}
                  </div>
                  <div className="text-muted" style={{ fontSize: 13, marginTop: 4 }}>
                    {submission.insurancePolicy
                      ? `${submission.insurancePolicy.payerName} (${submission.insurancePolicy.priority})`
                      : submission.insuranceSnapshot
                      ? `${(submission.insuranceSnapshot as { payerName?: string }).payerName ?? 'Snapshot'}`
                      : 'Self-pay'}
                  </div>
                  <div className="text-muted" style={{ marginTop: 6 }}>{submission.reason}</div>
                  {submission.packetId ? (
                    <Link className="button secondary" href={`/claims/${claim.id}?type=PAYER&packetId=${submission.packetId}`}>
                      View payer packet
                    </Link>
                  ) : null}
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      <Timeline events={claim.ledger} />

      {explanation ? <ExplanationEditor explanation={explanation} /> : null}

      <div className="card">
        <SectionHeader title="Claim packets" subtitle="Payer packet and patient statement." />
        <div style={{ display: 'grid', gap: 12, marginTop: 12 }}>
          {(['PAYER', 'PATIENT'] as const).map((packetType) => {
            const packet = [...claim.packets]
              .filter((entry) => entry.type === packetType)
              .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
            return (
              <Link
                key={packetType}
                href={`/claims/${claim.id}?type=${packetType}`}
                className="card"
                style={{ padding: 12 }}
              >
                <div style={{ fontWeight: 600 }}>
                  {packetType === 'PAYER' ? 'Payer claim packet' : 'Patient statement'}
                </div>
                <div className="text-muted" style={{ fontSize: 13 }}>
                  {packet ? `Generated ${formatDate(packet.createdAt)}` : 'Generated from ledger snapshot'}
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}
