import type { ClaimSubmission, InsurancePolicy } from '@prisma/client';
import type { InsuranceSnapshot } from '@/documents/claimPackets';

type PolicySnapshotInput = Pick<
  InsurancePolicy,
  | 'payerName'
  | 'memberId'
  | 'groupId'
  | 'subscriberName'
  | 'employerName'
  | 'priority'
  | 'effectiveStart'
  | 'effectiveEnd'
  | 'lastVerifiedAt'
  | 'copayAmount'
>;

type SubmissionSnapshotInput = Pick<ClaimSubmission, 'insurancePolicyId' | 'reason'> & {
  insuranceSnapshot: unknown;
};

export type InsuranceContext = {
  snapshot: InsuranceSnapshot | null;
  insurancePolicyId: string | null;
  insuranceReason: string | null;
};

export function buildInsuranceSnapshotFromPolicy(policy: PolicySnapshotInput): InsuranceSnapshot {
  return {
    payerName: policy.payerName,
    memberId: policy.memberId,
    groupId: policy.groupId,
    subscriberName: policy.subscriberName,
    employerName: policy.employerName,
    priority: policy.priority,
    effectiveStart: policy.effectiveStart.toISOString(),
    effectiveEnd: policy.effectiveEnd?.toISOString() ?? null,
    lastVerifiedAt: policy.lastVerifiedAt?.toISOString() ?? null,
    copayAmount: policy.copayAmount?.toString() ?? null
  };
}

export function resolveInsuranceContextFromHistory(input: {
  claimInsuranceSnapshot: unknown;
  claimInsurancePolicyId: string | null;
  claimInsuranceReason: string;
  submissions: SubmissionSnapshotInput[];
}): InsuranceContext {
  const latestSubmission = input.submissions[0];
  const snapshot =
    (latestSubmission?.insuranceSnapshot as InsuranceSnapshot | null) ??
    (input.claimInsuranceSnapshot as InsuranceSnapshot | null) ??
    null;

  return {
    snapshot,
    insurancePolicyId: latestSubmission?.insurancePolicyId ?? input.claimInsurancePolicyId ?? null,
    insuranceReason: latestSubmission?.reason ?? input.claimInsuranceReason ?? null
  };
}
