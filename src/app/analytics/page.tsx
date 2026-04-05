import Link from 'next/link';
import { getAnalyticsReport, type AnalyticsRangeKey } from '@/analytics/analytics';
import { StatCard } from '@/components/StatCard';
import { ActionBar } from '@/components/ui/ActionBar';
import { EmptyState } from '@/components/ui/EmptyState';
import { InfoCard } from '@/components/ui/InfoCard';
import { PageHeader } from '@/components/ui/PageHeader';
import { PillBadge } from '@/components/ui/PillBadge';
import { SectionStack } from '@/components/ui/SectionStack';
import { formatCurrency, formatDate, formatPercent } from '@/shared/domain/format';

type TrendTone = 'positive' | 'negative' | 'neutral';

type PriorityAction = {
  id: string;
  title: string;
  detail: string;
  href: string;
};

function resolveRangeKey(value?: string): AnalyticsRangeKey {
  if (value === 'day' || value === 'week' || value === 'month') {
    return value;
  }
  return 'month';
}

function formatRatio(value: number | null): string {
  if (value === null) {
    return 'N/A';
  }
  return formatPercent(value);
}

function formatDays(value: number | null): string {
  if (value === null) {
    return 'N/A';
  }
  return `${value.toFixed(1)} days`;
}

function buildTrend(
  current: number | null,
  previous: number | null,
  positiveIsGood = true
): { label: string; tone: TrendTone } {
  if (current === null || previous === null) {
    return { label: 'No prior data', tone: 'neutral' };
  }
  const delta = current - previous;
  if (Math.abs(delta) < 0.001) {
    return { label: 'Flat vs prior', tone: 'neutral' };
  }
  if (Math.abs(previous) < 0.001) {
    return { label: 'New this period', tone: 'neutral' };
  }
  const percent = Math.round(Math.abs((delta / previous) * 100));
  const improving = positiveIsGood ? delta > 0 : delta < 0;
  return {
    label: `${percent}% vs prior`,
    tone: improving ? 'positive' : 'negative'
  };
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value) || Number.isNaN(value)) {
    return 0;
  }
  return Math.max(0, Math.min(100, value));
}

function MetricTrack({
  label,
  value,
  hint,
  color
}: {
  label: string;
  value: number | null;
  hint: string;
  color: string;
}) {
  const percent = value === null ? 0 : clampPercent(value * 100);
  return (
    <div style={{ display: 'grid', gap: 6 }}>
      <div className="row-between">
        <div className="strong">{label}</div>
        <div className="text-muted text-xs">{value === null ? 'N/A' : `${Math.round(percent)}%`}</div>
      </div>
      <div style={{ height: 10, borderRadius: 999, background: 'rgba(15, 23, 42, 0.08)' }}>
        <div
          style={{
            height: '100%',
            width: `${percent}%`,
            borderRadius: 999,
            background: color
          }}
        />
      </div>
      <div className="text-muted text-xs">{hint}</div>
    </div>
  );
}

function TrendBadge({ label, tone }: { label: string; tone: TrendTone }) {
  const color = tone === 'positive' ? '#0d9488' : tone === 'negative' ? '#f97316' : '#64748b';
  return (
    <span
      style={{
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: '0.06em',
        textTransform: 'uppercase',
        color,
        background: `${color}1a`,
        borderRadius: 999,
        padding: '4px 10px'
      }}
    >
      {label}
    </span>
  );
}

