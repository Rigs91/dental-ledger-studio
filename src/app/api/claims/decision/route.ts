import { NextResponse } from 'next/server';
import { z } from 'zod';
import { Claim, LedgerEventType, Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { prisma } from '@/shared/domain/db';
import { upsertSystemFlags } from '@/review/flags';
import { resolveInsuranceContextFromHistory } from '@/claims/services/insuranceSnapshot';
import { syncClaimArtifactsTx } from '@/claims/services/claimWriteService';

const schema = z.object({
  claimId: z.string().min(1),
  status: z.enum(['DENIED', 'PAID']),
  reasonCode: z.string().optional(),
  reasonText: z.string().min(3),
  insurancePaid: z.number().optional(),
  adjustment: z.number().optional(),
  copayPaid: z.number().optional(),
  occurredAt: z.string().optional()
});

export async function POST(request: Request) {
  const body = await request.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request payload.' }, { status: 400 });
  }

  const { claimId, status, reasonCode, reasonText, insurancePaid, adjustment, copayPaid, occurredAt } =
    parsed.data;
  const claim = await prisma.claim.findUnique({
    where: { id: claimId },
    include: { patient: true, visit: true, ledger: true, explanations: true, submissions: { orderBy: { createdAt: 'desc' } } }
  });
  if (!claim) {
    return NextResponse.json({ error: 'Claim not found.' }, { status: 404 });
  }

  const decisionDate = occurredAt ? new Date(occurredAt) : new Date();
  if (Number.isNaN(decisionDate.getTime())) {
    return NextResponse.json({ error: 'Decision date is invalid.' }, { status: 400 });
  }

  if (status === 'PAID') {
    const paid = insurancePaid ?? 0;
    const writeoff = adjustment ?? 0;
    const copay = copayPaid ?? 0;
    if (paid <= 0 && writeoff <= 0 && copay <= 0) {
      return NextResponse.json(
        { error: 'Enter an insurance payment, adjustment, or copay amount to post the decision.' },
        { status: 400 }
      );
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.claimDecision.create({
      data: {
        claimId: claim.id,
        status,
        reasonCode: reasonCode ?? null,
        reasonText,
        occurredAt: decisionDate
      }
    });

    await tx.claim.update({
      where: { id: claim.id },
      data: { status }
    });

    const ledgerEvents: Prisma.LedgerEventUncheckedCreateInput[] = [];

    if (status === 'PAID') {
      if (insurancePaid && insurancePaid > 0) {
        ledgerEvents.push({
          patientId: claim.patientId,
          visitId: claim.visitId,
          claimId: claim.id,
          type: LedgerEventType.INSURANCE_PAYMENT,
          amount: new Decimal(insurancePaid.toFixed(2)).mul(-1),
          occurredAt: decisionDate,
          metadata: { note: 'Insurance payment posted from decision.' }
        });
      }
      if (adjustment && adjustment > 0) {
        ledgerEvents.push({
          patientId: claim.patientId,
          visitId: claim.visitId,
          claimId: claim.id,
          type: LedgerEventType.INSURANCE_ADJUSTMENT,
          amount: new Decimal(adjustment.toFixed(2)).mul(-1),
          occurredAt: decisionDate,
          metadata: { reason: 'Adjustment/write-off posted from decision.' }
        });
      }
      if (copayPaid && copayPaid > 0) {
        ledgerEvents.push({
          patientId: claim.patientId,
          visitId: claim.visitId,
          claimId: claim.id,
          type: LedgerEventType.PATIENT_PAYMENT,
          amount: new Decimal(copayPaid.toFixed(2)).mul(-1),
          occurredAt: decisionDate,
          metadata: { note: 'Copay collected at decision.', source: 'copay' }
        });
      }
    }

    ledgerEvents.push({
      patientId: claim.patientId,
      visitId: claim.visitId,
      claimId: claim.id,
      type: LedgerEventType.NOTE,
      amount: new Decimal('0'),
      occurredAt: decisionDate,
      metadata: {
        note: `Claim ${status.toLowerCase()} recorded.`,
        reason: reasonText,
        reasonCode: reasonCode ?? null,
        insurancePaid: insurancePaid ?? null,
        adjustment: adjustment ?? null,
        copayPaid: copayPaid ?? null
      }
    });

    if (ledgerEvents.length > 0) {
      await tx.ledgerEvent.createMany({ data: ledgerEvents });
    }

    if (status === 'PAID') {
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
          status,
          insuranceReason: insuranceContext.insuranceReason ?? claim.insuranceReason
        } as Claim,
        patient: claim.patient,
        visit: claim.visit,
        ledger: refreshedLedger,
        insuranceSnapshot: insuranceContext.snapshot,
        explanation: claim.explanations[0] ?? null
      });
    }

    await upsertSystemFlags(claim.id, tx);
  });

  return NextResponse.json({ ok: true });
}

