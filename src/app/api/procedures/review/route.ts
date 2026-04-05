import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/shared/domain/db';
import { Decimal } from '@prisma/client/runtime/library';
import { LedgerEventType, Prisma } from '@prisma/client';
import { upsertSystemFlags } from '@/review/flags';
import { buildPayerPacket, buildPatientStatement, type InsuranceSnapshot } from '@/documents/claimPackets';

const schema = z.object({
  procedureId: z.string(),
  action: z.enum(['APPROVE', 'UPDATE']),
  selectedCode: z.string().optional(),
  reviewNote: z.string().min(3)
});

function toNumber(value: Decimal): number {
  return Number(value.toString());
}

export async function POST(request: Request) {
  const body = await request.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request payload.' }, { status: 400 });
  }

  const { procedureId, action, selectedCode, reviewNote } = parsed.data;
  const procedure = await prisma.procedureRecord.findUnique({
    where: { id: procedureId },
    include: { visit: true }
  });

  if (!procedure) {
    return NextResponse.json({ error: 'Procedure not found.' }, { status: 404 });
  }

  const claim = await prisma.claim.findFirst({
    where: { visitId: procedure.visitId },
    orderBy: { createdAt: 'desc' },
    include: {
      patient: true,
      visit: true,
      ledger: true,
      explanations: true,
      submissions: { orderBy: { createdAt: 'desc' } }
    }
  });

  const updatedAt = new Date();
  const noteText = reviewNote.trim();
  let newCode = procedure.selectedCode ?? '';
  let newLabel = procedure.selectedLabel ?? procedure.freeText;
  let chargeUpdate: { lineNumber: number; code: string; label: string; fee: string } | null = null;

  if (action === 'UPDATE') {
    const trimmedCode = selectedCode?.trim().toUpperCase();
    if (!trimmedCode) {
      return NextResponse.json({ error: 'Select a CDT code to update.' }, { status: 400 });
    }
    newCode = trimmedCode;

    const feeSchedule = await prisma.feeSchedule.findMany({
      where: { code: { in: [newCode, procedure.selectedCode ?? ''] } }
    });
    const feeMap = new Map(feeSchedule.map((fee) => [fee.code, fee]));
    const newFee = feeMap.get(newCode);
    if (!newFee) {
      return NextResponse.json({ error: 'Selected CDT code is missing from the fee schedule.' }, { status: 400 });
    }

    const candidateCodes = Array.isArray(procedure.candidateCodes) ? procedure.candidateCodes : [];
    const matchedCandidate = candidateCodes.find((entry) => {
      if (!entry || typeof entry !== 'object') {
        return false;
      }
      const record = entry as { code?: string };
      return record.code === newCode;
    }) as { label?: string } | undefined;
    newLabel = newFee.label ?? matchedCandidate?.label ?? procedure.selectedLabel ?? procedure.freeText;

    const visitProcedures = await prisma.procedureRecord.findMany({
      where: { visitId: procedure.visitId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }]
    });
    const index = visitProcedures.findIndex((entry) => entry.id === procedure.id);
    const lineNumber = index >= 0 ? index + 1 : null;
    const chargeEvent = claim
      ? claim.ledger.find((event) => {
          if (event.type !== 'CHARGE_CREATED') {
            return false;
          }
          const metadata = event.metadata as { lineNumber?: number } | null;
          return Boolean(metadata && metadata.lineNumber === lineNumber);
        })
      : null;

    const oldFee = procedure.selectedCode ? feeMap.get(procedure.selectedCode) : undefined;
    const oldFeeAmount = oldFee ? toNumber(oldFee.amount) : chargeEvent ? toNumber(chargeEvent.amount) : null;
    if (oldFeeAmount === null) {
      return NextResponse.json({ error: 'Unable to locate the original charge amount for this procedure.' }, { status: 409 });
    }
    const delta = toNumber(newFee.amount) - oldFeeAmount;

    if (claim && Math.abs(delta) > 0.005) {
      await prisma.ledgerEvent.create({
        data: {
          patientId: claim.patientId,
          visitId: procedure.visitId,
          claimId: claim.id,
          type: LedgerEventType.BALANCE_CORRECTION,
          amount: new Decimal(delta.toFixed(2)),
          occurredAt: updatedAt,
          metadata: {
            reason: 'Procedure code updated.',
            adjustmentType: 'PROCEDURE_UPDATE',
            procedureId: procedure.id,
            previousCode: procedure.selectedCode,
            newCode
          } as Prisma.InputJsonValue
        }
      });
    }

    if (lineNumber) {
      chargeUpdate = {
        lineNumber,
        code: newCode,
        label: newLabel,
        fee: newFee.amount.toString()
      };
    }
  }

  await prisma.procedureRecord.update({
    where: { id: procedure.id },
    data: {
      selectedCode: newCode || procedure.selectedCode,
      selectedLabel: newLabel,
      reviewStatus: action === 'UPDATE' && newCode !== procedure.selectedCode ? 'UPDATED' : 'APPROVED',
      reviewedAt: updatedAt,
      reviewNote: noteText
    }
  });

  if (claim) {
    await prisma.ledgerEvent.create({
      data: {
        patientId: claim.patientId,
        visitId: procedure.visitId,
        claimId: claim.id,
        type: LedgerEventType.NOTE,
        amount: new Decimal('0'),
        occurredAt: updatedAt,
        metadata: {
          note: 'Procedure review completed.',
          action,
          procedureId: procedure.id,
          previousCode: procedure.selectedCode,
          newCode,
          reviewNote: noteText,
          ...(chargeUpdate ? { chargeUpdate } : {})
        } as Prisma.InputJsonValue
      }
    });

    const refreshedLedger = await prisma.ledgerEvent.findMany({ where: { claimId: claim.id } });
    const explanation = claim.explanations[0];
    const latestSubmission = claim.submissions[0];
    const snapshot =
      (latestSubmission?.insuranceSnapshot as InsuranceSnapshot | null) ??
      (claim.insuranceSnapshot as InsuranceSnapshot | null);
    const insuranceReason = latestSubmission?.reason ?? claim.insuranceReason;
    const claimForPacket = { ...claim, insuranceReason };
    const payerPacket = buildPayerPacket({
      claim: claimForPacket,
      patient: claim.patient,
      visit: claim.visit,
      ledger: refreshedLedger,
      insuranceSnapshot: snapshot
    });
    const patientStatement = buildPatientStatement({
      claim: claimForPacket,
      patient: claim.patient,
      visit: claim.visit,
      ledger: refreshedLedger,
      insuranceSnapshot: snapshot,
      explanation
    });

    await prisma.claimPacket.createMany({
      data: [
        {
          claimId: claim.id,
          type: 'PAYER',
          payload: payerPacket.payload,
          html: payerPacket.html
        },
        {
          claimId: claim.id,
          type: 'PATIENT',
          payload: patientStatement.payload,
          html: patientStatement.html
        }
      ]
    });

    await upsertSystemFlags(claim.id);
  }

  return NextResponse.json({ ok: true });
}

