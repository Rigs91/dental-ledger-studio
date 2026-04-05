import Link from 'next/link';
import { LedgerEventType } from '@prisma/client';
import { prisma } from '@/shared/domain/db';
import { StatCard } from '@/components/StatCard';
import { computeCurrentBalance } from '@/ledger/ledger';
import { formatCurrency, formatDate } from '@/shared/domain/format';
import { ActionBar } from '@/components/ui/ActionBar';
import { EmptyState } from '@/components/ui/EmptyState';
import { InfoCard } from '@/components/ui/InfoCard';
import { PageHeader } from '@/components/ui/PageHeader';
import { PillBadge } from '@/components/ui/PillBadge';
import { SectionStack } from '@/components/ui/SectionStack';

const EPSILON = 0.005;

function resolveView(value?: string) {
  switch (value) {
    case 'awaiting':
    case 'denied':
    case 'balance':
    case 'credit':
    case 'resubmitted':
    case 'selfpay':
      return value;
    default:
      return 'all';
  }
}

function resolveSort(value?: string) {
  switch (value) {
    case 'oldest':
    case 'balance':
    case 'patient':
      return value;
    default:
      return 'recent';
  }
}

export default async function BillingIndexPage({
  searchParams
}: {
  searchParams?: Promise<{ view?: string; sort?: string }>;
}) {
  const resolved = searchParams ? await searchParams : undefined;
  const view = resolveView(resolved?.view);
  const sort = resolveSort(resolved?.sort);

  const claims = await prisma.claim.findMany({
    select: {
      id: true,
      status: true,
      createdAt: true,
      insuranceSnapshot: true,
      patient: { select: { firstName: true, lastName: true } },
      ledger: { select: { amount: true, type: true } },
      submissions: {
        select: { createdAt: true, insuranceSnapshot: true },
        orderBy: { createdAt: 'desc' }
      }
    },
    orderBy: { createdAt: 'desc' }
  });

  const rows = claims.map((claim) => {
    const currentBalance = computeCurrentBalance(claim.ledger);
    const latestSubmission = claim.submissions[0];
    const activeSnapshot = latestSubmission?.insuranceSnapshot ?? claim.insuranceSnapshot;
    const isSelfPay = !activeSnapshot;
    const hasSubmission = claim.ledger.some((event) => event.type === LedgerEventType.CLAIM_SUBMITTED);
    const hasInsurancePayment = claim.ledger.some(
      (event) => event.type === LedgerEventType.INSURANCE_PAYMENT
    );
    const awaitingPayer = hasSubmission && !hasInsurancePayment && claim.status !== 'DENIED';
    const denied = claim.status === 'DENIED';
    const resubmitted = claim.submissions.length > 1;
    const balanceDue = currentBalance > EPSILON;
    const creditBalance = currentBalance < -EPSILON;

    return {
      claim,
      currentBalance,
      isSelfPay,
      awaitingPayer,
      denied,
      resubmitted,
      balanceDue,
      creditBalance
    };
  });

  const counts = rows.reduce(
    (acc, row) => {
      acc.all += 1;
      if (row.awaitingPayer) acc.awaiting += 1;
      if (row.denied) acc.denied += 1;
      if (row.balanceDue) acc.balance += 1;
      if (row.creditBalance) acc.credit += 1;
      if (row.resubmitted) acc.resubmitted += 1;
      if (row.isSelfPay) acc.selfpay += 1;
      return acc;
    },
    { all: 0, awaiting: 0, denied: 0, balance: 0, credit: 0, resubmitted: 0, selfpay: 0 }
  );

  const filtered = rows.filter((row) => {
    switch (view) {
      case 'awaiting':
        return row.awaitingPayer;
      case 'denied':
        return row.denied;
      case 'balance':
        return row.balanceDue;
      case 'credit':
        return row.creditBalance;
      case 'resubmitted':
        return row.resubmitted;
      case 'selfpay':
        return row.isSelfPay;
      default:
        return true;
    }
  });

  const sorted = [...filtered].sort((a, b) => {
    switch (sort) {
      case 'oldest':
        return new Date(a.claim.createdAt).getTime() - new Date(b.claim.createdAt).getTime();
      case 'balance':
        return b.currentBalance - a.currentBalance;
      case 'patient':
        return `${a.claim.patient.lastName} ${a.claim.patient.firstName}`.localeCompare(
          `${b.claim.patient.lastName} ${b.claim.patient.firstName}`
        );
      default:
        return new Date(b.claim.createdAt).getTime() - new Date(a.claim.createdAt).getTime();
    }
  });

  const buildUrl = (updates: Record<string, string | undefined>) => {
    const params = new URLSearchParams();
    params.set('view', view);
    params.set('sort', sort);
    Object.entries(updates).forEach(([key, value]) => {
      if (!value) {
        params.delete(key);
        return;
      }
      params.set(key, value);
    });
    const query = params.toString();
    return query.length > 0 ? `/billing?${query}` : '/billing';
  };

  return (
    <SectionStack>
      <PageHeader
        title="Billing"
        subtitle="Claim status, resubmissions, and balances in one place."
        actions={
          <ActionBar>
            <Link className="button secondary" href="/billing/denied">
              Denied resubmissions
            </Link>
            <Link className="button secondary" href="/dashboard">
              Back to dashboard
            </Link>
          </ActionBar>
        }
      />

      <div className="grid-cards">
        <StatCard
          title="Awaiting payer"
          value={`${counts.awaiting}`}
          description="Submitted with no insurance payment yet."
          href={buildUrl({ view: 'awaiting' })}
          highlight={view === 'awaiting'}
          scroll={false}
        />
        <StatCard
          title="Denied claims"
          value={`${counts.denied}`}
          description="Claims needing denial action or resubmission."
          href={buildUrl({ view: 'denied' })}
          highlight={view === 'denied'}
          scroll={false}
        />
        <StatCard
          title="Balances due"
          value={`${counts.balance}`}
          description="Claims with patient balance remaining."
          href={buildUrl({ view: 'balance' })}
          highlight={view === 'balance'}
          scroll={false}
        />
        <StatCard
          title="Credits to apply"
          value={`${counts.credit}`}
          description="Claims showing a credit balance."
          href={buildUrl({ view: 'credit' })}
          highlight={view === 'credit'}
          scroll={false}
        />
      </div>

      <InfoCard
        badge={<PillBadge tone="info">Billing queue</PillBadge>}
        subtitle={`${sorted.length} claim(s) shown`}
        actions={
          <Link className="button secondary" href="/review">
            Open review inbox
          </Link>
        }
      >
        <ActionBar>
          {[
            { id: 'all', label: 'All', count: counts.all },
            { id: 'awaiting', label: 'Awaiting payer', count: counts.awaiting },
            { id: 'denied', label: 'Denied', count: counts.denied },
            { id: 'resubmitted', label: 'Resubmitted', count: counts.resubmitted },
            { id: 'balance', label: 'Balance due', count: counts.balance },
            { id: 'credit', label: 'Credit', count: counts.credit },
            { id: 'selfpay', label: 'Self-pay', count: counts.selfpay }
          ].map((option) => (
            <Link
              key={option.id}
              className={view === option.id ? 'button' : 'button secondary'}
              href={buildUrl({ view: option.id })}
            >
              {option.label} ({option.count})
            </Link>
          ))}
          <Link className="button secondary" href="/billing/denied?filter=ready">
            Denied resubmission queue
          </Link>
        </ActionBar>

        {view === 'denied' ? (
          <div className="card" style={{ padding: 12 }}>
            <div className="list-stack">
              <PillBadge tone="warn">Denied resubmission workflow</PillBadge>
              <div className="text-muted text-xs">
                Use the denied queue to review denials, select ready claims, and resubmit in bulk.
              </div>
              <ActionBar>
                <Link className="button" href="/billing/denied?filter=ready">
                  Open resubmission queue
                </Link>
                <Link className="button secondary" href="/review?group=denials">
                  Review denial flags
                </Link>
              </ActionBar>
            </div>
          </div>
        ) : null}

        <ActionBar>
          {[
            { id: 'recent', label: 'Newest' },
            { id: 'oldest', label: 'Oldest' },
            { id: 'balance', label: 'Highest balance' },
            { id: 'patient', label: 'Patient name' }
          ].map((option) => (
            <Link
              key={option.id}
              className={sort === option.id ? 'button' : 'button secondary'}
              href={buildUrl({ sort: option.id })}
            >
              Sort: {option.label}
            </Link>
          ))}
        </ActionBar>

        <div className="list-stack">
          {sorted.length === 0 ? (
            <EmptyState title="No claims match this filter." />
          ) : (
            sorted.map((row) => {
              const claim = row.claim;
              const statusLabel = row.creditBalance
                ? 'Credit balance'
                : row.currentBalance <= EPSILON
                  ? 'Paid'
                  : 'Balance due';

              return (
                <Link key={claim.id} href={`/billing/${claim.id}`} className="card" style={{ padding: 14 }}>
                  <div className="row-between" style={{ alignItems: 'flex-start' }}>
                    <div>
                      <div className="strong">{`${claim.patient.firstName} ${claim.patient.lastName}`}</div>
                      <div className="text-muted text-sm">
                        {formatDate(claim.createdAt)} - {claim.status}
                      </div>
                      <div className="text-muted text-xs" style={{ marginTop: 4 }}>
                        {statusLabel}
                        {row.isSelfPay ? ' | Self-pay' : ''}
                        {row.resubmitted ? ' | Resubmitted' : ''}
                      </div>
                    </div>
                    <div className="strong">{formatCurrency(row.currentBalance)}</div>
                  </div>
                </Link>
              );
            })
          )}
        </div>
      </InfoCard>
    </SectionStack>
  );
}
