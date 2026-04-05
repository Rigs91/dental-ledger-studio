import { Claim, ExplanationDraft, LedgerEvent, Patient, Prisma, Visit } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { draftBalanceExplanation } from '@/claims/rules/explanation';
import { buildPayerPacket, buildPatientStatement, type InsuranceSnapshot } from '@/documents/claimPackets';

type SyncClaimArtifactsInput = {
  tx: Prisma.TransactionClient;
  claim: Claim;
  patient: Patient;
  visit: Visit;
  ledger: LedgerEvent[];
  insuranceSnapshot: InsuranceSnapshot | null;
  explanation?: ExplanationDraft | null;
  submission?: {
    insurancePolicyId: string | null;
    reason: string;
  };
};

export async function syncClaimArtifactsTx(input: SyncClaimArtifactsInput) {
  const { tx, claim, patient, visit, ledger, insuranceSnapshot, explanation, submission } = input;
  const explanationText = draftBalanceExplanation(ledger);
  const explanationRecord = explanation
    ? await tx.explanationDraft.update({
        where: { id: explanation.id },
        data: { originalText: explanationText }
      })
    : await tx.explanationDraft.create({
        data: {
          claimId: claim.id,
          originalText: explanationText,
          status: 'DRAFT'
        }
      });

  const claimForPacket = {
    ...claim,
    insuranceReason: submission?.reason ?? claim.insuranceReason
  };

  const payerPacket = buildPayerPacket({
    claim: claimForPacket,
    patient,
    visit,
    ledger,
    insuranceSnapshot
  });
  const patientStatement = buildPatientStatement({
    claim: claimForPacket,
    patient,
    visit,
    ledger,
    insuranceSnapshot,
    explanation: explanationRecord
  });

  const payerPacketRecord = await tx.claimPacket.create({
    data: {
      claimId: claim.id,
      type: 'PAYER',
      payload: payerPacket.payload,
      html: payerPacket.html
    }
  });

  await tx.claimPacket.create({
    data: {
      claimId: claim.id,
      type: 'PATIENT',
      payload: patientStatement.payload,
      html: patientStatement.html
    }
  });

  if (submission) {
    await tx.claimSubmission.create({
      data: {
        claimId: claim.id,
        insurancePolicyId: submission.insurancePolicyId,
        insuranceSnapshot: insuranceSnapshot ?? undefined,
        reason: submission.reason,
        packetId: payerPacketRecord.id
      }
    });
  }

  return {
    explanation: explanationRecord,
    payerPacketId: payerPacketRecord.id
  };
}

export function buildClaimSubmissionAuditEvents(input: {
  patientId: string;
  visitId: string;
  claimId: string;
  occurredAt: Date;
  reason: string;
  payerName: string;
  channel: string;
}): Prisma.LedgerEventUncheckedCreateInput[] {
  const { patientId, visitId, claimId, occurredAt, reason, payerName, channel } = input;
  return [
    {
      patientId,
      visitId,
      claimId,
      type: 'CLAIM_SUBMITTED',
      amount: new Decimal('0'),
      occurredAt,
      metadata: {
        channel,
        reason,
        payerName
      }
    },
    {
      patientId,
      visitId,
      claimId,
      type: 'NOTE',
      amount: new Decimal('0'),
      occurredAt,
      metadata: {
        note: channel === 'initial' ? 'Claim created and submitted.' : 'Claim submission updated.',
        reason,
        payerName,
        channel
      }
    }
  ];
}
