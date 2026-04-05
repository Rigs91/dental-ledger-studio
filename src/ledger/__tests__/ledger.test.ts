import { describe, it, expect } from 'vitest';
import { buildLedgerSummary } from '../ledger';
import type { LedgerEvent } from '@prisma/client';
import { LedgerEventType } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';

function event(
  type: LedgerEventType,
  amount: string,
  occurredAt: string,
  overrides: Partial<LedgerEvent> = {}
): LedgerEvent {
  return {
    id: `${type}-${occurredAt}`,
    patientId: 'patient',
    visitId: null,
    claimId: null,
    type,
    amount: new Decimal(amount),
    occurredAt: new Date(occurredAt),
    metadata: {},
    createdAt: new Date(occurredAt),
    ...overrides
  };
}

describe('buildLedgerSummary', () => {
  it('calculates running balance and last zero', () => {
    const events = [
      event(LedgerEventType.CHARGE_CREATED, '100.00', '2026-01-01'),
      event(LedgerEventType.INSURANCE_PAYMENT, '-60.00', '2026-01-03'),
      event(LedgerEventType.PATIENT_PAYMENT, '-40.00', '2026-01-05')
    ];

    const summary = buildLedgerSummary(events);
    expect(summary.currentBalance).toBeCloseTo(0);
    expect(summary.lastZeroAt).toBeTruthy();
  });

  it('tracks only unapplied credits in the summary', () => {
    const appliedCredit = event(LedgerEventType.CREDIT_CREATED, '-20.00', '2026-01-01', {
      id: 'credit-applied'
    });
    const unappliedCredit = event(LedgerEventType.CREDIT_CREATED, '-15.00', '2026-01-02', {
      id: 'credit-open'
    });
    const creditAppliedEvent = event(LedgerEventType.CREDIT_APPLIED, '20.00', '2026-01-03', {
      metadata: { creditEventId: 'credit-applied' }
    });

    const summary = buildLedgerSummary([appliedCredit, unappliedCredit, creditAppliedEvent]);

    expect(summary.unappliedCredits.map((credit) => credit.id)).toEqual(['credit-open']);
    expect(summary.currentBalance).toBeCloseTo(-15);
  });
});
