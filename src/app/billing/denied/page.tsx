import Link from 'next/link';
import { prisma } from '@/shared/domain/db';
import { StatCard } from '@/components/StatCard';
import { computeCurrentBalance } from '@/ledger/ledger';
import { formatCurrency, formatDate } from '@/shared/domain/format';
import DeniedResubmissionQueue, { type DeniedClaimSummary } from '@/components/DeniedResubmissionQueue';
import { resolveInsuranceContextFromHistory } from '@/claims/services/insuranceSnapshot';
import { ActionBar } from '@/components/ui/ActionBar';
import { PageHeader } from '@/components/ui/PageHeader';
import { SectionStack } from '@/components/ui/SectionStack';

export default async function DeniedClaimsResubmissionPage({
  searchParams
}: {
  searchParams?: Promise<{ filter?: string }>;
}) {
  const resolved = searchParams ? await searchParams : undefined;
  const filter = resolved?.filter ?? null;
  const claims = await prisma.claim.findMany({
    where: { status: 'DENIED' },
    select: {
      id: true,
      patientId: true,
      insuranceSnapshot: true,
      insurancePolicyId: true,
      insuranceReason: true,
      patient: { select: { firstName: true, lastName: true } },
      visit: { select: { dateOfService: true } },
      ledger: { select: { amount: true } },
      submissions: {
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true, insuranceSnapshot: true, insurancePolicyId: true, reason: true }
      },
      decisions: {
        orderBy: { occurredAt: 'desc' },
        select: { reasonText: true, reasonCode: true }
      }
    },
    orderBy: { createdAt: 'desc' }
  });

  const summaries: DeniedClaimSummary[] = claims.map((claim) => {
    const balance = computeCurrentBalance(claim.ledger);
    const latestDecision = claim.decisions[0];
    const insuranceContext = resolveInsuranceContextFromHistory({
      claimInsuranceSnapshot: claim.insuranceSnapshot,
      claimInsurancePolicyId: claim.insurancePolicyId ?? null,
      claimInsuranceReason: claim.insuranceReason,
      submissions: claim.submissions
    });
    const snapshot = insuranceContext.snapshot;
    const payerLabel = snapshot ? `${snapshot.payerName} (${snapshot.priority})` : null;
    const denialReason = latestDecision?.reasonText ?? 'No denial reason recorded.';
    return {
      id: claim.id,
      patientId: claim.patientId,
      patientName: `${claim.patient.firstName} ${claim.patient.lastName}`,
      dateOfService: formatDate(claim.visit.dateOfService),
      balance,
      denialReason,
      denialCode: latestDecision?.reasonCode ?? null,
      lastSubmissionAt: claim.submissions[0] ? formatDate(claim.submissions[0].createdAt) : null,
      submissionCount: claim.submissions.length,
      snapshotLabel: payerLabel,
      memberId: snapshot?.memberId ?? null,
      hasSnapshot: Boolean(snapshot)
    };
  });

  const readyCount = summaries.filter((claim) => claim.hasSnapshot).length;
  const needsPolicyCount = summaries.length - readyCount;
  const totalBalance = summaries.reduce((total, claim) => total + claim.balance, 0);

  return (
    <SectionStack>
      <PageHeader
        title="Denied Claims Resubmission"
        subtitle="Review denied claims, resubmit one-by-one, or approve a bulk batch."
        actions={
          <ActionBar>
            <Link className="button secondary" href="/billing?view=denied">
              Back to billing queue
            </Link>
            <Link className="button secondary" href="/review?group=denials">
              Denial review flags
            </Link>
          </ActionBar>
        }
      />

      <div className="grid-cards">
        <StatCard
          title="Denied claims"
          value={`${summaries.length}`}
          description="Claims currently in denied status."
          accent="#f97316"
        />
        <StatCard
          title="Ready to resubmit"
          value={`${readyCount}`}
          description="Denied claims with an original snapshot available."
          accent="#0d9488"
        />
        <StatCard
          title="Needs policy review"
          value={`${needsPolicyCount}`}
          description="Claims missing a usable snapshot."
          accent="#f59e0b"
        />
        <StatCard
          title="Denied balance"
          value={formatCurrency(totalBalance)}
          description="Total balance currently tied up in denials."
          accent="#38bdf8"
        />
      </div>

      <DeniedResubmissionQueue claims={summaries} initialFilter={filter} />
    </SectionStack>
  );
}
