import { describe, it, expect } from 'vitest';
import { selectInsurance } from '../insurance';
import type { InsuranceOverride, InsurancePolicy } from '@prisma/client';

const basePolicy = (overrides: Partial<InsurancePolicy>): InsurancePolicy => ({
  id: 'policy',
  patientId: 'patient',
  payerName: 'Carrier',
  memberId: '123',
  groupId: null,
  subscriberName: null,
  employerName: null,
  priority: 'PRIMARY',
  effectiveStart: new Date('2026-01-01'),
  effectiveEnd: null,
  lastVerifiedAt: null,
  copayAmount: null,
  createdAt: new Date('2026-01-01'),
  ...overrides
});

describe('selectInsurance', () => {
  it('requires confirmation when multiple active policies exist', () => {
    const policies = [
      basePolicy({ id: 'p1', payerName: 'Alpha Dental', priority: 'PRIMARY' }),
      basePolicy({ id: 'p2', payerName: 'Beta Dental', priority: 'SECONDARY' })
    ];
    const selection = selectInsurance(policies, new Date('2026-01-15'), []);
    expect(selection.needsConfirmation).toBe(true);
    expect(selection.selectedPolicy?.id).toBe('p1');
  });

  it('treats policies older than one year as needing re-verification', () => {
    const stalePolicy = basePolicy({
      id: 'stale',
      effectiveStart: new Date('2024-01-01'),
      lastVerifiedAt: null
    });
    const selection = selectInsurance([stalePolicy], new Date('2025-02-01'), []);
    expect(selection.activePolicies.length).toBe(0);
    expect(selection.reason.toLowerCase()).toContain('re-verification');

    const reverifiedPolicy = basePolicy({
      id: 'verified',
      effectiveStart: new Date('2024-01-01'),
      lastVerifiedAt: new Date('2025-01-15')
    });
    const selectionAfterVerify = selectInsurance([reverifiedPolicy], new Date('2025-02-01'), []);
    expect(selectionAfterVerify.activePolicies.length).toBe(1);
  });

  it('requires explicit confirmation when multiple primary policies are active', () => {
    const policies = [
      basePolicy({ id: 'p1', payerName: 'Alpha Dental', priority: 'PRIMARY' }),
      basePolicy({ id: 'p2', payerName: 'Beta Dental', priority: 'PRIMARY' })
    ];
    const selection = selectInsurance(policies, new Date('2026-01-15'), []);
    expect(selection.needsConfirmation).toBe(true);
    expect(selection.selectedPolicy).toBeNull();
    expect(selection.reason.toLowerCase()).toContain('multiple primary');
  });

  it('blocks an override when its policy is inactive on the date of service', () => {
    const policy = basePolicy({
      id: 'inactive-policy',
      payerName: 'Legacy Dental',
      effectiveStart: new Date('2024-01-01'),
      effectiveEnd: new Date('2024-12-31'),
      lastVerifiedAt: new Date('2024-06-01')
    });
    const override: InsuranceOverride = {
      id: 'override-1',
      patientId: 'patient',
      insurancePolicyId: policy.id,
      effectiveStart: new Date('2025-01-01'),
      effectiveEnd: null,
      reason: 'Patient requested legacy plan',
      createdAt: new Date('2025-01-01')
    };

    const selection = selectInsurance([policy], new Date('2025-02-01'), [override]);
    expect(selection.needsConfirmation).toBe(true);
    expect(selection.selectedPolicy).toBeNull();
    expect(selection.reason.toLowerCase()).toContain('not active');
  });
});
