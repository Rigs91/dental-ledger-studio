import { NextResponse } from 'next/server';
import { z } from 'zod';
import { Claim } from '@prisma/client';
import { prisma } from '@/shared/domain/db';
import { isPolicyActive } from '@/insurance/insurance';
import { upsertSystemFlags } from '@/review/flags';
import {
  buildInsuranceSnapshotFromPolicy,
  resolveInsuranceContextFromHistory
} from '@/claims/services/insuranceSnapshot';
import type { InsuranceSnapshot } from '@/documents/claimPackets';
import {
  buildClaimSubmissionAuditEvents,
  syncClaimArtifactsTx
} from '@/claims/services/claimWriteService';

const schema = z.object({
  claimId: z.string().min(1),
  reason: z.string().min(5),
  insurancePolicyId: z.string().optional(),
  useOriginalSnapshot: z.boolean().optional()
});

export async function POST(request: Request) {
  const body = await request.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request payload.' }, { status: 400 });
  }

  const { claimId, reason, insurancePolicyId, useOriginalSnapshot } = parsed.data;

  const claim = await prisma.claim.findUnique({
    where: { id: claimId },
    include: {
      patient: { include: { insurances: true } },
      visit: true,
      ledger: true,
      explanations: true,
      submissions: { orderBy: { createdAt: 'desc' } }
    }
  });

  if (!claim) {
    return NextResponse.json({ error: 'Claim not found.' }, { status: 404 });
  }

  let snapshot: InsuranceSnapshot | null = null;
  let resolvedPolicyId: string | null = null;

  if (useOriginalSnapshot) {
    const context = resolveInsuranceContextFromHistory({
      claimInsuranceSnapshot: claim.insuranceSnapshot,
      claimInsurancePolicyId: claim.insurancePolicyId ?? null,
      claimInsuranceReason: claim.insuranceReason,
      submissions: claim.submissions
    });
    snapshot = context.snapshot;
    resolvedPolicyId = context.insurancePolicyId;
    if (!snapshot) {
      return NextResponse.json({ error: 'Original insurance snapshot is missing.' }, { status: 400 });
    }
  } else if (insurancePolicyId) {
    const policy = claim.patient.insurances.find((entry) => entry.id === insurancePolicyId);
    if (!policy) {
      return NextResponse.json({ error: 'Selected policy not found for this patient.' }, { status: 404 });
    }
    if (!isPolicyActive(policy, claim.visit.dateOfService)) {
      return NextResponse.json(
        { error: 'Selected policy is not active for the date of service.' },
        { status: 409 }
      );
    }
    resolvedPolicyId = policy.id;
    snapshot = buildInsuranceSnapshotFromPolicy(policy);
  } else {
    return NextResponse.json({ error: 'Select an insurance snapshot to resubmit.' }, { status: 400 });
  }

  const resubmittedAt = new Date();
  const payerName = snapshot?.payerName ?? 'Self-pay';
  const result = await prisma.$transaction(async (tx) => {
    await tx.claim.update({
      where: { id: claim.id },
      data: { status: 'SUBMITTED' }
    });

    await tx.ledgerEvent.createMany({
      data: buildClaimSubmissionAuditEvents({
        patientId: claim.patientId,
        visitId: claim.visitId,
        claimId: claim.id,
        occurredAt: resubmittedAt,
        reason,
        payerName,
        channel: 'resubmission'
      })
    });

    const refreshedLedger = await tx.ledgerEvent.findMany({
      where: { claimId: claim.id },
      orderBy: [{ occurredAt: 'asc' }, { createdAt: 'asc' }]
    });

    const artifacts = await syncClaimArtifactsTx({
      tx,
      claim: { ...claim, status: 'SUBMITTED', insuranceReason: reason } as Claim,
      patient: claim.patient,
      visit: claim.visit,
      ledger: refreshedLedger,
      insuranceSnapshot: snapshot,
      explanation: claim.explanations[0] ?? null,
      submission: {
        insurancePolicyId: resolvedPolicyId ?? null,
        reason
      }
    });

    await upsertSystemFlags(claim.id, tx);
    return artifacts;
  });

  return NextResponse.json({ ok: true, packetId: result.payerPacketId });
}

