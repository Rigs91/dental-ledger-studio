import { prisma } from '@/shared/domain/db';
import { Prisma, LedgerEventType, type InsurancePolicy, type InsuranceOverride } from '@prisma/client';
import { selectInsurance } from '@/insurance/insurance';

const BALANCE_EPSILON = 0.005;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export type AnalyticsSnapshot = {
  claimCount: number;
  denialRate: number;
  averageDaysToPayment: number | null;
  creditsVsBalances: { credits: number; balances: number };
  rootCauseDistribution: { label: string; count: number }[];
  insuranceAmbiguityRate: number;
  insuranceAmbiguityCount: number;
  outstandingBalance: number;
  creditBalance: number;
  claimsWithBalance: number;
  claimsWithCredits: number;
  averageBalanceDue: number | null;
  openFlagsCount: number;
  claimsAwaitingPayment: number;
  selfPayClaimCount: number;
  paymentsLast30Days: number;
  adjustmentsLast30Days: number;
  topBalances: { patientId: string; name: string; balance: number }[];
};

export type AnalyticsRangeKey = 'day' | 'week' | 'month';

export type AnalyticsRange = {
  key: AnalyticsRangeKey;
  label: string;
  start: Date;
  end: Date;
  previousStart: Date;
  previousEnd: Date;
  days: number;
};

export type AnalyticsMetrics = {
  charges: number;
  payments: number;
  adjustments: number;
  netCollectionRate: number | null;
  opportunityAtRisk: number;
  openFlagBalance: number;
  deniedBalance: number;
  visitsCompleted: number;
  claimsSubmitted: number;
  averageDaysToSubmit: number | null;
  sameDaySubmissionRate: number | null;
  averageDaysToPayment: number | null;
  denialRate: number | null;
  cleanClaimRate: number | null;
  newFlagsCount: number;
  resubmissionCount: number;
  resubmissionRate: number | null;
  insuranceAmbiguityRate: number | null;
  decisionCount: number;
  submissionCohortCount: number;
};

export type AnalyticsReport = {
  range: AnalyticsRange;
  metrics: AnalyticsMetrics;
  previous: AnalyticsMetrics;
  rootCauseDistribution: { label: string; count: number }[];
  topBalances: { patientId: string; name: string; balance: number }[];
};

const RANGE_DAYS: Record<AnalyticsRangeKey, number> = {
  day: 1,
  week: 7,
  month: 30
};

function startOfDay(value: Date): Date {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}

function resolveAnalyticsRange(key: AnalyticsRangeKey, now = new Date()): AnalyticsRange {
  const days = RANGE_DAYS[key];
  const offsetDays = Math.max(days - 1, 0);
  const end = now;
  const start = startOfDay(new Date(end.getTime() - offsetDays * MS_PER_DAY));
  const previousEnd = new Date(start.getTime() - 1);
  const previousStart = startOfDay(new Date(previousEnd.getTime() - offsetDays * MS_PER_DAY));
  const label = key === 'day' ? 'Today' : key === 'week' ? 'Last 7 days' : 'Last 30 days';
  return {
    key,
    label,
    start,
    end,
    previousStart,
    previousEnd,
    days
  };
}

type LedgerAmountSumByClaim = {
  claimId: string | null;
  _sum: {
    amount: Prisma.Decimal | null;
  };
};

function toNumber(value: { toString(): string } | number | null | undefined): number {
  if (typeof value === 'number') {
    return value;
  }
  if (!value) {
    return 0;
  }
  const parsed = Number(value.toString());
  return Number.isFinite(parsed) ? parsed : 0;
}

function buildInsuranceMaps<T extends { patientId: string }>(items: readonly T[]): Map<string, T[]> {
  const map = new Map<string, T[]>();
  items.forEach((item) => {
    const list = map.get(item.patientId) ?? [];
    list.push(item);
    map.set(item.patientId, list);
  });
  return map;
}

function buildMapSumByClaim(rows: ReadonlyArray<LedgerAmountSumByClaim>): Map<string, number> {
  const output = new Map<string, number>();
  rows.forEach((row) => {
    if (row.claimId === null) {
      return;
    }
    output.set(row.claimId, toNumber(row._sum.amount));
  });
  return output;
}

function isTimestampInRange(timestamp: number, range: AnalyticsRange): boolean {
  return timestamp >= range.start.getTime() && timestamp <= range.end.getTime();
}

