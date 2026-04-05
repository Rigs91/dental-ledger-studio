import { formatCurrency, formatDate } from '@/shared/domain/format';
import type { InsurancePolicy } from '@prisma/client';

export type PolicySnapshot = {
  payerName: string;
  memberId: string;
  groupId: string | null;
  subscriberName: string | null;
  employerName: string | null;
  priority: string;
  effectiveStart: string;
  effectiveEnd: string | null;
  lastVerifiedAt: string | null;
  copayAmount: string | null;
};

export type PolicyChange = {
  field: string;
  from: string | null;
  to: string | null;
};

const formatOptional = (value?: string | null) => (value && value.length > 0 ? value : null);

const formatCopay = (amount?: string | null) => {
  if (!amount) {
    return null;
  }
  const parsed = Number(amount);
  if (Number.isNaN(parsed)) {
    return amount;
  }
  return formatCurrency(parsed);
};

const formatDateValue = (value?: Date | string | null) => {
  if (!value) {
    return null;
  }
  return formatDate(value);
};

export function buildPolicySnapshot(policy: InsurancePolicy): PolicySnapshot {
  return {
    payerName: policy.payerName,
    memberId: policy.memberId,
    groupId: formatOptional(policy.groupId),
    subscriberName: formatOptional(policy.subscriberName),
    employerName: formatOptional(policy.employerName),
    priority: policy.priority,
    effectiveStart: policy.effectiveStart.toISOString(),
    effectiveEnd: policy.effectiveEnd ? policy.effectiveEnd.toISOString() : null,
    lastVerifiedAt: policy.lastVerifiedAt ? policy.lastVerifiedAt.toISOString() : null,
    copayAmount: policy.copayAmount ? policy.copayAmount.toString() : null
  };
}

export function buildPolicyChangeSummary(
  before: InsurancePolicy,
  after: InsurancePolicy
): { changes: PolicyChange[]; detail: string; endedCoverage: boolean } {
  const changes: PolicyChange[] = [];
  const pushChange = (field: string, from: string | null, to: string | null) => {
    if (from === to) {
      return;
    }
    changes.push({ field, from, to });
  };

  pushChange('Payer', before.payerName, after.payerName);
  pushChange('Member ID', before.memberId, after.memberId);
  pushChange('Group ID', formatOptional(before.groupId), formatOptional(after.groupId));
  pushChange('Subscriber', formatOptional(before.subscriberName), formatOptional(after.subscriberName));
  pushChange('Employer', formatOptional(before.employerName), formatOptional(after.employerName));
  pushChange('Priority', before.priority, after.priority);
  pushChange('Effective start', formatDateValue(before.effectiveStart), formatDateValue(after.effectiveStart));
  pushChange(
    'Effective end',
    formatDateValue(before.effectiveEnd),
    formatDateValue(after.effectiveEnd)
  );
  pushChange(
    'Last verified',
    formatDateValue(before.lastVerifiedAt),
    formatDateValue(after.lastVerifiedAt)
  );
  pushChange('Copay', formatCopay(before.copayAmount?.toString()), formatCopay(after.copayAmount?.toString()));

  const detail = changes.length > 0
    ? changes
        .map((change) => `${change.field}: ${change.from ?? 'None'} -> ${change.to ?? 'None'}`)
        .join(' | ')
    : 'Policy details updated.';

  const beforeEnd = before.effectiveEnd ? before.effectiveEnd.getTime() : null;
  const afterEnd = after.effectiveEnd ? after.effectiveEnd.getTime() : null;
  const endedCoverage =
    afterEnd !== null && (beforeEnd === null || (beforeEnd !== null && afterEnd < beforeEnd));

  return { changes, detail, endedCoverage };
}
