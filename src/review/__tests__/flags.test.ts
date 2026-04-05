import { describe, it, expect } from 'vitest';
import { detectFlags } from '../flags';
import type { Claim, InsurancePolicy, LedgerEvent, ProcedureRecord } from '@prisma/client';
import { LedgerEventType } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';

const baseClaim = (overrides: Partial<Claim> = {}): Claim => ({
  id: 'claim',
  patientId: 'patient',
  visitId: 'visit',
  insurancePolicyId: null,
  insuranceSnapshot: null,
  insuranceReason: 'Test',
  status: 'SUBMITTED',
  createdAt: new Date('2026-01-01'),
  ...overrides
});

const event = (type: LedgerEventType, amount: string, occurredAt: string): LedgerEvent => ({
  id: `${type}-${occurredAt}`,
  patientId: 'patient',
  visitId: 'visit',
  claimId: 'claim',
  type,
  amount: new Decimal(amount),
  occurredAt: new Date(occurredAt),
  metadata: {},
  createdAt: new Date(occurredAt)
});

describe('detectFlags', () => {
  it('flags adjustments after zero balance', () => {
    const ledgerEvents = [
      event(LedgerEventType.CHARGE_CREATED, '100.00', '2026-01-01'),
      event(LedgerEventType.PATIENT_PAYMENT, '-100.00', '2026-01-02'),
      event(LedgerEventType.BALANCE_CORRECTION, '15.00', '2026-01-03')
    ];

    const flags = detectFlags({
      claim: baseClaim(),
      policies: [] as InsurancePolicy[],
      overrides: [],
      procedures: [] as ProcedureRecord[],
      ledgerEvents,
      dateOfService: new Date('2026-01-01')
    });

    expect(flags.some((flag) => flag.fingerprint.includes('adjustment-after-zero'))).toBe(true);
  });

  it('flags denied claims for review', () => {
    const flags = detectFlags({
      claim: baseClaim({ status: 'DENIED' }),
      policies: [] as InsurancePolicy[],
      overrides: [],
      procedures: [] as ProcedureRecord[],
      ledgerEvents: [],
      dateOfService: new Date('2026-01-01')
    });

    expect(flags.some((flag) => flag.fingerprint.includes('claim-denied'))).toBe(true);
  });

  it('flags unapplied credits older than 30 days', () => {
    const ledgerEvents = [
      {
        ...event(LedgerEventType.CREDIT_CREATED, '-25.00', '2025-01-01'),
        id: 'credit-old-open'
      }
    ];

    const flags = detectFlags({
      claim: baseClaim(),
      policies: [] as InsurancePolicy[],
      overrides: [],
      procedures: [] as ProcedureRecord[],
      ledgerEvents,
      dateOfService: new Date('2026-01-01')
    });

    expect(flags.some((flag) => flag.fingerprint.includes('unapplied-credit-credit-old-open'))).toBe(
      true
    );
  });
});
