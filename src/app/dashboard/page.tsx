import Link from 'next/link';
import { prisma } from '@/shared/domain/db';
import { getAnalyticsSnapshot } from '@/analytics/analytics';
import { StatCard } from '@/components/StatCard';
import { computeCurrentBalance } from '@/ledger/ledger';
import { formatCurrency, formatDate, formatPercent } from '@/shared/domain/format';
import { ActionBar } from '@/components/ui/ActionBar';
import { EmptyState } from '@/components/ui/EmptyState';
import { InfoCard } from '@/components/ui/InfoCard';
import { PageHeader } from '@/components/ui/PageHeader';
import { PillBadge } from '@/components/ui/PillBadge';
import { SectionStack } from '@/components/ui/SectionStack';

function clampPercent(value: number): number {
  if (Number.isNaN(value) || !Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(100, value));
}

export default async function DashboardPage() {
  const snapshot = await getAnalyticsSnapshot();
  const [latestClaim, latestFlag] = await Promise.all([
    prisma.claim.findFirst({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        createdAt: true,
        status: true,
        patient: { select: { firstName: true, lastName: true } },
        ledger: { select: { amount: true, type: true } }
      }
    }),
    prisma.flag.findFirst({
      where: { status: 'OPEN' },
      orderBy: { lastDetectedAt: 'desc' },
      select: {
        likelyIssue: true,
        source: true,
        lastDetectedAt: true,
        patient: { select: { firstName: true, lastName: true } },
        claim: { select: { patient: { select: { firstName: true, lastName: true } } } }
      }
    })
  ]);

  const latestClaimBalance = latestClaim ? computeCurrentBalance(latestClaim.ledger) : null;
  const topRootCauses = snapshot.rootCauseDistribution.slice(0, 3);
  const maxRootCause = Math.max(...topRootCauses.map((item) => item.count), 1);
  const topBalances = snapshot.topBalances.slice(0, 3);
  const averageBalanceLabel =
    snapshot.averageBalanceDue === null ? 'N/A' : formatCurrency(snapshot.averageBalanceDue);
  const insuranceAmbiguityLabel =
    snapshot.claimCount === 0 ? 'N/A' : formatPercent(snapshot.insuranceAmbiguityRate);
  const denialRateLabel = snapshot.claimCount === 0 ? 'N/A' : formatPercent(snapshot.denialRate);
  const flagPatientName = latestFlag?.claim?.patient
    ? `${latestFlag.claim.patient.firstName} ${latestFlag.claim.patient.lastName}`
    : latestFlag?.patient
      ? `${latestFlag.patient.firstName} ${latestFlag.patient.lastName}`
      : 'No patient';

  return (
    <SectionStack>
      <PageHeader
        title="Dashboard"
        subtitle="Actionable pulse on claim health, revenue risk, and next steps."
        actions={
          <ActionBar>
            <Link className="button" href="/intake">
              Start new intake
            </Link>
            <Link className="button secondary" href="/analytics">
              Open analytics
            </Link>
          </ActionBar>
        }
      />

      <section className="section-stack">
        <h2 className="section-title page-title">Key metrics</h2>
        <div className="grid-cards">
          <StatCard
            title="Outstanding balance"
            value={formatCurrency(snapshot.outstandingBalance)}
            description={`${snapshot.claimsWithBalance} claim(s) with balance due. Avg balance ${averageBalanceLabel}.`}
            accent="#f97316"
          />
          <StatCard
            title="Payments (last 30 days)"
            value={formatCurrency(snapshot.paymentsLast30Days)}
            description={`Adjustments ${formatCurrency(snapshot.adjustmentsLast30Days)} in the same window.`}
            accent="#0d9488"
          />
          <StatCard
            title="Denial rate"
            value={denialRateLabel}
            description="Based on current claim statuses."
            accent="#f59e0b"
          />
          <StatCard
            title="Avg days to payment"
            value={
              snapshot.averageDaysToPayment === null
                ? 'N/A'
                : `${snapshot.averageDaysToPayment.toFixed(1)} days`
            }
            description="Derived from submitted vs payment events."
            accent="#38bdf8"
          />
        </div>
      </section>

      <section className="section-stack">
        <h2 className="section-title page-title">Action center</h2>
        <div className="grid-cards">
          <StatCard
            title="Open flags"
            value={`${snapshot.openFlagsCount}`}
            description="Flags awaiting review or verification."
            href="/review"
            highlight={snapshot.openFlagsCount > 0}
            accent="#f97316"
          />
          <StatCard
            title="Awaiting payer"
            value={`${snapshot.claimsAwaitingPayment}`}
            description="Submitted with no payer payment yet."
            href="/billing?view=awaiting"
            highlight={snapshot.claimsAwaitingPayment > 0}
            accent="#38bdf8"
          />
          <StatCard
            title="Balances due"
            value={`${snapshot.claimsWithBalance}`}
            description={`Avg balance ${averageBalanceLabel}.`}
            href="/billing?view=balance"
            highlight={snapshot.claimsWithBalance > 0}
            accent="#f59e0b"
          />
          <StatCard
            title="Insurance confirmation"
            value={`${snapshot.insuranceAmbiguityCount}`}
            description={`Ambiguity rate ${insuranceAmbiguityLabel}.`}
            href="/review?group=insurance"
            highlight={snapshot.insuranceAmbiguityCount > 0}
            accent="#eab308"
          />
          <StatCard
            title="Self-pay claims"
            value={`${snapshot.selfPayClaimCount}`}
            description="Claims without an insurance snapshot."
            href="/billing?view=selfpay"
            highlight={snapshot.selfPayClaimCount > 0}
            accent="#64748b"
          />
        </div>
      </section>

      <section className="section-duo">
        <InfoCard
          badge={<PillBadge tone="warn">Risk drivers</PillBadge>}
          subtitle="Open flags and insurance ambiguity drive rework and delayed payments."
        >
          <div className="list-stack">
            {topRootCauses.length === 0 ? (
              <EmptyState title="No open flags detected." />
            ) : (
              topRootCauses.map((item) => (
                <Link
                  key={item.label}
                  href={`/review?issue=${encodeURIComponent(item.label)}`}
                  className="card"
                  style={{ padding: 12 }}
                >
                  <div className="row-between">
                    <div className="strong">{item.label}</div>
                    <div className="text-muted text-xs">
                      {item.count} flag{item.count === 1 ? '' : 's'}
                    </div>
                  </div>
                  <div
                    style={{
                      marginTop: 8,
                      height: 8,
                      background: 'rgba(15, 23, 42, 0.08)',
                      borderRadius: 999
                    }}
                  >
                    <div
                      style={{
                        height: '100%',
                        width: `${clampPercent((item.count / maxRootCause) * 100)}%`,
                        background: '#f97316',
                        borderRadius: 999
                      }}
                    />
                  </div>
                </Link>
              ))
            )}
          </div>
          <ActionBar>
            <PillBadge tone="warn">
              Insurance ambiguity: {insuranceAmbiguityLabel} ({snapshot.insuranceAmbiguityCount})
            </PillBadge>
            <PillBadge tone="neutral">Self-pay claims: {snapshot.selfPayClaimCount}</PillBadge>
          </ActionBar>
          <ActionBar>
            <Link className="button secondary" href="/review">
              Review open flags
            </Link>
            <Link className="button secondary" href="/review?group=insurance">
              Review insurance issues
            </Link>
          </ActionBar>
        </InfoCard>

        <InfoCard
          badge={<PillBadge tone="info">Balances to watch</PillBadge>}
          subtitle={`Avg balance due ${averageBalanceLabel}. Credits on file ${formatCurrency(snapshot.creditBalance)} across ${snapshot.claimsWithCredits} claim(s).`}
        >
          <div className="list-stack">
            {topBalances.length === 0 ? (
              <EmptyState title="No outstanding balances right now." />
            ) : (
              topBalances.map((entry) => (
                <Link
                  key={entry.patientId}
                  href={`/patients/${entry.patientId}`}
                  className="card"
                  style={{ padding: 12 }}
                >
                  <div className="row-between">
                    <div className="strong">{entry.name}</div>
                    <div className="strong">{formatCurrency(entry.balance)}</div>
                  </div>
                  <div className="text-muted text-xs">Patient balance due</div>
                </Link>
              ))
            )}
          </div>
          <ActionBar>
            <Link className="button secondary" href="/billing?view=balance">
              Balance queue
            </Link>
            <Link className="button secondary" href="/billing?view=credit">
              Review credits
            </Link>
          </ActionBar>
        </InfoCard>
      </section>

      <InfoCard badge={<PillBadge>Latest activity</PillBadge>}>
        <div className="section-stack">
          <div className="list-stack">
            <div className="text-muted text-xs">Latest claim</div>
            {latestClaim ? (
              <div className="row-between">
                <div>
                  <div className="strong">
                    {latestClaim.patient.firstName} {latestClaim.patient.lastName}
                  </div>
                  <div className="text-muted text-sm">
                    {formatDate(latestClaim.createdAt)} - {latestClaim.status}
                  </div>
                </div>
                <div className="strong">
                  {latestClaimBalance === null ? 'N/A' : formatCurrency(latestClaimBalance)}
                </div>
              </div>
            ) : (
              <EmptyState title="No claims have been created yet." />
            )}
          </div>
          <div className="list-stack" style={{ borderTop: '1px solid rgba(15, 23, 42, 0.08)', paddingTop: 12 }}>
            <div className="text-muted text-xs">Latest flag</div>
            {latestFlag ? (
              <div className="row-between">
                <div>
                  <div className="strong">{latestFlag.likelyIssue}</div>
                  <div className="text-muted text-sm">
                    {flagPatientName} - {formatDate(latestFlag.lastDetectedAt)}
                  </div>
                </div>
                <PillBadge tone="warn">{latestFlag.source}</PillBadge>
              </div>
            ) : (
              <EmptyState title="No open flags right now." />
            )}
          </div>
        </div>
        <ActionBar>
          <Link className="button secondary" href="/billing">
            Billing queue
          </Link>
          <Link className="button secondary" href="/review">
            Review inbox
          </Link>
          <Link className="button secondary" href="/operations">
            Daily operations
          </Link>
        </ActionBar>
      </InfoCard>
    </SectionStack>
  );
}
