import Link from 'next/link';
import { prisma } from '@/shared/domain/db';
import { SectionHeader } from '@/components/StatCard';
import FlagResolutionForm from '../FlagResolutionForm';
import ProcedureReviewForm from '../ProcedureReviewForm';
import { Timeline } from '@/components/Timeline';
import { formatDate, formatCurrency } from '@/shared/domain/format';
import { getFlagInsight } from '@/review/flagInsights';
import { buildLedgerSummary } from '@/ledger/ledger';

export default async function ReviewDetailPage({
  params,
  searchParams
}: {
  params: Promise<{ flagId?: string }>;
  searchParams?: Promise<{ procedureId?: string }>;
}) {
  const { flagId } = await params;
  const resolvedSearch = searchParams ? await searchParams : undefined;
  if (!flagId) {
    return <div className="card">Missing flag ID. Return to the review inbox and try again.</div>;
  }

  const flag = await prisma.flag.findUnique({
    where: { id: flagId },
    include: {
      claim: {
        include: { patient: true, ledger: true, visit: { include: { procedures: true } } }
      },
      patient: true
    }
  });

  if (!flag) {
    return <div className="card">Flag not found.</div>;
  }

  const lowConfidenceProcedures =
    flag.claim?.visit?.procedures.filter((procedure) => {
      const status = procedure.reviewStatus ?? 'PENDING';
      return procedure.confidence < 0.7 && status === 'PENDING';
    }) ?? [];
  const showProcedureContext = flag.likelyIssue.toLowerCase().includes('low coding confidence');
  const selectedProcedureId = resolvedSearch?.procedureId;
  const selectedProcedure = selectedProcedureId
    ? flag.claim?.visit?.procedures.find((procedure) => procedure.id === selectedProcedureId) ?? null
    : null;
  const insight = getFlagInsight(flag.likelyIssue, flag.recommendedAction);
  const claimBalance = flag.claim ? buildLedgerSummary(flag.claim.ledger).currentBalance : null;

  return (
    <div style={{ display: 'grid', gap: 24 }}>
      <SectionHeader
        title="Flag Review"
        subtitle={`Flag ${flag.id} - ${flag.source}`}
        action={
          <Link className="button secondary" href="/review">
            Back to inbox
          </Link>
        }
      />

      <div className="grid-cards">
        <div className="card">
          <div className="badge">Flag details</div>
          <div style={{ marginTop: 12, display: 'grid', gap: 6 }}>
            <div style={{ fontWeight: 600 }}>{flag.likelyIssue}</div>
            <div className="text-muted">Confidence: {(flag.confidence * 100).toFixed(0)}%</div>
            <div className="text-muted">Recommended action: {flag.recommendedAction}</div>
            <div className="text-muted">Last detected: {formatDate(flag.lastDetectedAt)}</div>
            <div className="badge" style={{ width: 'fit-content' }}>
              Status: {flag.status}
            </div>
          </div>
        </div>

        <div className="card">
          <div className="badge">Why this flag exists</div>
          <div style={{ marginTop: 12, display: 'grid', gap: 8 }}>
            <div style={{ fontWeight: 600 }}>{insight.summary}</div>
            <div className="text-muted">Root cause: {insight.cause}</div>
            <div className="text-muted">How to fix: {insight.fix}</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 6 }}>
              <Link className="button secondary" href={`/patients/${flag.patientId}`}>
                Patient profile
              </Link>
              {flag.claim ? (
                <Link className="button secondary" href={`/billing/${flag.claim.id}`}>
                  Billing timeline
                </Link>
              ) : null}
            </div>
          </div>
        </div>

        <div className="card">
          <div className="badge">Patient</div>
          <div style={{ marginTop: 10, fontWeight: 600 }}>
            {flag.claim?.patient
              ? `${flag.claim.patient.firstName} ${flag.claim.patient.lastName}`
              : `${flag.patient.firstName} ${flag.patient.lastName}`}
          </div>
          {flag.claim ? (
            <>
              <div className="text-muted" style={{ marginTop: 6 }}>
                Claim: {flag.claim.id}
              </div>
              <div className="text-muted" style={{ marginTop: 6 }}>
                Date of service: {formatDate(flag.claim.visit.dateOfService)}
              </div>
              {typeof claimBalance === 'number' ? (
                <div className="text-muted" style={{ marginTop: 6 }}>
                  Current balance: {formatCurrency(claimBalance)}
                </div>
              ) : null}
              <Link className="button secondary" href={`/billing/${flag.claim.id}`} style={{ marginTop: 12 }}>
                View billing timeline
              </Link>
            </>
          ) : (
            <div className="text-muted" style={{ marginTop: 6 }}>
              No claim attached. Review patient timeline and insurance history.
            </div>
          )}
        </div>
        {showProcedureContext && flag.claim ? (
          <div className="card">
            <div className="badge">Procedures needing review</div>
            <div style={{ marginTop: 12, display: 'grid', gap: 10 }}>
              {lowConfidenceProcedures.length === 0 ? (
                <div className="text-muted">All low-confidence procedures have been reviewed.</div>
              ) : (
                lowConfidenceProcedures.map((procedure) => (
                  <div key={procedure.id} className="card" style={{ padding: 12 }}>
                    <div style={{ fontWeight: 600 }}>
                      {procedure.selectedLabel ?? procedure.freeText}
                    </div>
                    <div className="text-muted" style={{ fontSize: 13 }}>
                      Code: {procedure.selectedCode ?? 'Pending'} | Confidence {procedure.confidence.toFixed(2)}
                    </div>
                    <div className="text-muted" style={{ fontSize: 12 }}>
                      Rationale: {procedure.rationale}
                    </div>
                    <Link
                      className="button secondary"
                      href={`/review/${flag.id}?procedureId=${procedure.id}`}
                      style={{ marginTop: 8 }}
                    >
                      Review this procedure
                    </Link>
                  </div>
                ))
              )}
            </div>
          </div>
        ) : null}
      </div>

      {selectedProcedure ? (
        <ProcedureReviewForm procedure={selectedProcedure} />
      ) : showProcedureContext && flag.claim ? (
        <div className="card">
          <div className="badge">Procedure review</div>
          <div className="text-muted" style={{ marginTop: 10 }}>
            Select a procedure above to review or update the CDT code.
          </div>
        </div>
      ) : null}

      {flag.claim ? <Timeline events={flag.claim.ledger} /> : null}

      <FlagResolutionForm flagId={flag.id} />
    </div>
  );
}