export default async function AnalyticsPage({
  searchParams
}: {
  searchParams?: Promise<{ range?: string }>;
}) {
  const resolved = searchParams ? await searchParams : undefined;
  const rangeKey = resolveRangeKey(resolved?.range);
  const report = await getAnalyticsReport(rangeKey);

  const collectionCoverage =
    report.metrics.charges === 0 ? null : report.metrics.payments / report.metrics.charges;
  const adjustmentCoverage =
    report.metrics.charges === 0 ? null : report.metrics.adjustments / report.metrics.charges;
  const atRiskShare =
    report.metrics.charges === 0
      ? null
      : report.metrics.opportunityAtRisk / report.metrics.charges;

  const topRootCause = report.rootCauseDistribution[0];
  const priorityActions: PriorityAction[] = [
    ...(report.metrics.opportunityAtRisk > 0.005
      ? [
          {
            id: 'risk',
            title: 'Revenue at risk needs triage',
            detail: `${formatCurrency(report.metrics.opportunityAtRisk)} is tied to denials and open flags.`,
            href: topRootCause ? `/review?issue=${encodeURIComponent(topRootCause.label)}` : '/review'
          }
        ]
      : []),
    ...((report.metrics.denialRate ?? 0) >= 0.08
      ? [
          {
            id: 'denials',
            title: 'Denial rate is above target',
            detail: `Current denial rate is ${formatRatio(report.metrics.denialRate)}. Tighten coding + documentation review.`,
            href: '/review?group=denials'
          }
        ]
      : []),
    ...((report.metrics.resubmissionRate ?? 0) >= 0.15
      ? [
          {
            id: 'rework',
            title: 'Resubmission rework is high',
            detail: `${formatRatio(report.metrics.resubmissionRate)} of submitted claims were resubmitted this window.`,
            href: '/billing'
          }
        ]
      : []),
    ...((report.metrics.averageDaysToPayment ?? 0) > 21
      ? [
          {
            id: 'cash-cycle',
            title: 'Payment cycle is slower than expected',
            detail: `Average days to payment is ${formatDays(report.metrics.averageDaysToPayment)}.`,
            href: '/billing?view=awaiting'
          }
        ]
      : []),
    ...((report.metrics.insuranceAmbiguityRate ?? 0) > 0.1
      ? [
          {
            id: 'insurance',
            title: 'Insurance ambiguity is creating friction',
            detail: `${formatRatio(report.metrics.insuranceAmbiguityRate)} of submitted claims needed confirmation.`,
            href: '/review?group=insurance'
          }
        ]
      : [])
  ].slice(0, 3);

  return (
    <SectionStack>
      <PageHeader
        title="Analytics"
        subtitle={`Focused KPI view for ${report.range.label}. ${formatDate(report.range.start)} - ${formatDate(
          report.range.end
        )}.`}
        actions={
          <ActionBar>
            {[
              { key: 'day', label: 'Today' },
              { key: 'week', label: 'Last 7 days' },
              { key: 'month', label: 'Last 30 days' }
            ].map((option) => (
              <Link
                key={option.key}
                className={rangeKey === option.key ? 'button' : 'button secondary'}
                href={`/analytics?range=${option.key}`}
              >
                {option.label}
              </Link>
            ))}
          </ActionBar>
        }
      />

      <div
        className="card"
        style={{
          display: 'grid',
          gap: 16,
          background:
            'linear-gradient(145deg, rgba(15, 23, 42, 0.03) 0%, rgba(45, 212, 191, 0.12) 100%)',
          border: '1px solid rgba(13, 148, 136, 0.24)'
        }}
      >
        <div className="row-between">
          <div className="badge">Most Important Signals</div>
          <div className="text-muted text-sm">Compared with prior window of the same length</div>
        </div>

        <div className="grid-cards">
          <div className="panel solid" style={{ display: 'grid', gap: 8 }}>
            <div className="text-muted text-xs">North Star</div>
            <div className="section-title" style={{ fontSize: 28 }}>
              {formatRatio(report.metrics.netCollectionRate)}
            </div>
            <div className="text-muted text-sm">Net collection rate</div>
            <TrendBadge
              {...buildTrend(report.metrics.netCollectionRate, report.previous.netCollectionRate)}
            />
          </div>

          <div className="panel solid" style={{ display: 'grid', gap: 8 }}>
            <div className="text-muted text-xs">Revenue Leakage</div>
            <div className="section-title" style={{ fontSize: 28 }}>
              {formatCurrency(report.metrics.opportunityAtRisk)}
            </div>
            <div className="text-muted text-sm">
              Denied {formatCurrency(report.metrics.deniedBalance)} + flagged{' '}
              {formatCurrency(report.metrics.openFlagBalance)}
            </div>
            <TrendBadge
              {...buildTrend(
                report.metrics.opportunityAtRisk,
                report.previous.opportunityAtRisk,
                false
              )}
            />
          </div>

          <div className="panel solid" style={{ display: 'grid', gap: 8 }}>
            <div className="text-muted text-xs">Claim Quality</div>
            <div className="section-title" style={{ fontSize: 28 }}>
              {formatRatio(report.metrics.cleanClaimRate)}
            </div>
            <div className="text-muted text-sm">Clean claim rate on this submission cohort</div>
            <TrendBadge
              {...buildTrend(report.metrics.cleanClaimRate, report.previous.cleanClaimRate)}
            />
          </div>
        </div>

        <ActionBar>
          <Link className="button" href="/review">
            Review open flags
          </Link>
          <Link className="button secondary" href="/billing">
            Work claim queue
          </Link>
          <Link className="button secondary" href="/operations">
            Align upstream operations
          </Link>
        </ActionBar>
      </div>

      <section className="section-stack">
        <h2 className="section-title page-title">Core KPIs</h2>
        <div className="grid-cards">
          <StatCard
            title="Net collection rate"
            value={formatRatio(report.metrics.netCollectionRate)}
            description="(Payments + adjustments) / charges."
            accent="#0d9488"
            trend={buildTrend(report.metrics.netCollectionRate, report.previous.netCollectionRate)}
          />
          <StatCard
            title="Opportunity at risk"
            value={formatCurrency(report.metrics.opportunityAtRisk)}
            description="Denied and newly flagged balances in this period."
            accent="#f59e0b"
            trend={buildTrend(
              report.metrics.opportunityAtRisk,
              report.previous.opportunityAtRisk,
              false
            )}
          />
          <StatCard
            title="Denial rate"
            value={formatRatio(report.metrics.denialRate)}
            description={`${report.metrics.decisionCount} claim decision(s) in range.`}
            accent="#f97316"
            trend={buildTrend(report.metrics.denialRate, report.previous.denialRate, false)}
          />
          <StatCard
            title="Clean claim rate"
            value={formatRatio(report.metrics.cleanClaimRate)}
            description={`${report.metrics.submissionCohortCount} submitted claim(s) in cohort.`}
            accent="#22c55e"
            trend={buildTrend(report.metrics.cleanClaimRate, report.previous.cleanClaimRate)}
          />
          <StatCard
            title="Avg days to payment"
            value={formatDays(report.metrics.averageDaysToPayment)}
            description="Submission to first insurance payment."
            accent="#38bdf8"
            trend={buildTrend(
              report.metrics.averageDaysToPayment,
              report.previous.averageDaysToPayment,
              false
            )}
          />
          <StatCard
            title="Resubmission rate"
            value={formatRatio(report.metrics.resubmissionRate)}
            description={`${report.metrics.resubmissionCount} resubmission event(s) in range.`}
            accent="#64748b"
            trend={buildTrend(report.metrics.resubmissionRate, report.previous.resubmissionRate, false)}
          />
        </div>
      </section>

      <div className="section-duo">
        <InfoCard
          badge={<PillBadge tone="info">Coverage and Exposure</PillBadge>}
          title="Revenue composition"
          subtitle="How production turned into cash, adjustments, and risk."
        >
          <MetricTrack
            label="Cash collected"
            value={collectionCoverage}
            hint={`${formatCurrency(report.metrics.payments)} collected on ${formatCurrency(report.metrics.charges)} charges.`}
            color="#0d9488"
          />
          <MetricTrack
            label="Adjustment support"
            value={adjustmentCoverage}
            hint={`${formatCurrency(report.metrics.adjustments)} adjustments posted in range.`}
            color="#0ea5e9"
          />
          <MetricTrack
            label="At-risk share"
            value={atRiskShare}
            hint={`${formatCurrency(report.metrics.opportunityAtRisk)} tied up in denials or open flags.`}
            color="#f97316"
          />
        </InfoCard>

        <InfoCard
          badge={<PillBadge tone="warn">Priority Queue</PillBadge>}
          title="What to do next"
          subtitle="Only high-leverage actions for this window."
        >
          {priorityActions.length === 0 ? (
            <EmptyState
              title="No high-severity triggers right now."
              description="Keep monitoring trend shifts and root causes."
            />
          ) : (
            <div className="list-stack">
              {priorityActions.map((action) => (
                <Link key={action.id} href={action.href} className="panel solid" style={{ display: 'grid', gap: 8 }}>
                  <div className="strong">{action.title}</div>
                  <div className="text-muted text-sm">{action.detail}</div>
                </Link>
              ))}
            </div>
          )}
        </InfoCard>
      </div>

      <div className="grid-cards">
        <InfoCard
          badge={<PillBadge tone="risk">Root Causes</PillBadge>}
          title="Top open issue drivers"
          subtitle="Use these labels to focus review and prevention work."
          actions={
            <Link className="button secondary" href="/review">
              Open full review queue
            </Link>
          }
        >
          {report.rootCauseDistribution.length === 0 ? (
            <EmptyState title="No open flag root causes in this window." />
          ) : (
            <div className="list-stack">
              {report.rootCauseDistribution.map((item) => (
                <Link
                  key={item.label}
                  href={`/review?issue=${encodeURIComponent(item.label)}`}
                  className="panel solid"
                  style={{ display: 'grid', gap: 6 }}
                >
                  <div className="row-between">
                    <div className="strong">{item.label}</div>
                    <div className="text-muted text-xs">{item.count} open flag(s)</div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </InfoCard>

        <InfoCard
          badge={<PillBadge tone="warn">Balance Focus</PillBadge>}
          title="Top patient balances"
          subtitle="Largest current balances to prioritize outreach and follow-up."
          actions={
            <Link className="button secondary" href="/billing">
              Open billing worklist
            </Link>
          }
        >
          {report.topBalances.length === 0 ? (
            <EmptyState title="No outstanding patient balances." />
          ) : (
            <div className="list-stack">
              {report.topBalances.map((entry) => (
                <Link key={entry.patientId} href={`/patients/${entry.patientId}`} className="panel solid">
                  <div className="row-between">
                    <div className="strong">{entry.name}</div>
                    <div>{formatCurrency(entry.balance)}</div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </InfoCard>
      </div>
    </SectionStack>
  );
}
