import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/shared/domain/db';
import { parseFlexibleDate } from '@/shared/validation/date';
import { Claim, Prisma } from '@prisma/client';
import { upsertSystemFlags } from '@/review/flags';
import { buildPolicySnapshot } from '@/activity/patientActivity';
import { formatDate } from '@/shared/domain/format';
import { getPolicyVerificationDueAt, needsReverification } from '@/insurance/insurance';
import { buildInsuranceSnapshotFromPolicy } from '@/claims/services/insuranceSnapshot';
import {
  buildClaimSubmissionAuditEvents,
  syncClaimArtifactsTx
} from '@/claims/services/claimWriteService';

type ClaimWithOverrideRelations = Prisma.ClaimGetPayload<{
  include: {
    patient: true;
    visit: true;
    ledger: true;
    explanations: true;
    submissions: true;
  };
}>;

const schema = z.object({
  patientId: z.string().min(1),
  insurancePolicyId: z.string().min(1),
  effectiveStart: z.string().min(1),
  effectiveEnd: z.string().optional().nullable(),
  reason: z.string().min(3),
  claimIds: z.array(z.string()).optional()
});

export async function POST(request: Request) {
  const body = await request.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
  }

  const { patientId, insurancePolicyId, effectiveStart, effectiveEnd, reason, claimIds } = parsed.data;

  const patient = await prisma.patient.findUnique({ where: { id: patientId } });
  if (!patient) {
    return NextResponse.json({ error: 'Patient not found.' }, { status: 404 });
  }

  const policy = await prisma.insurancePolicy.findUnique({ where: { id: insurancePolicyId } });
  if (!policy || policy.patientId !== patientId) {
    return NextResponse.json({ error: 'Policy not found for this patient.' }, { status: 404 });
  }

  const startResult = parseFlexibleDate(effectiveStart);
  const startDate = startResult.date;
  if (!startDate) {
    return NextResponse.json({ error: startResult.error ?? 'Effective start date is invalid.' }, { status: 400 });
  }

  let endDate: Date | null = null;
  if (effectiveEnd) {
    const endResult = parseFlexibleDate(effectiveEnd);
    if (!endResult.date) {
      return NextResponse.json({ error: endResult.error ?? 'Effective end date is invalid.' }, { status: 400 });
    }
    endDate = endResult.date;
    if (endDate.getTime() < startDate.getTime()) {
      return NextResponse.json({ error: 'Effective end date must be after start date.' }, { status: 400 });
    }
  }

  const policyStart = new Date(policy.effectiveStart).getTime();
  const policyEnd = policy.effectiveEnd ? new Date(policy.effectiveEnd).getTime() : null;
  if (startDate.getTime() < policyStart) {
    return NextResponse.json(
      { error: 'Override start must be within the policy effective range.' },
      { status: 400 }
    );
  }
  if (policyEnd && endDate && endDate.getTime() > policyEnd) {
    return NextResponse.json(
      { error: 'Override end must be within the policy effective range.' },
      { status: 400 }
    );
  }
  if (needsReverification(policy, startDate) || (endDate && needsReverification(policy, endDate))) {
    return NextResponse.json(
      {
        error: 'Policy requires re-verification for this override range. Update the verified date first.',
        reverificationRequired: true,
        policyId: policy.id,
        patientId,
        verificationDueAt: getPolicyVerificationDueAt(policy).toISOString()
      },
      { status: 409 }
    );
  }

  const claims = await prisma.claim.findMany({
    where: {
      patientId,
      visit: {
        dateOfService: {
          gte: startDate,
          ...(endDate ? { lte: endDate } : {})
        }
      }
    },
    include: {
      patient: true,
      visit: true,
      ledger: true,
      explanations: true,
      submissions: { orderBy: { createdAt: 'desc' } }
    }
  }) as ClaimWithOverrideRelations[];
  if (claimIds && claimIds.length > 0) {
    const claimIdSet = new Set(claimIds);
    const allowedIds = new Set(claims.map((claim) => claim.id));
    const invalidIds = Array.from(claimIdSet).filter((id) => !allowedIds.has(id));
    if (invalidIds.length > 0) {
      return NextResponse.json(
        { error: 'Selected claims must fall within the override date range.' },
        { status: 400 }
      );
    }
  }

  const claimIdsToUpdate = claimIds && claimIds.length > 0 ? new Set(claimIds) : null;
  const overrideReason = `Insurance override applied: ${reason}`;
  const employerLabel = policy.employerName ? ` - Employer ${policy.employerName}` : '';
  const snapshot = buildInsuranceSnapshotFromPolicy(policy);
  const result = await prisma.$transaction(async (tx) => {
    const override = await tx.insuranceOverride.create({
      data: {
        patientId,
        insurancePolicyId,
        effectiveStart: startDate,
        effectiveEnd: endDate,
        reason
      }
    });

    const updatedClaims: string[] = [];
    const skippedClaims: string[] = [];

    for (const claim of claims) {
      if (claimIdsToUpdate && !claimIdsToUpdate.has(claim.id)) {
        continue;
      }
      const latestSubmission = claim.submissions[0];
      const activePolicyId = latestSubmission?.insurancePolicyId ?? claim.insurancePolicyId ?? null;
      if (activePolicyId === policy.id) {
        skippedClaims.push(claim.id);
        continue;
      }

      await tx.claim.update({
        where: { id: claim.id },
        data: { status: 'SUBMITTED' }
      });

      const overrideAppliedAt = new Date();
      await tx.ledgerEvent.createMany({
        data: buildClaimSubmissionAuditEvents({
          patientId: claim.patientId,
          visitId: claim.visitId,
          claimId: claim.id,
          occurredAt: overrideAppliedAt,
          reason: overrideReason,
          payerName: snapshot.payerName,
          channel: 'override'
        })
      });

      const refreshedLedger = await tx.ledgerEvent.findMany({
        where: { claimId: claim.id },
        orderBy: [{ occurredAt: 'asc' }, { createdAt: 'asc' }]
      });

      await syncClaimArtifactsTx({
        tx,
        claim: { ...claim, status: 'SUBMITTED', insuranceReason: overrideReason } as Claim,
        patient: claim.patient,
        visit: claim.visit,
        ledger: refreshedLedger,
        insuranceSnapshot: snapshot,
        explanation: claim.explanations[0] ?? null,
        submission: {
          insurancePolicyId: policy.id,
          reason: overrideReason
        }
      });

      await upsertSystemFlags(claim.id, tx);
      updatedClaims.push(claim.id);
    }

    await tx.patientActivityEvent.create({
      data: {
        patientId,
        category: 'INSURANCE',
        type: 'INSURANCE_OVERRIDE_CREATED',
        title: 'Insurance override created',
        detail: `${policy.payerName} (${policy.priority})${employerLabel} - ${formatDate(
          startDate
        )}${endDate ? ` - ${formatDate(endDate)}` : ''} - ${updatedClaims.length} claim(s) updated - ${reason}`,
        occurredAt: new Date(),
        insurancePolicyId,
        insuranceOverrideId: override.id,
        metadata: {
          policySnapshot: buildPolicySnapshot(policy),
          override: {
            effectiveStart: startDate.toISOString(),
            effectiveEnd: endDate?.toISOString() ?? null,
            reason
          },
          claimsUpdated: updatedClaims.length,
          claimsSkipped: skippedClaims.length
        } as Prisma.InputJsonValue
      }
    });

    return { overrideId: override.id, updatedClaims, skippedClaims };
  });

  return NextResponse.json(result);
}

