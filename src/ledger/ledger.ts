import { LedgerEvent, LedgerEventType } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';

export type TimelineEntry = {
  event: LedgerEvent;
  runningBalance: number;
  isLastZero: boolean;
};

export type LedgerSummary = {
  timeline: TimelineEntry[];
  lastZeroAt?: Date;
  currentBalance: number;
  totalCharges: number;
  totalCredits: number;
  unappliedCredits: LedgerEvent[];
};

export type LedgerMoneyBreakdown = {
  charges: number;
  insurancePaid: number;
  adjustments: number;
  patientPayments: number;
  copayCollected: number;
  credits: number;
};

function toNumber(amount: Decimal | number): number {
  if (typeof amount === 'number') {
    return amount;
  }
  return Number(amount.toString());
}

export function computeCurrentBalance(events: Array<{ amount: Decimal | number }>): number {
  return events.reduce((running, event) => running + toNumber(event.amount), 0);
}

export function buildLedgerSummary(events: LedgerEvent[]): LedgerSummary {
  const sorted = [...events].sort((a, b) => {
    const occurredDelta = new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime();
    if (occurredDelta !== 0) {
      return occurredDelta;
    }
    const createdDelta = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    if (createdDelta !== 0) {
      return createdDelta;
    }
    return a.id.localeCompare(b.id);
  });
  let running = 0;
  let totalCharges = 0;
  let totalCredits = 0;
  let lastZeroAt: Date | undefined;
  let lastZeroIndex = -1;
  const epsilon = 0.005;

  const creditEvents = new Map<string, LedgerEvent>();
  const appliedCredits = new Set<string>();

  sorted.forEach((event) => {
    if (event.type === LedgerEventType.CREDIT_CREATED) {
      creditEvents.set(event.id, event);
    }
    if (event.type === LedgerEventType.CREDIT_APPLIED && event.metadata && typeof event.metadata === 'object') {
      const metadata = event.metadata as { creditEventId?: string };
      if (metadata.creditEventId) {
        appliedCredits.add(metadata.creditEventId);
      }
    }
  });

  const timeline: TimelineEntry[] = sorted.map((event, index) => {
    const amount = toNumber(event.amount);
    if (amount > epsilon) {
      totalCharges += amount;
    } else if (amount < -epsilon) {
      totalCredits += Math.abs(amount);
    }
    running += amount;
    if (Math.abs(running) < epsilon) {
      lastZeroAt = new Date(event.occurredAt);
      lastZeroIndex = index;
    }
    return {
      event,
      runningBalance: running,
      isLastZero: false
    };
  });

  if (lastZeroIndex >= 0) {
    timeline[lastZeroIndex] = { ...timeline[lastZeroIndex], isLastZero: true };
  }

  const unappliedCredits = Array.from(creditEvents.values()).filter(
    (credit) => !appliedCredits.has(credit.id)
  );

  return {
    timeline,
    lastZeroAt,
    currentBalance: running,
    totalCharges,
    totalCredits,
    unappliedCredits
  };
}

export function buildLedgerMoneyBreakdown(events: LedgerEvent[]): LedgerMoneyBreakdown {
  const breakdown: LedgerMoneyBreakdown = {
    charges: 0,
    insurancePaid: 0,
    adjustments: 0,
    patientPayments: 0,
    copayCollected: 0,
    credits: 0
  };

  events.forEach((event) => {
    const amount = toNumber(event.amount);
    switch (event.type) {
      case LedgerEventType.CHARGE_CREATED:
        breakdown.charges += amount;
        break;
      case LedgerEventType.INSURANCE_PAYMENT:
        breakdown.insurancePaid += Math.abs(amount);
        break;
      case LedgerEventType.INSURANCE_ADJUSTMENT:
      case LedgerEventType.BALANCE_CORRECTION:
        breakdown.adjustments += Math.abs(amount);
        break;
      case LedgerEventType.PATIENT_PAYMENT: {
        breakdown.patientPayments += Math.abs(amount);
        const metadata = event.metadata as { source?: string } | null;
        if (metadata?.source === 'copay') {
          breakdown.copayCollected += Math.abs(amount);
        }
        break;
      }
      case LedgerEventType.CREDIT_CREATED:
      case LedgerEventType.CREDIT_APPLIED:
        breakdown.credits += Math.abs(amount);
        break;
      default:
        break;
    }
  });

  return breakdown;
}

export function ledgerEventLabel(type: LedgerEventType): string {
  switch (type) {
    case LedgerEventType.PROCEDURE_PERFORMED:
      return 'Procedure performed';
    case LedgerEventType.CHARGE_CREATED:
      return 'Charge created';
    case LedgerEventType.CLAIM_SUBMITTED:
      return 'Claim submitted';
    case LedgerEventType.INSURANCE_PAYMENT:
      return 'Insurance payment';
    case LedgerEventType.INSURANCE_ADJUSTMENT:
      return 'Insurance adjustment';
    case LedgerEventType.PATIENT_PAYMENT:
      return 'Patient payment';
    case LedgerEventType.CREDIT_CREATED:
      return 'Credit created';
    case LedgerEventType.CREDIT_APPLIED:
      return 'Credit applied';
    case LedgerEventType.BALANCE_CORRECTION:
      return 'Balance correction';
    case LedgerEventType.NOTE:
      return 'Note';
    default:
      return 'Ledger event';
  }
}

export function isAdjustmentAfterZero(events: LedgerEvent[]): boolean {
  const summary = buildLedgerSummary(events);
  const zeroIndex = summary.timeline.findIndex((entry) => entry.isLastZero);
  if (zeroIndex < 0) {
    return false;
  }
  return summary.timeline.slice(zeroIndex + 1).some((entry) =>
    entry.event.type === LedgerEventType.INSURANCE_ADJUSTMENT ||
    entry.event.type === LedgerEventType.BALANCE_CORRECTION
  );
}
