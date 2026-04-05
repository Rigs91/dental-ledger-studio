import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/shared/domain/db';
import { parseFlexibleDate } from '@/shared/validation/date';
import { flagInsurancePolicyChange } from '@/review/flags';
import { Decimal } from '@prisma/client/runtime/library';
import { Prisma } from '@prisma/client';
import { buildPolicySnapshot } from '@/activity/patientActivity';
import { formatDate } from '@/shared/domain/format';

const schema = z.object({
  patientId: z.string().min(1),
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
    patientId,
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

  const patient = await prisma.patient.findUnique({ where: { id: patientId } });
  if (!patient) {
    return NextResponse.json({ error: 'Patient not found.' }, { status: 404 });
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

  const policy = await prisma.$transaction(async (tx) => {
    const createdPolicy = await tx.insurancePolicy.create({
      data: {
        patientId,
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
        patientId,
        policyId: createdPolicy.id,
        effectiveStart: startDate,
        effectiveEnd: endDate
      },
      tx
    );

    const employerLabel = createdPolicy.employerName ? ` - Employer ${createdPolicy.employerName}` : '';
    const verifiedLabel = createdPolicy.lastVerifiedAt
      ? ` - Verified ${formatDate(createdPolicy.lastVerifiedAt)}`
      : '';

    await tx.patientActivityEvent.create({
      data: {
        patientId,
        category: 'INSURANCE',
        type: 'INSURANCE_POLICY_ADDED',
        title: 'Insurance policy added',
        detail: `${createdPolicy.payerName} (${createdPolicy.priority}) - Member ${createdPolicy.memberId}${employerLabel} - Effective ${formatDate(
          createdPolicy.effectiveStart
        )}${createdPolicy.effectiveEnd ? ` - ${formatDate(createdPolicy.effectiveEnd)}` : ''}${verifiedLabel}`,
        occurredAt: new Date(),
        insurancePolicyId: createdPolicy.id,
        metadata: {
          policySnapshot: buildPolicySnapshot(createdPolicy),
          source: 'manual'
        } as Prisma.InputJsonValue
      }
    });

    return createdPolicy;
  });

  return NextResponse.json({ policyId: policy.id });
}