export async function getAnalyticsSnapshot(): Promise<AnalyticsSnapshot> {
  const claims = await prisma.claim.findMany({
    select: {
      id: true,
      patientId: true,
      status: true,
      insuranceSnapshot: true,
      visit: { select: { dateOfService: true } },
      patient: {
        select: {
          firstName: true,
          lastName: true
        }
      },
      submissions: {
        take: 1,
        orderBy: { createdAt: 'desc' },
        select: { insuranceSnapshot: true }
      }
    }
  });

  const claimIds = claims.map((claim) => claim.id);
  const patientIds = [...new Set(claims.map((claim) => claim.patientId))];
  const now = Date.now();
  const thirtyDaysAgo = now - 30 * MS_PER_DAY;

  const [openFlagRows, claimBalanceRows, openLedgerEvents, recentLedgerEvents, policies, overrides] =
    await Promise.all([
      prisma.flag.groupBy({
        where: { status: 'OPEN' },
        by: ['likelyIssue'],
        _count: { _all: true }
      }),
      prisma.ledgerEvent.groupBy({
        by: ['claimId'],
        where: {
          claimId: { in: claimIds }
        },
        _sum: { amount: true }
      }),
      prisma.ledgerEvent.findMany({
        where: {
          claimId: { in: claimIds },
          type: { in: [LedgerEventType.CLAIM_SUBMITTED, LedgerEventType.INSURANCE_PAYMENT] }
        },
        select: { claimId: true, type: true, occurredAt: true },
        orderBy: { occurredAt: 'asc' }
      }),
      prisma.ledgerEvent.findMany({
        where: {
          claimId: { in: claimIds },
          occurredAt: { gte: new Date(thirtyDaysAgo) },
          type: {
            in: [
              LedgerEventType.INSURANCE_PAYMENT,
              LedgerEventType.PATIENT_PAYMENT,
              LedgerEventType.INSURANCE_ADJUSTMENT,
              LedgerEventType.BALANCE_CORRECTION
            ]
          }
        },
        select: { claimId: true, type: true, amount: true }
      }),
      prisma.insurancePolicy.findMany({
        where: { patientId: { in: patientIds } },
        orderBy: { priority: 'asc' }
      }),
      prisma.insuranceOverride.findMany({
        where: { patientId: { in: patientIds } },
      })
    ]);

  const openFlagsCount = openFlagRows.reduce((sum, row) => sum + row._count._all, 0);
  const rootCauseDistribution = openFlagRows
    .map((row) => ({ label: row.likelyIssue, count: row._count._all }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

  const currentBalances = buildMapSumByClaim(claimBalanceRows);

  const firstSubmissionByClaim = new Map<string, number>();
  const firstPaymentAfterSubmissionByClaim = new Map<string, number>();
  for (const event of openLedgerEvents) {
    if (event.claimId === null) {
      continue;
    }
    if (event.type === LedgerEventType.CLAIM_SUBMITTED) {
      const existing = firstSubmissionByClaim.get(event.claimId);
      if (existing === undefined || event.occurredAt.getTime() < existing) {
        firstSubmissionByClaim.set(event.claimId, event.occurredAt.getTime());
      }
      continue;
    }

    const firstSubmission = firstSubmissionByClaim.get(event.claimId);
    if (firstSubmission === undefined) {
      continue;
    }
    const paymentTime = event.occurredAt.getTime();
    if (
      paymentTime >= firstSubmission &&
      !firstPaymentAfterSubmissionByClaim.has(event.claimId)
    ) {
      firstPaymentAfterSubmissionByClaim.set(event.claimId, paymentTime);
    }
  }

  const policiesByPatient = buildInsuranceMaps(policies);
  const overridesByPatient = buildInsuranceMaps(overrides);

  const claimCount = claims.length;
  let denied = 0;
  let paymentDurations: number[] = [];
  let outstandingBalance = 0;
  let creditBalance = 0;
  let claimsWithBalance = 0;
  let claimsWithCredits = 0;
  let claimsAwaitingPayment = 0;
  let selfPayClaimCount = 0;
  let paymentsLast30Days = 0;
  let adjustmentsLast30Days = 0;
  let ambiguousCount = 0;

  const patientBalanceMap = new Map<string, { patientId: string; name: string; balance: number }>();

  recentLedgerEvents.forEach((event) => {
    const amount = Math.abs(toNumber(event.amount as { toString(): string }));
    if (
      event.type === LedgerEventType.INSURANCE_PAYMENT ||
      event.type === LedgerEventType.PATIENT_PAYMENT
    ) {
      paymentsLast30Days += amount;
    }
    if (
      event.type === LedgerEventType.INSURANCE_ADJUSTMENT ||
      event.type === LedgerEventType.BALANCE_CORRECTION
    ) {
      adjustmentsLast30Days += amount;
    }
  });

  claims.forEach((claim) => {
    const balance = currentBalances.get(claim.id) ?? 0;
    if (claim.status === 'DENIED') {
      denied += 1;
    }

    if (balance > BALANCE_EPSILON) {
      outstandingBalance += balance;
      claimsWithBalance += 1;
    } else if (balance < -BALANCE_EPSILON) {
      creditBalance += Math.abs(balance);
      claimsWithCredits += 1;
    }

    const firstSubmission = firstSubmissionByClaim.get(claim.id);
    const firstPayment = firstPaymentAfterSubmissionByClaim.get(claim.id);
    if (firstSubmission && firstPayment) {
      paymentDurations.push(Math.max(0, firstPayment - firstSubmission) / MS_PER_DAY);
    }

    const activeSnapshot = claim.submissions[0]?.insuranceSnapshot ?? claim.insuranceSnapshot;
    if (!activeSnapshot) {
      selfPayClaimCount += 1;
    }

    if (firstSubmission && !firstPayment && claim.status !== 'DENIED') {
      claimsAwaitingPayment += 1;
    }

    const patientBalance = patientBalanceMap.get(claim.patientId);
    const updatedBalance = (patientBalance?.balance ?? 0) + balance;
    patientBalanceMap.set(claim.patientId, {
      patientId: claim.patientId,
      name: `${claim.patient.firstName} ${claim.patient.lastName}`,
      balance: updatedBalance
    });

    const policyContext = selectInsurance(
      policiesByPatient.get(claim.patientId) ?? [],
      claim.visit.dateOfService,
      overridesByPatient.get(claim.patientId) ?? []
    );
    if (policyContext.needsConfirmation) {
      ambiguousCount += 1;
    }
  });

  const denialRate = claimCount === 0 ? 0 : denied / claimCount;
  const averageDaysToPayment =
    paymentDurations.length === 0 ? null : paymentDurations.reduce((sum, value) => sum + value, 0) / paymentDurations.length;
  const averageBalanceDue = claimsWithBalance === 0 ? null : outstandingBalance / claimsWithBalance;

  const topBalances = Array.from(patientBalanceMap.values())
    .filter((entry) => entry.balance > BALANCE_EPSILON)
    .sort((a, b) => b.balance - a.balance || a.name.localeCompare(b.name))
    .slice(0, 5);

  const insuranceAmbiguityRate = claimCount === 0 ? 0 : ambiguousCount / claimCount;

  return {
    claimCount,
    denialRate,
    averageDaysToPayment,
    creditsVsBalances: { credits: creditBalance, balances: outstandingBalance },
    rootCauseDistribution,
    insuranceAmbiguityRate,
    insuranceAmbiguityCount: ambiguousCount,
    outstandingBalance,
    creditBalance,
    claimsWithBalance,
    claimsWithCredits,
    averageBalanceDue,
    openFlagsCount,
    claimsAwaitingPayment,
    selfPayClaimCount,
    paymentsLast30Days,
    adjustmentsLast30Days,
    topBalances
  };
}

type ClaimForReport = {
  id: string;
  patientId: string;
  visit: { dateOfService: Date };
  patient: { firstName: string; lastName: string };
};

function toAverage(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function computeMetrics(
  claims: ClaimForReport[],
  range: AnalyticsRange,
  balancesByClaim: Map<string, number>,
  firstSubmissionByClaim: Map<string, number>,
  firstPaymentByClaimInRange: Map<string, number>,
  submissionCountByClaimInRange: Map<string, number>,
  flaggedClaimsByClaim: Map<string, string[]>,
  decisionsByClaim: Map<string, { status: string; occurredAt: number; count: number }>,
  chargesByClaim: Map<string, number>,
  paymentsByClaim: Map<string, number>,
  adjustmentsByClaim: Map<string, number>,
  policiesByPatient: Map<string, InsurancePolicy[]>,
  overridesByPatient: Map<string, InsuranceOverride[]>
): AnalyticsMetrics {
  let claimsSubmitted = 0;
  const daysToSubmit: number[] = [];
  let sameDaySubmissionCount = 0;
  const daysToPayment: number[] = [];
  const flaggedClaimIds = new Set<string>();

  let charges = 0;
  let payments = 0;
  let adjustments = 0;
  let deniedBalance = 0;
  let openFlagBalance = 0;
  let newFlagsCount = 0;
  let resubmissionCount = 0;
  let cleanClaimCount = 0;
  let ambiguityCount = 0;
  let denialCount = 0;
  let decisionCount = 0;

  let insuranceAmbiguityDenominator = 0;

  claims.forEach((claim) => {
    const claimBalance = balancesByClaim.get(claim.id) ?? 0;
    const firstSubmission = firstSubmissionByClaim.get(claim.id);
    const submissionInRange = firstSubmission !== undefined ? isTimestampInRange(firstSubmission, range) : false;
    const rangeSubmissions = submissionCountByClaimInRange.get(claim.id) ?? 0;
    const hasResubmissionInRange =
      rangeSubmissions > 0 &&
      ((submissionInRange && rangeSubmissions > 1) || (!submissionInRange && rangeSubmissions > 0));

    if (firstSubmission !== undefined && submissionInRange) {
      claimsSubmitted += 1;
      insuranceAmbiguityDenominator += 1;
      const deltaDays = (firstSubmission - claim.visit.dateOfService.getTime()) / MS_PER_DAY;
      const safeDelta = Math.max(0, deltaDays);
      daysToSubmit.push(safeDelta);
      if (safeDelta <= 1) {
        sameDaySubmissionCount += 1;
      }

      const policyContext = selectInsurance(
        policiesByPatient.get(claim.patientId) ?? [],
        claim.visit.dateOfService,
        overridesByPatient.get(claim.patientId) ?? []
      );
      if (policyContext.needsConfirmation) {
        ambiguityCount += 1;
      }
    }

    const firstPayment = firstPaymentByClaimInRange.get(claim.id);
    if (firstSubmission !== undefined && firstPayment !== undefined) {
      daysToPayment.push(Math.max(0, (firstPayment - firstSubmission) / MS_PER_DAY));
    }

    charges += chargesByClaim.get(claim.id) ?? 0;
    payments += paymentsByClaim.get(claim.id) ?? 0;
    adjustments += adjustmentsByClaim.get(claim.id) ?? 0;

    const flagIssues = flaggedClaimsByClaim.get(claim.id);
    const hasOpenFlagInRange = Boolean(flagIssues?.length);
    if (hasOpenFlagInRange) {
      newFlagsCount += flagIssues!.length;
      flaggedClaimIds.add(claim.id);
    }

    const claimDecisions = decisionsByClaim.get(claim.id);
    if (claimDecisions) {
      decisionCount += claimDecisions.count;
      if (claimDecisions.status === 'DENIED') {
        denialCount += 1;
        if (claimBalance > BALANCE_EPSILON) {
          deniedBalance += claimBalance;
        }
      }
    }

    if (
      submissionInRange &&
      !hasOpenFlagInRange &&
      claimDecisions?.status !== 'DENIED' &&
      !hasResubmissionInRange
    ) {
      cleanClaimCount += 1;
    }

    if (hasResubmissionInRange) {
      resubmissionCount += 1;
    }
  });

  flaggedClaimIds.forEach((claimId) => {
    const claimBalance = balancesByClaim.get(claimId) ?? 0;
    if (claimBalance > BALANCE_EPSILON) {
      openFlagBalance += claimBalance;
    }
  });

  const opportunityAtRisk = deniedBalance + openFlagBalance;
  const averageDaysToSubmit = toAverage(daysToSubmit);
  const sameDaySubmissionRate =
    daysToSubmit.length === 0 ? null : sameDaySubmissionCount / daysToSubmit.length;
  const averageDaysToPayment = toAverage(daysToPayment);
  const denialRate = decisionCount === 0 ? null : denialCount / decisionCount;
  const cleanClaimRate = claimsSubmitted === 0 ? null : cleanClaimCount / claimsSubmitted;
  const resubmissionRate = claimsSubmitted === 0 ? null : resubmissionCount / claimsSubmitted;
  const insuranceAmbiguityRate =
    insuranceAmbiguityDenominator === 0 ? null : ambiguityCount / insuranceAmbiguityDenominator;
  const netCollectionRate = charges === 0 ? null : (payments + adjustments) / charges;

  return {
    charges,
    payments,
    adjustments,
    netCollectionRate,
    opportunityAtRisk,
    openFlagBalance,
    deniedBalance,
    visitsCompleted: 0,
    claimsSubmitted,
    averageDaysToSubmit,
    sameDaySubmissionRate,
    averageDaysToPayment,
    denialRate,
    cleanClaimRate,
    newFlagsCount,
    resubmissionCount,
    resubmissionRate,
    insuranceAmbiguityRate,
    decisionCount,
    submissionCohortCount: claimsSubmitted
  };
}

export async function getAnalyticsReport(rangeKey: AnalyticsRangeKey): Promise<AnalyticsReport> {
  const range = resolveAnalyticsRange(rangeKey);
  const offsetDays = Math.max(range.days - 1, 0);
  const previousRange: AnalyticsRange = {
    ...range,
    start: range.previousStart,
    end: range.previousEnd,
    previousStart: startOfDay(new Date(range.previousStart.getTime() - offsetDays * MS_PER_DAY)),
    previousEnd: new Date(range.previousStart.getTime() - 1)
  };

  const claims = await prisma.claim.findMany({
    select: {
      id: true,
      patientId: true,
      visit: { select: { dateOfService: true } },
      patient: {
        select: {
          firstName: true,
          lastName: true
        }
      }
    }
  });

  const claimIds = claims.map((claim) => claim.id);
  const patientIds = [...new Set(claims.map((claim) => claim.patientId))];

  const [visitsCompletedCurrent, visitsCompletedPrevious, balancesByClaim, policies, overrides] =
    await Promise.all([
      prisma.visit.count({
        where: {
          status: 'COMPLETED',
          dateOfService: {
            gte: range.start,
            lte: range.end
          }
        }
      }),
      prisma.visit.count({
        where: {
          status: 'COMPLETED',
          dateOfService: {
            gte: previousRange.start,
            lte: previousRange.end
          }
        }
      }),
      prisma.ledgerEvent.groupBy({
        by: ['claimId'],
        where: {
          claimId: { in: claimIds }
        },
        _sum: { amount: true }
      }),
      prisma.insurancePolicy.findMany({
        where: { patientId: { in: patientIds } },
      }),
      prisma.insuranceOverride.findMany({
        where: { patientId: { in: patientIds } },
      })
    ]);

  const balancesByClaimMap = buildMapSumByClaim(balancesByClaim);
  const policiesByPatient = buildInsuranceMaps(policies);
  const overridesByPatient = buildInsuranceMaps(overrides);

  const [
    firstSubmissionRows,
    currentSubmissionCountRows,
    previousSubmissionCountRows,
    currentFlagRows,
    previousFlagRows,
    currentDecisionRows,
    previousDecisionRows,
    currentLedgerRows,
    previousLedgerRows
  ] = await Promise.all([
    prisma.claimSubmission.groupBy({
      by: ['claimId'],
      where: {
        claimId: { in: claimIds }
      },
      _min: { createdAt: true }
    }),
    prisma.claimSubmission.groupBy({
      by: ['claimId'],
      where: {
        claimId: { in: claimIds },
        createdAt: {
          gte: range.start,
          lte: range.end
        }
      },
      _count: { _all: true }
    }),
    prisma.claimSubmission.groupBy({
      by: ['claimId'],
      where: {
        claimId: { in: claimIds },
        createdAt: {
          gte: previousRange.start,
          lte: previousRange.end
        }
      },
      _count: { _all: true }
    }),
    prisma.flag.findMany({
      where: {
        claimId: { not: null },
        status: 'OPEN',
        lastDetectedAt: { gte: range.start, lte: range.end }
      },
      select: { claimId: true, likelyIssue: true },
      orderBy: { lastDetectedAt: 'desc' }
    }),
    prisma.flag.findMany({
      where: {
        claimId: { not: null },
        status: 'OPEN',
        lastDetectedAt: { gte: previousRange.start, lte: previousRange.end }
      },
      select: { claimId: true, likelyIssue: true },
      orderBy: { lastDetectedAt: 'desc' }
    }),
    prisma.claimDecision.findMany({
      where: {
        claimId: { in: claimIds },
        occurredAt: {
          gte: range.start,
          lte: range.end
        }
      },
      select: { claimId: true, status: true, occurredAt: true },
      orderBy: { occurredAt: 'desc' }
    }),
    prisma.claimDecision.findMany({
      where: {
        claimId: { in: claimIds },
        occurredAt: {
          gte: previousRange.start,
          lte: previousRange.end
        }
      },
      select: { claimId: true, status: true, occurredAt: true },
      orderBy: { occurredAt: 'desc' }
    }),
    prisma.ledgerEvent.findMany({
      where: {
        claimId: { in: claimIds },
        occurredAt: {
          gte: range.start,
          lte: range.end
        },
        type: {
          in: [
            LedgerEventType.CLAIM_SUBMITTED,
            LedgerEventType.INSURANCE_PAYMENT,
            LedgerEventType.CHARGE_CREATED,
            LedgerEventType.PATIENT_PAYMENT,
            LedgerEventType.INSURANCE_ADJUSTMENT,
            LedgerEventType.BALANCE_CORRECTION
          ]
        }
      },
      select: {
        claimId: true,
        type: true,
        amount: true,
        occurredAt: true
      },
      orderBy: { occurredAt: 'asc' }
    }),
    prisma.ledgerEvent.findMany({
      where: {
        claimId: { in: claimIds },
        occurredAt: {
          gte: previousRange.start,
          lte: previousRange.end
        },
        type: {
          in: [
            LedgerEventType.CLAIM_SUBMITTED,
            LedgerEventType.INSURANCE_PAYMENT,
            LedgerEventType.CHARGE_CREATED,
            LedgerEventType.PATIENT_PAYMENT,
            LedgerEventType.INSURANCE_ADJUSTMENT,
            LedgerEventType.BALANCE_CORRECTION
          ]
        }
      },
      select: {
        claimId: true,
        type: true,
        amount: true,
        occurredAt: true
      },
      orderBy: { occurredAt: 'asc' }
    })
  ]);

  const firstSubmissionByClaim = new Map<string, number>();
  firstSubmissionRows.forEach((row) => {
    if (row.claimId === null) {
      return;
    }
    if (row._min.createdAt instanceof Date) {
      firstSubmissionByClaim.set(row.claimId, row._min.createdAt.getTime());
    }
  });

  const submissionCountByClaimCurrent = new Map<string, number>();
  currentSubmissionCountRows.forEach((row) => {
    submissionCountByClaimCurrent.set(row.claimId, row._count._all);
  });
  const submissionCountByClaimPrevious = new Map<string, number>();
  previousSubmissionCountRows.forEach((row) => {
    submissionCountByClaimPrevious.set(row.claimId, row._count._all);
  });

  const flagsByClaimCurrent = new Map<string, string[]>();
  currentFlagRows.forEach((row) => {
    if (!row.claimId) {
      return;
    }
    const entries = flagsByClaimCurrent.get(row.claimId) ?? [];
    entries.push(row.likelyIssue);
    flagsByClaimCurrent.set(row.claimId, entries);
  });

  const flagsByClaimPrevious = new Map<string, string[]>();
  previousFlagRows.forEach((row) => {
    if (!row.claimId) {
      return;
    }
    const entries = flagsByClaimPrevious.get(row.claimId) ?? [];
    entries.push(row.likelyIssue);
    flagsByClaimPrevious.set(row.claimId, entries);
  });

  const decisionsCurrent = new Map<string, { status: string; occurredAt: number; count: number }>();
  currentDecisionRows.forEach((row) => {
    const existing = decisionsCurrent.get(row.claimId);
    const occurredAt = row.occurredAt.getTime();
    if (!existing) {
      decisionsCurrent.set(row.claimId, { status: row.status, occurredAt, count: 1 });
      return;
    }
    existing.count += 1;
    if (occurredAt > existing.occurredAt) {
      decisionsCurrent.set(row.claimId, { status: row.status, occurredAt, count: existing.count });
    }
  });

  const decisionsPrevious = new Map<string, { status: string; occurredAt: number; count: number }>();
  previousDecisionRows.forEach((row) => {
    const existing = decisionsPrevious.get(row.claimId);
    const occurredAt = row.occurredAt.getTime();
    if (!existing) {
      decisionsPrevious.set(row.claimId, { status: row.status, occurredAt, count: 1 });
      return;
    }
    existing.count += 1;
    if (occurredAt > existing.occurredAt) {
      decisionsPrevious.set(row.claimId, { status: row.status, occurredAt, count: existing.count });
    }
  });

  const parseLedger = (rows: typeof currentLedgerRows) => {
    const chargesByClaim = new Map<string, number>();
    const paymentsByClaim = new Map<string, number>();
    const adjustmentsByClaim = new Map<string, number>();
    const firstPaymentByClaim = new Map<string, number>();

    rows.forEach((row) => {
      if (row.claimId === null) {
        return;
      }
      const amount = Math.abs(toNumber(row.amount));
      if (row.type === LedgerEventType.CHARGE_CREATED) {
        chargesByClaim.set(row.claimId, (chargesByClaim.get(row.claimId) ?? 0) + amount);
        return;
      }
      if (row.type === LedgerEventType.INSURANCE_PAYMENT || row.type === LedgerEventType.PATIENT_PAYMENT) {
        paymentsByClaim.set(row.claimId, (paymentsByClaim.get(row.claimId) ?? 0) + amount);
        if (
          !firstPaymentByClaim.has(row.claimId) &&
          row.type === LedgerEventType.INSURANCE_PAYMENT &&
          firstSubmissionByClaim.has(row.claimId)
        ) {
          const firstSubmission = firstSubmissionByClaim.get(row.claimId);
          if (firstSubmission !== undefined && row.occurredAt.getTime() >= firstSubmission) {
            firstPaymentByClaim.set(row.claimId, row.occurredAt.getTime());
          }
        }
        return;
      }
      if (row.type === LedgerEventType.INSURANCE_ADJUSTMENT || row.type === LedgerEventType.BALANCE_CORRECTION) {
        adjustmentsByClaim.set(row.claimId, (adjustmentsByClaim.get(row.claimId) ?? 0) + amount);
      }
    });

    return {
      chargesByClaim,
      paymentsByClaim,
      adjustmentsByClaim,
      firstPaymentByClaim
    };
  };

  const currentLedgerAggregation = parseLedger(currentLedgerRows);
  const previousLedgerAggregation = parseLedger(previousLedgerRows);

  let metrics = computeMetrics(
    claims,
    range,
    balancesByClaimMap,
    firstSubmissionByClaim,
    currentLedgerAggregation.firstPaymentByClaim,
    submissionCountByClaimCurrent,
    flagsByClaimCurrent,
    decisionsCurrent,
    currentLedgerAggregation.chargesByClaim,
    currentLedgerAggregation.paymentsByClaim,
    currentLedgerAggregation.adjustmentsByClaim,
    policiesByPatient,
    overridesByPatient
  );

  const previous = computeMetrics(
    claims,
    previousRange,
    balancesByClaimMap,
    firstSubmissionByClaim,
    previousLedgerAggregation.firstPaymentByClaim,
    submissionCountByClaimPrevious,
    flagsByClaimPrevious,
    decisionsPrevious,
    previousLedgerAggregation.chargesByClaim,
    previousLedgerAggregation.paymentsByClaim,
    previousLedgerAggregation.adjustmentsByClaim,
    policiesByPatient,
    overridesByPatient
  );

  metrics = {
    ...metrics,
    visitsCompleted: visitsCompletedCurrent
  };

  const previousResult = {
    ...previous,
    visitsCompleted: visitsCompletedPrevious
  };

  const rootCauseMap = new Map<string, number>();
  currentFlagRows.forEach((row) => {
    if (!row.claimId) {
      return;
    }
    rootCauseMap.set(row.likelyIssue, (rootCauseMap.get(row.likelyIssue) ?? 0) + 1);
  });
  const rootCauseDistribution = Array.from(rootCauseMap.entries())
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

  const patientBalanceMap = new Map<string, { patientId: string; name: string; balance: number }>();
  claims.forEach((claim) => {
    const balance = balancesByClaimMap.get(claim.id) ?? 0;
    const next = patientBalanceMap.get(claim.patientId);
    const name = `${claim.patient.firstName} ${claim.patient.lastName}`;
    patientBalanceMap.set(claim.patientId, {
      patientId: claim.patientId,
      name,
      balance: (next?.balance ?? 0) + balance
    });
  });

  const topBalances = Array.from(patientBalanceMap.values())
    .filter((entry) => entry.balance > BALANCE_EPSILON)
    .sort((a, b) => b.balance - a.balance || a.name.localeCompare(b.name))
    .slice(0, 5);

  return {
    range,
    metrics,
    previous: previousResult,
    rootCauseDistribution,
    topBalances
  };
}
