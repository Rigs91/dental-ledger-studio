import Link from 'next/link';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { SectionHeader } from '@/components/StatCard';
import HomeQuickStart from '@/components/HomeQuickStart';
import { getAnalyticsSnapshot } from '@/analytics/analytics';
import { prisma } from '@/shared/domain/db';
import { selectInsurance } from '@/insurance/insurance';
import { mapProcedureIntent, splitProcedures } from '@/intake/rules/procedure';
import { enrichNormalizedWithCatalog } from '@/intake/rules/procedureCatalog';
import { formatCurrency } from '@/shared/domain/format';

function formatDateInput(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

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

export default async function Home() {
  const cookieStore = await cookies();
  const signedIn = cookieStore.get('dls_signed_in')?.value === '1';
  if (!signedIn) {
    redirect('/signin?next=/');
  }

  const now = new Date();
  const dayStart = new Date(now);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);
  const todayParam = formatDateInput(dayStart);
  const operationsBase = `/operations?date=${todayParam}`;

  const [snapshot, appointmentsToday] = await Promise.all([
    getAnalyticsSnapshot(),
    prisma.appointment.findMany({
      where: { scheduledAt: { gte: dayStart, lt: dayEnd } },
      include: {
        patient: {
          include: {
            insurances: true,
            insuranceOverrides: true
          }
        }
      },
      orderBy: { scheduledAt: 'asc' }
    })
  ]);

  const activeAppointmentsToday = appointmentsToday.filter(
    (appointment) => appointment.status !== 'CANCELLED' && appointment.status !== 'COMPLETED'
  );

  const hasPlannedProcedures = activeAppointmentsToday.some(
    (appointment) => getPlannedItems(appointment.plannedProcedures).length > 0
  );
  const procedureCatalog = hasPlannedProcedures
    ? await prisma.procedureCatalog.findMany({
        select: {
          code: true,
          category: true,
          description: true,
          notes: true,
          patientDescription: true,
          estimatedCopayAvg: true,
          copayRate: true,
          copayBasis: true
        }
      })
    : [];

  let scheduleRiskCount = 0;
  const appointmentSignals = new Map<string, { ambiguous: boolean; missingInsurance: boolean }>();

  activeAppointmentsToday.forEach((appointment) => {
    const plannedItems = getPlannedItems(appointment.plannedProcedures);
    const patientAge = Math.floor(
      (appointment.scheduledAt.getTime() - appointment.patient.dob.getTime()) /
        (365.25 * 24 * 60 * 60 * 1000)
    );
    const ambiguous =
      plannedItems.length === 0
        ? false
        : plannedItems.some((item) => {
            const normalized = enrichNormalizedWithCatalog(
              mapProcedureIntent(item, patientAge),
              procedureCatalog,
              patientAge
            );
            return normalized.needsConfirmation || normalized.confidence < 0.7;
          });

    const selection = selectInsurance(
      appointment.patient.insurances,
      appointment.scheduledAt,
      appointment.patient.insuranceOverrides
    );
    const missingInsurance =
      appointment.patient.insurances.length === 0 || selection.activePolicies.length === 0;

    appointmentSignals.set(appointment.id, { ambiguous, missingInsurance });

    if (missingInsurance || ambiguous) {
      scheduleRiskCount += 1;
    }
  });

  const nextHourEnd = new Date(now.getTime() + 60 * 60 * 1000);
  const appointmentsNextHour = activeAppointmentsToday.filter(
    (appointment) =>
      appointment.scheduledAt.getTime() >= now.getTime() &&
      appointment.scheduledAt.getTime() <= nextHourEnd.getTime()
  );
  const checkInsDueCount = appointmentsNextHour.filter(
    (appointment) => appointment.status === 'SCHEDULED'
  ).length;

  let missingInsuranceNextHour = 0;
  let ambiguousNextHour = 0;
  appointmentsNextHour.forEach((appointment) => {
    const signal = appointmentSignals.get(appointment.id);
    if (signal?.missingInsurance) {
      missingInsuranceNextHour += 1;
    }
    if (signal?.ambiguous) {
      ambiguousNextHour += 1;
    }
  });

  const nextAppointment = appointmentsNextHour[0];

  const timeFormatter = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' });
  const formatTime = (value: Date) => timeFormatter.format(value);

  const nextAppointmentLabel = nextAppointment
    ? `${formatTime(nextAppointment.scheduledAt)} Next: ${nextAppointment.patient.firstName} ${
        nextAppointment.patient.lastName
      }`
    : 'No appointments next hour';

  const summaryTiles = [
    {
      label: 'Open flags',
      value: `${snapshot.openFlagsCount}`,
      detail: 'Review items that block claim close-out.'
    },
    {
      label: 'Awaiting payer',
      value: `${snapshot.claimsAwaitingPayment}`,
      detail: 'Claims with no payer payment yet.'
    },
    {
      label: 'Insurance ambiguity',
      value: `${snapshot.insuranceAmbiguityCount}`,
      detail: 'Date-of-service coverage needs confirmation.'
    },
    {
      label: 'Avg days to payment',
      value:
        snapshot.averageDaysToPayment === null
          ? 'N/A'
          : `${snapshot.averageDaysToPayment.toFixed(1)} days`,
      detail: 'Time from submission to first payment.'
    }
  ];

  const nowStripItems = [
    nextAppointmentLabel,
    ...(checkInsDueCount > 0
      ? [
          `${checkInsDueCount} check-in${checkInsDueCount === 1 ? '' : 's'} due next hour`
        ]
      : []),
    ...(missingInsuranceNextHour > 0
      ? [
          `${missingInsuranceNextHour} missing or unverified insurance next hour`
        ]
      : []),
    ...(ambiguousNextHour > 0
      ? [
          `${ambiguousNextHour} ambiguous procedure${ambiguousNextHour === 1 ? '' : 's'} next hour`
        ]
      : [])
  ].slice(0, 4);

  const blockers = [
    {
      title: 'Review queue',
      count: `${snapshot.openFlagsCount}`,
      why: 'Open flags block claim close-out and create rework.'
    },
    {
      title: 'Visits at risk',
      count: `${scheduleRiskCount}`,
      why: 'Missing or unverified insurance, plus ambiguous procedures, can delay today\'s visits.'
    },
    {
      title: 'Claims awaiting payment',
      count: `${snapshot.claimsAwaitingPayment}`,
      why: 'Payer follow-ups keep cash flow moving.'
    }
  ];

  return (
    <div className="page-stack">
      <section className="section-overview">
        <div className="card card-glow home-hero">
          <div className="badge">Daily command center</div>
          <div className="home-hero-title section-title">Care, claims, and collections in one guided flow.</div>
          <div className="home-hero-copy text-muted">
            Start where the work is blocked, then jump directly into operations, billing, review,
            and analytics.
          </div>
          <div className="action-bar">
            <Link className="button" href={operationsBase}>
              Open daily operations
            </Link>
            <Link className="button secondary" href="/billing">
              Open billing
            </Link>
            <Link className="button secondary" href="/review">
              Review inbox
            </Link>
          </div>
        </div>

        <div className="card home-summary">
          <div className="badge">At a glance</div>
          <div className="summary-grid">
            {summaryTiles.map((tile) => (
              <div key={tile.label} className="summary-tile">
                <div className="summary-label text-muted">{tile.label}</div>
                <div className="summary-value section-title">{tile.value}</div>
                <div className="summary-detail text-muted">{tile.detail}</div>
              </div>
            ))}
          </div>
          <div className="summary-footnote text-muted">
            Open balance: {formatCurrency(snapshot.outstandingBalance)} | Credits on file:{' '}
            {formatCurrency(snapshot.creditBalance)}
          </div>
        </div>
      </section>

      <HomeQuickStart
        operationsHref={operationsBase}
        patientHref="/patients"
        reviewHref="/review"
        billingHref="/billing"
        dashboardHref="/dashboard"
        analyticsHref="/analytics"
      />

      <SectionHeader
        title="Today's blockers"
        subtitle="Triage the issues that slow down care and cash flow."
      />

      <div className="card" style={{ display: 'grid', gap: 12 }}>
        {blockers.map((blocker, index) => (
          <div
            key={blocker.title}
            style={{
              display: 'grid',
              gap: 8,
              paddingBottom: index < blockers.length - 1 ? 12 : 0,
              borderBottom:
                index < blockers.length - 1 ? '1px solid rgba(15, 23, 42, 0.08)' : 'none'
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
                flexWrap: 'wrap'
              }}
            >
              <div style={{ fontWeight: 600 }}>{blocker.title}</div>
              <div className="section-title" style={{ fontSize: 24 }}>
                {blocker.count}
              </div>
            </div>
            <div className="text-muted" style={{ fontSize: 13 }}>
              {blocker.why}
            </div>
          </div>
        ))}
      </div>

      <SectionHeader
        title="Now / Next hour"
        subtitle="Near-term attention points for the next hour."
      />

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        {nowStripItems.map((label) => (
          <div
            key={label}
            className="badge"
            style={{
              textTransform: 'none',
              letterSpacing: '0.02em',
              background: 'rgba(15, 23, 42, 0.06)',
              fontSize: 12
            }}
          >
            {label}
          </div>
        ))}
      </div>
    </div>
  );
}
