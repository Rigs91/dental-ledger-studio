import { NextResponse } from 'next/server';
import { z } from 'zod';
import { Claim, LedgerEventType, Prisma } from '@prisma/client';
import { prisma } from '@/shared/domain/db';
import { Decimal } from '@prisma/client/runtime/library';
import { upsertSystemFlags } from '@/review/flags';
import { resolveInsuranceContextFromHistory } from '@/claims/services/insuranceSnapshot';
import { syncClaimArtifactsTx } from '@/claims/services/claimWriteService';

const schema = z.object({
  claimId: z.string(),
  amount: z.number().positive(),
  occurredAt: z.string(),
  category: z.enum(['COPAY', 'SELF_PAY', 'OTHER']).optional(),
  note: z.string().optional()
});

export async function POST(request: Request) {
  const body = await request.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request payload.' }, { status: 400 });
  }

  const { claimId, amount, occurredAt, category, note } = parsed.data;
  const claim = await prisma.claim.findUnique({
    where: { id: claimId },
    include: {
      patient: true,
      visit: true,
      ledger: true,
      explanations: true,
      submissions: { orderBy: { createdAt: 'desc' } }
    }
  });

  if (!claim) {
    return NextResponse.json({ error: 'Claim not found.' }, { status: 404 });
  }

  const occurredDate = new Date(occurredAt);
  if (Number.isNaN(occurredDate.getTime())) {
    return NextResponse.json({ error: 'Payment date is invalid.' }, { status: 400 });
  }

  const metadata: Record<string, unknown> = {};
  if (note && note.trim().length > 0) {
    metadata.note = note.trim();
  }
  if (category === 'COPAY') {
    metadata.source = 'copay';
  } else if (category === 'SELF_PAY') {
    metadata.source = 'self-pay';
  } else {
    metadata.source = 'patient';
  }

  await prisma.$transaction(async (tx) => {
    await tx.ledgerEvent.create({
      data: {
        patientId: claim.patientId,
        visitId: claim.visitId,
        claimId: claim.id,
        type: LedgerEventType.PATIENT_PAYMENT,
        amount: new Decimal(amount.toFixed(2)).mul(-1),
        occurredAt: occurredDate,
        metadata: metadata as Prisma.InputJsonValue
      }
    });

    const refreshedLedger = await tx.ledgerEvent.findMany({
      where: { claimId: claim.id },
      orderBy: [{ occurredAt: 'asc' }, { createdAt: 'asc' }]
    });
    const insuranceContext = resolveInsuranceContextFromHistory({
      claimInsuranceSnapshot: claim.insuranceSnapshot,
      claimInsurancePolicyId: claim.insurancePolicyId ?? null,
      claimInsuranceReason: claim.insuranceReason,
      submissions: claim.submissions
    });
    await syncClaimArtifactsTx({
      tx,
      claim: {
        ...claim,
        insuranceReason: insuranceContext.insuranceReason ?? claim.insuranceReason
      } as Claim,
      patient: claim.patient,
      visit: claim.visit,
      ledger: refreshedLedger,
      insuranceSnapshot: insuranceContext.snapshot,
      explanation: claim.explanations[0] ?? null
    });

    await upsertSystemFlags(claim.id, tx);
  });

  return NextResponse.json({ ok: true });
}

