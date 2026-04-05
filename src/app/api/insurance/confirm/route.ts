import { NextResponse } from 'next/server';
import { z } from 'zod';
import { Claim, Prisma } from '@prisma/client';
import { prisma } from '@/shared/domain/db';
import { buildPolicySnapshot } from '@/activity/patientActivity';
import { formatDate } from '@/shared/domain/format';
import { getPolicyVerificationDueAt, isPolicyActive, needsReverification } from '@/insurance/insurance';
import { buildInsuranceSnapshotFromPolicy } from '@/claims/services/insuranceSnapshot';
import {
  buildClaimSubmissionAuditEvents,
  syncClaimArtifactsTx
} from '@/claims/services/claimWriteService';
import { upsertSystemFlags } from '@/review/flags';

const schema = z.object({
  claimId: z.string(),
  insurancePolicyId: z.string(),
  reason: z.string().min(3)
});

export async function POST(request: Request) {
  const body = await request.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
  }

  const claim = await prisma.claim.findUnique({
    where: { id: parsed.data.claimId },
    include: {
      patient: true,
      visit: true,
      ledger: true,
      explanations: { orderBy: { createdAt: 'desc' } },
      submissions: { orderBy: { createdAt: 'desc' } }
    }
  });
  if (!claim) {
    return NextResponse.json({ error: 'Claim not found.' }, { status: 404 });
  }

  const policy = await prisma.insurancePolicy.findUnique({ where: { id: parsed.data.insurancePolicyId } });
  if (!policy) {
    return NextResponse.json({ error: 'Policy not found.' }, { status: 404 });
  }
  if (!isPolicyActive(policy, claim.visit.dateOfService)) {
    const reverificationRequired = needsReverification(policy, claim.visit.dateOfService);
    return NextResponse.json(
      {
        error: reverificationRequired
          ? 'Policy requires re-verification for this date of service.'
          : 'Policy is not active for this date of service.',
        reverificationRequired,
        policyId: policy.id,
        patientId: claim.patientId,
        verificationDueAt: reverificationRequired ? getPolicyVerificationDueAt(policy).toISOString() : null
      },
      { status: 409 }
    );
  }

  const confirmedAt = new Date();
  const insuranceSnapshot = buildInsuranceSnapshotFromPolicy(policy);
  const payerName = insuranceSnapshot.payerName;

  const employerLabel = policy.employerName ? ` - Employer ${policy.employerName}` : '';
  await prisma.$transaction(async (tx) => {
    await tx.claim.update({
      where: { id: claim.id },
      data: { status: 'SUBMITTED' }
    });

    await tx.patientActivityEvent.create({
      data: {
        patientId: claim.patientId,
        category: 'INSURANCE',
        type: 'INSURANCE_SELECTION_CONFIRMED',
        title: 'Insurance selection confirmed',
        detail: `${policy.payerName} (${policy.priority})${employerLabel} - Claim ${claim.id} - DOS ${formatDate(
          claim.visit.dateOfService
        )} - ${parsed.data.reason}`,
        occurredAt: confirmedAt,
        insurancePolicyId: policy.id,
        claimId: claim.id,
        metadata: {
          policySnapshot: buildPolicySnapshot(policy),
          reason: parsed.data.reason,
          claimId: claim.id
        } as Prisma.InputJsonValue
      }
    });

    await tx.ledgerEvent.createMany({
      data: buildClaimSubmissionAuditEvents({
        patientId: claim.patientId,
        visitId: claim.visitId,
        claimId: claim.id,
        occurredAt: confirmedAt,
        reason: parsed.data.reason,
        payerName,
        channel: 'insurance-confirmation'
      })
    });

    const refreshedLedger = await tx.ledgerEvent.findMany({
      where: { claimId: claim.id },
      orderBy: [{ occurredAt: 'asc' }, { createdAt: 'asc' }]
    });

    await syncClaimArtifactsTx({
      tx,
      claim: { ...claim, status: 'SUBMITTED', insuranceReason: parsed.data.reason } as Claim,
      patient: claim.patient,
      visit: claim.visit,
      ledger: refreshedLedger,
      insuranceSnapshot,
      explanation: claim.explanations[0] ?? null,
      submission: {
        insurancePolicyId: policy.id,
        reason: parsed.data.reason
      }
    });

    await upsertSystemFlags(claim.id, tx);
  });

  return NextResponse.json({ ok: true });
}

