import { InsuranceOverride, InsurancePolicy, InsurancePriority } from '@prisma/client';
import { formatDate } from '@/shared/domain/format';

export type InsuranceSelection = {
  activePolicies: InsurancePolicy[];
  selectedPolicy: InsurancePolicy | null;
  needsConfirmation: boolean;
  reason: string;
  warnings: string[];
};

const priorityRank: Record<InsurancePriority, number> = {
  PRIMARY: 1,
  SECONDARY: 2,
  TERTIARY: 3
};

function addYears(date: Date, years: number): Date {
  const next = new Date(date);
  next.setFullYear(next.getFullYear() + years);
  return next;
}

export function getPolicyVerificationAnchor(policy: InsurancePolicy): Date {
  if (!policy.lastVerifiedAt) {
    return policy.effectiveStart;
  }
  return policy.lastVerifiedAt.getTime() < policy.effectiveStart.getTime()
    ? policy.effectiveStart
    : policy.lastVerifiedAt;
}

export function getPolicyVerificationDueAt(policy: InsurancePolicy): Date {
  return addYears(getPolicyVerificationAnchor(policy), 1);
}

export function needsReverification(policy: InsurancePolicy, dateOfService: Date): boolean {
  return dateOfService.getTime() > getPolicyVerificationDueAt(policy).getTime();
}

export function isPolicyActive(policy: InsurancePolicy, dateOfService: Date): boolean {
  const start = new Date(policy.effectiveStart).getTime();
  const end = policy.effectiveEnd ? new Date(policy.effectiveEnd).getTime() : undefined;
  const dos = dateOfService.getTime();
  if (dos < start) {
    return false;
  }
  if (end && dos > end) {
    return false;
  }
  if (needsReverification(policy, dateOfService)) {
    return false;
  }
  return true;
}

function isOverrideActive(override: InsuranceOverride, dateOfService: Date): boolean {
  const start = new Date(override.effectiveStart).getTime();
  const end = override.effectiveEnd ? new Date(override.effectiveEnd).getTime() : undefined;
  const dos = dateOfService.getTime();
  if (dos < start) {
    return false;
  }
  if (end && dos > end) {
    return false;
  }
  return true;
}

export function selectInsurance(
  policies: InsurancePolicy[],
  dateOfService: Date,
  overrides: InsuranceOverride[] = []
): InsuranceSelection {
  const warnings: string[] = [];
  const active = policies.filter((policy) => isPolicyActive(policy, dateOfService));
  const stalePolicies = policies.filter((policy) => {
    if (isPolicyActive(policy, dateOfService)) {
      return false;
    }
    const start = new Date(policy.effectiveStart).getTime();
    const end = policy.effectiveEnd ? new Date(policy.effectiveEnd).getTime() : undefined;
    const dos = dateOfService.getTime();
    if (dos < start) {
      return false;
    }
    if (end && dos > end) {
      return false;
    }
    return needsReverification(policy, dateOfService);
  });

  const nearDosWindow = 14 * 24 * 60 * 60 * 1000;
  active.forEach((policy) => {
    const startDelta = Math.abs(dateOfService.getTime() - new Date(policy.effectiveStart).getTime());
    const endDelta = policy.effectiveEnd
      ? Math.abs(dateOfService.getTime() - new Date(policy.effectiveEnd).getTime())
      : undefined;
    if (startDelta <= nearDosWindow || (endDelta !== undefined && endDelta <= nearDosWindow)) {
      warnings.push(`Policy ${policy.payerName} changed within 14 days of service.`);
    }
  });

  stalePolicies.forEach((policy) => {
    const anchor = getPolicyVerificationAnchor(policy);
    warnings.push(
      `Policy ${policy.payerName} needs re-verification (last verified ${formatDate(anchor)}).`
    );
  });

  const activeOverrides = overrides.filter((override) => isOverrideActive(override, dateOfService));
  if (activeOverrides.length > 0) {
    if (activeOverrides.length > 1) {
      return {
        activePolicies: active,
        selectedPolicy: null,
        needsConfirmation: true,
        reason: 'Multiple insurance overrides are active. Confirm the correct policy.',
        warnings
      };
    }
    const overridePolicyId = activeOverrides[0].insurancePolicyId;
    const overridePolicy = policies.find((policy) => policy.id === overridePolicyId) ?? null;
    if (!overridePolicy) {
      return {
        activePolicies: active,
        selectedPolicy: null,
        needsConfirmation: true,
        reason: 'Insurance override references a missing policy. Update the override.',
        warnings
      };
    }
    if (!isPolicyActive(overridePolicy, dateOfService)) {
      return {
        activePolicies: active,
        selectedPolicy: null,
        needsConfirmation: true,
        reason: 'Insurance override references a policy that is not active for this date.',
        warnings
      };
    }
    return {
      activePolicies: active,
      selectedPolicy: overridePolicy,
      needsConfirmation: false,
      reason: `Override applied: ${overridePolicy.payerName} selected for this visit.`,
      warnings
    };
  }

  if (active.length === 0) {
    return {
      activePolicies: [],
      selectedPolicy: null,
      needsConfirmation: true,
      reason:
        stalePolicies.length > 0
          ? 'Policies on file require re-verification. Update the verified date or confirm self-pay.'
          : 'No active policy for this date of service. Confirm self-pay or add coverage.',
      warnings
    };
  }

  const sorted = [...active].sort((a, b) => priorityRank[a.priority] - priorityRank[b.priority]);
  const bestPriority = sorted[0].priority;
  const samePriority = sorted.filter((policy) => policy.priority === bestPriority);

  if (samePriority.length > 1) {
    return {
      activePolicies: sorted,
      selectedPolicy: null,
      needsConfirmation: true,
      reason: `Multiple ${bestPriority.toLowerCase()} policies are active. Select the correct primary.`,
      warnings
    };
  }

  if (active.length > 1) {
    return {
      activePolicies: sorted,
      selectedPolicy: samePriority[0],
      needsConfirmation: true,
      reason: 'Multiple active policies found. Confirm the primary selection before proceeding.',
      warnings
    };
  }

  return {
    activePolicies: sorted,
    selectedPolicy: samePriority[0],
    needsConfirmation: false,
    reason: `Single ${bestPriority.toLowerCase()} policy active for this date of service.`,
    warnings
  };
}
