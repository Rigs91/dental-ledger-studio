import { NextResponse } from 'next/server';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '@/shared/domain/db';
import { parseFlexibleDate } from '@/shared/validation/date';
import { buildPolicySnapshot } from '@/activity/patientActivity';
import { formatDate } from '@/shared/domain/format';
import { upsertSystemFlags } from '@/review/flags';

const schema = z.object({
  policyId: z.string().min(1),
  verifiedAt: z.string().optional(),
  note: z.string().optional()
});

function toDateOnly(value: Date): Date {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
}

export async function POST(request: Request) {
  const body = await request.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
  }

  const { policyId, verifiedAt, note } = parsed.data;
  const policy = await prisma.insurancePolicy.findUnique({ where: { id: policyId } });
  if (!policy) {
    return NextResponse.json({ error: 'Policy not found.' }, { status: 404 });
  }

  let verificationDate = toDateOnly(new Date());
  if (verifiedAt && verifiedAt.trim().length > 0) {
    const parsedDate = parseFlexibleDate(verifiedAt, { allowAmbiguous: true });
    if (!parsedDate.date) {
      return NextResponse.json(
        { error: parsedDate.error ?? 'Verification date is invalid.' },
        { status: 400 }
      );
    }
    verificationDate = toDateOnly(parsedDate.date);
  }

  if (verificationDate.getTime() < new Date(policy.effectiveStart).getTime()) {
    return NextResponse.json(
      { error: 'Verification date cannot be before policy effective start.' },
      { status: 400 }
    );
  }

  const trimmedNote = note?.trim();
  const { updatedPolicy, affectedClaimIds } = await prisma.$transaction(async (tx) => {
    const updated = await tx.insurancePolicy.update({
      where: { id: policy.id },
      data: { lastVerifiedAt: verificationDate }
    });

    await tx.patientActivityEvent.create({
      data: {
        patientId: updated.patientId,
        category: 'INSURANCE',
        type: 'INSURANCE_POLICY_UPDATED',
        title: 'Insurance policy re-verified',
        detail: `${updated.payerName} (${updated.priority}) re-verified on ${formatDate(verificationDate)}${
          trimmedNote ? ` - ${trimmedNote}` : ''
        }`,
        occurredAt: new Date(),
        insurancePolicyId: updated.id,
        metadata: {
          action: 'REVERIFIED',
          verifiedAt: verificationDate.toISOString(),
          note: trimmedNote ?? null,
          previousSnapshot: buildPolicySnapshot(policy),
          policySnapshot: buildPolicySnapshot(updated)
        } as Prisma.InputJsonValue
      }
    });

    const claims = await tx.claim.findMany({
      where: {
        patientId: updated.patientId,
        visit: {
          dateOfService: {
            gte: updated.effectiveStart,
            ...(updated.effectiveEnd ? { lte: updated.effectiveEnd } : {})
          }
        }
      },
      select: { id: true }
    });

    return { updatedPolicy: updated, affectedClaimIds: claims.map((claim) => claim.id) };
  });

  await Promise.all(affectedClaimIds.map((claimId) => upsertSystemFlags(claimId)));

  return NextResponse.json({
    ok: true,
    policyId: updatedPolicy.id,
    patientId: updatedPolicy.patientId,
    verifiedAt: updatedPolicy.lastVerifiedAt?.toISOString() ?? null,
    affectedClaims: affectedClaimIds.length
  });
}
