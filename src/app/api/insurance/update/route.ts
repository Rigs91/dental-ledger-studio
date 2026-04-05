import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/shared/domain/db';
import { parseFlexibleDate } from '@/shared/validation/date';
import { flagInsurancePolicyChange } from '@/review/flags';
import { Decimal } from '@prisma/client/runtime/library';
import { Prisma } from '@prisma/client';
import { buildPolicyChangeSummary, buildPolicySnapshot } from '@/activity/patientActivity';
import { formatDate } from '@/shared/domain/format';

const schema = z.object({
  policyId: z.string().min(1),
  payerName: z.string().min(2),
  memberId: z.string().min(2),
  groupId: z.string().optional().nullable(),
  subscriberName: z.string().optional().nullable(),
  employerName: z.string().optional().nullable(),
  priority: z.enum(['PRIMARY', 'SECONDARY', 'TERTIARY']),
  effectiveStart: z.string().min(1),
  effectiveEnd: z.string().optional().nullable(),
  lastVerifiedAt: z.string().optional().nullable(),
  copayAmount: z.string().optional().nullable()
});

export async function POST(request: Request) {
  const body = await request.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
  }

  const {
    policyId,
    payerName,
    memberId,
    groupId,
    subscriberName,
    employerName,
    priority,
    effectiveStart,
    effectiveEnd,
    lastVerifiedAt,
    copayAmount
  } = parsed.data;

  const policy = await prisma.insurancePolicy.findUnique({ where: { id: policyId } });
  if (!policy) {
    return NextResponse.json({ error: 'Policy not found.' }, { status: 404 });
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

  let verifiedAt: Date | null = null;
  if (lastVerifiedAt) {
    const verifyResult = parseFlexibleDate(lastVerifiedAt);
    if (!verifyResult.date) {
      return NextResponse.json({ error: verifyResult.error ?? 'Verification date is invalid.' }, { status: 400 });
    }
    verifiedAt = verifyResult.date;
  }

  let copayDecimal: Decimal | null = null;
  if (copayAmount && copayAmount.trim().length > 0) {
    const normalizedCopay = copayAmount.replace(/[$,]/g, '').trim();
    const parsedCopay = Number(normalizedCopay);
    if (Number.isNaN(parsedCopay) || parsedCopay < 0) {
      return NextResponse.json({ error: 'Copay amount must be a positive number.' }, { status: 400 });
    }
    copayDecimal = new Decimal(parsedCopay.toFixed(2));
  }

  const updated = await prisma.$transaction(async (tx) => {
    const updatedPolicy = await tx.insurancePolicy.update({
      where: { id: policyId },
      data: {
        payerName,
        memberId,
        groupId: groupId || null,
        subscriberName: subscriberName || null,
        employerName: employerName || null,
        priority,
        effectiveStart: startDate,
        effectiveEnd: endDate,
        lastVerifiedAt: verifiedAt,
        copayAmount: copayDecimal
      }
    });

    await flagInsurancePolicyChange(
      {
        patientId: updatedPolicy.patientId,
        policyId: updatedPolicy.id,
        effectiveStart: startDate,
        effectiveEnd: endDate
      },
      tx
    );

    const { changes, detail, endedCoverage } = buildPolicyChangeSummary(policy, updatedPolicy);
    const hasNonEndChanges = changes.some((change) => change.field !== 'Effective end');

    if (endedCoverage && updatedPolicy.effectiveEnd) {
      await tx.patientActivityEvent.create({
        data: {
          patientId: updatedPolicy.patientId,
          category: 'INSURANCE',
          type: 'INSURANCE_POLICY_ENDED',
          title: 'Insurance policy ended',
          detail: `Coverage ends ${formatDate(updatedPolicy.effectiveEnd)}.`,
          occurredAt: new Date(),
          insurancePolicyId: updatedPolicy.id,
          metadata: {
            policySnapshot: buildPolicySnapshot(updatedPolicy),
            previousSnapshot: buildPolicySnapshot(policy),
            changes
          } as Prisma.InputJsonValue
        }
      });
    }

    if (changes.length > 0 && (!endedCoverage || hasNonEndChanges)) {
      await tx.patientActivityEvent.create({
        data: {
          patientId: updatedPolicy.patientId,
          category: 'INSURANCE',
          type: 'INSURANCE_POLICY_UPDATED',
          title: 'Insurance policy updated',
          detail,
          occurredAt: new Date(),
          insurancePolicyId: updatedPolicy.id,
          metadata: {
            policySnapshot: buildPolicySnapshot(updatedPolicy),
            previousSnapshot: buildPolicySnapshot(policy),
            changes
          } as Prisma.InputJsonValue
        }
      });
    }

    return updatedPolicy;
  });

  return NextResponse.json({ policyId: updated.id });
}

