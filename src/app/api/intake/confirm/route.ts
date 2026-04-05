import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/shared/domain/db';
import { isPolicyActive, selectInsurance } from '@/insurance/insurance';
import { upsertSystemFlags } from '@/review/flags';
import { Claim, LedgerEventType, Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { parseFlexibleDate } from '@/shared/validation/date';
import { type InsuranceSnapshot } from '@/documents/claimPackets';
import { buildPolicySnapshot } from '@/activity/patientActivity';
import { formatDate } from '@/shared/domain/format';
import { syncClaimArtifactsTx } from '@/claims/services/claimWriteService';

const procedureSchema = z.object({
  freeText: z.string(),
  normalizedText: z.string(),
  confidence: z.number(),
  rationale: z.string(),
  candidateCodes: z.array(
    z.object({
      code: z.string(),
      label: z.string(),
      confidence: z.number(),
      rationale: z.string(),
      suggested: z.boolean().optional(),
      category: z.string().optional(),
      notes: z.string().optional(),
      patientDescription: z.string().optional(),
      estimatedCopay: z.number().optional(),
      copayRate: z.number().optional(),
      copayBasis: z.string().optional(),
      matchSource: z.string().optional()
    })
  ),
  selectedCode: z.string(),
  selectedLabel: z.string()
});

const newInsuranceSchema = z.object({
  payerName: z.string().min(2),
  memberId: z.string().min(2),
  groupId: z.string().optional(),
  subscriberName: z.string().optional(),
  employerName: z.string().optional(),
  priority: z.enum(['PRIMARY', 'SECONDARY', 'TERTIARY']).optional(),
  effectiveStart: z.string().min(1),
  effectiveEnd: z.string().optional(),
  lastVerifiedAt: z.string().optional(),
  copayAmount: z.string().optional()
});

const schema = z.object({
  patientId: z.string().optional(),
  newPatient: z
    .object({
      firstName: z.string(),
      lastName: z.string(),
      dob: z.string()
    })
    .optional(),
  dateOfService: z.string(),
  procedures: z.array(procedureSchema),
  insurancePolicyId: z.string().optional(),
  insuranceReason: z.string().optional(),
  selfPayConfirmed: z.boolean().optional(),
  copayCollected: z.boolean().optional(),
  newInsurance: newInsuranceSchema.optional(),
  appointmentId: z.string().optional()
});

export async function POST(request: Request) {
  const body = await request.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request payload.' }, { status: 400 });
  }

  const {
    patientId,
    newPatient,
    dateOfService,
    procedures,
    insurancePolicyId,
    insuranceReason,
    selfPayConfirmed,
    copayCollected,
    newInsurance,
    appointmentId
  } = parsed.data;
  const dosResult = parseFlexibleDate(dateOfService, { allowAmbiguous: true });
  if (!dosResult.date) {
    return NextResponse.json({ error: dosResult.error ?? 'Date of service is invalid.' }, { status: 400 });
  }
  const dosDate = dosResult.date;

  const appointment = appointmentId
    ? await prisma.appointment.findUnique({ where: { id: appointmentId }, include: { patient: true } })
    : null;

  if (appointmentId && !appointment) {
    return NextResponse.json({ error: 'Appointment not found.' }, { status: 404 });
  }

  if (appointment) {
    if (appointment.status === 'CANCELLED') {
      return NextResponse.json({ error: 'Appointment was cancelled. Schedule a new visit.' }, { status: 409 });
    }
    if (appointment.status === 'COMPLETED') {
      return NextResponse.json({ error: 'Appointment already completed.' }, { status: 409 });
    }
  }

  if (appointment && newPatient) {
    return NextResponse.json(
      { error: 'Appointment is tied to an existing patient. Use that patient record.' },
      { status: 400 }
    );
  }

  let patient = appointment ? appointment.patient : null;
  if (!patient) {
    patient = patientId ? await prisma.patient.findUnique({ where: { id: patientId } }) : null;
  }
  if (!patient && newPatient) {
    const dobResult = parseFlexibleDate(newPatient.dob, { allowAmbiguous: true });
    if (!dobResult.date) {
      return NextResponse.json({ error: dobResult.error ?? 'Patient DOB is invalid.' }, { status: 400 });
    }
    patient = await prisma.patient.create({
      data: {
        firstName: newPatient.firstName,
        lastName: newPatient.lastName,
        dob: dobResult.date
      }
    });
  }

  if (appointment && patient && appointment.patientId !== patient.id) {
    return NextResponse.json({ error: 'Appointment does not match selected patient.' }, { status: 400 });
  }

  if (!patient) {
    return NextResponse.json({ error: 'Patient not resolved.' }, { status: 400 });
  }

  let policies = await prisma.insurancePolicy.findMany({ where: { patientId: patient.id } });
  const overrides = await prisma.insuranceOverride.findMany({ where: { patientId: patient.id } });
  const selection = selectInsurance(policies, dosDate, overrides);

  let createdPolicy = null as typeof policies[number] | null;
  if (newInsurance) {
    if (insurancePolicyId) {
      return NextResponse.json({ error: 'Select either an existing policy or add new insurance, not both.' }, { status: 400 });
    }
    const startResult = parseFlexibleDate(newInsurance.effectiveStart, { allowAmbiguous: true });
    if (!startResult.date) {
      return NextResponse.json({ error: startResult.error ?? 'Insurance effective start is invalid.' }, { status: 400 });
    }
    let endDate: Date | undefined;
    if (newInsurance.effectiveEnd) {
      const endResult = parseFlexibleDate(newInsurance.effectiveEnd, { allowAmbiguous: true });
      if (!endResult.date) {
        return NextResponse.json({ error: endResult.error ?? 'Insurance effective end is invalid.' }, { status: 400 });
      }
      endDate = endResult.date;
    }
    if (endDate && endDate.getTime() < startResult.date.getTime()) {
      return NextResponse.json(
        { error: 'Insurance effective end must be after the start date.' },
        { status: 400 }
      );
    }

    let verifiedAt: Date | null = null;
    if (newInsurance.lastVerifiedAt) {
      const verifyResult = parseFlexibleDate(newInsurance.lastVerifiedAt, { allowAmbiguous: true });
      if (!verifyResult.date) {
        return NextResponse.json({ error: verifyResult.error ?? 'Verification date is invalid.' }, { status: 400 });
      }
      verifiedAt = verifyResult.date;
    }

    const dosTimestamp = dosDate.getTime();
    const startTimestamp = startResult.date.getTime();
    const endTimestamp = endDate ? endDate.getTime() : null;
    if (dosTimestamp < startTimestamp || (endTimestamp && dosTimestamp > endTimestamp)) {
      return NextResponse.json(
        { error: 'New insurance is not active for the date of service. Update effective dates or confirm self-pay.' },
        { status: 409 }
      );
    }

    let copayAmount: Decimal | null = null;
    if (newInsurance.copayAmount && newInsurance.copayAmount.trim().length > 0) {
      const parsedCopay = Number(newInsurance.copayAmount);
      if (!Number.isFinite(parsedCopay) || parsedCopay < 0) {
        return NextResponse.json({ error: 'Copay amount must be a valid non-negative number.' }, { status: 400 });
      }
      copayAmount = new Decimal(parsedCopay.toFixed(2));
    }

    createdPolicy = await prisma.insurancePolicy.create({
      data: {
        patientId: patient.id,
        payerName: newInsurance.payerName.trim(),
        memberId: newInsurance.memberId.trim(),
        groupId: newInsurance.groupId?.trim() || undefined,
        subscriberName: newInsurance.subscriberName?.trim() || undefined,
        employerName: newInsurance.employerName?.trim() || undefined,
        priority: newInsurance.priority ?? 'PRIMARY',
        effectiveStart: startResult.date,
        effectiveEnd: endDate,
        lastVerifiedAt: verifiedAt,
        copayAmount
      }
    });
    const employerLabel = createdPolicy.employerName ? ` - Employer ${createdPolicy.employerName}` : '';
    const verifiedLabel = createdPolicy.lastVerifiedAt ? ` - Verified ${formatDate(createdPolicy.lastVerifiedAt)}` : '';

    await prisma.patientActivityEvent.create({
      data: {
        patientId: patient.id,
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
          source: 'intake'
        } as Prisma.InputJsonValue
      }
    });
    policies = [...policies, createdPolicy];
  }

  const explicitPolicy = insurancePolicyId
    ? policies.find((policy) => policy.id === insurancePolicyId) ?? null
    : null;

  if (insurancePolicyId && !explicitPolicy) {
    return NextResponse.json({ error: 'Selected policy not found for this patient.' }, { status: 400 });
  }

  if (explicitPolicy && !isPolicyActive(explicitPolicy, dosDate)) {
    return NextResponse.json(
      { error: 'Selected policy is not active for this date of service.' },
      { status: 409 }
    );
  }

  if (selection.needsConfirmation && !insurancePolicyId && !createdPolicy) {
    if (selection.activePolicies.length === 0 && selfPayConfirmed) {
      // allow self-pay confirmation
    } else {
      return NextResponse.json(
        {
          error: 'Insurance confirmation required.',
          insuranceSelection: selection
        },
        { status: 409 }
      );
    }
  }

  const selectedPolicy = createdPolicy ? createdPolicy : explicitPolicy ?? selection.selectedPolicy;

  const trimmedReason = insuranceReason?.trim();
  const reason =
    trimmedReason && trimmedReason.length > 0
      ? trimmedReason
      : createdPolicy
      ? 'New insurance captured during intake.'
      : selfPayConfirmed
      ? 'Self-pay confirmed by staff.'
      : selection.reason;

  if (
    !selectedPolicy &&
    selection.needsConfirmation &&
    !createdPolicy &&
    !(selection.activePolicies.length === 0 && selfPayConfirmed)
  ) {
    return NextResponse.json({ error: 'Selected policy not found.' }, { status: 400 });
  }

  if (createdPolicy && !isPolicyActive(createdPolicy, dosDate)) {
    return NextResponse.json(
      { error: 'New policy requires re-verification for this date of service. Update last verified date or confirm self-pay.' },
      { status: 409 }
    );
  }

  const feeSchedule = await prisma.feeSchedule.findMany();
  const feeMap = new Map(feeSchedule.map((fee) => [fee.code, fee]));

  const missingCodes = procedures
    .map((procedure) => procedure.selectedCode)
    .filter((code) => !feeMap.has(code));

  if (missingCodes.length > 0) {
    return NextResponse.json(
      {
        error: 'Missing fee schedule entries for selected codes.',
        missingCodes
      },
      { status: 400 }
    );
  }

  const result = await prisma.$transaction(async (tx) => {
    const visit = await tx.visit.create({
      data: {
        patientId: patient.id,
        dateOfService: dosDate,
        plannedProcedures: appointment?.plannedProcedures ?? undefined,
        appointmentId: appointment?.id
      }
    });

    if (appointment) {
      await tx.appointment.update({
        where: { id: appointment.id },
        data: { status: 'COMPLETED' }
      });
    }

    await tx.procedureRecord.createMany({
      data: procedures.map((procedure) => ({
        visitId: visit.id,
        freeText: procedure.freeText,
        normalizedText: procedure.normalizedText,
        confidence: procedure.confidence,
        rationale: procedure.rationale,
        candidateCodes: procedure.candidateCodes,
        selectedCode: procedure.selectedCode,
        selectedLabel: procedure.selectedLabel
      }))
    });

    const claim = await tx.claim.create({
      data: {
        patientId: patient.id,
        visitId: visit.id,
        insurancePolicyId: selectedPolicy?.id,
        insuranceSnapshot: selectedPolicy
          ? {
              payerName: selectedPolicy.payerName,
              memberId: selectedPolicy.memberId,
              groupId: selectedPolicy.groupId,
              subscriberName: selectedPolicy.subscriberName,
              employerName: selectedPolicy.employerName,
              priority: selectedPolicy.priority,
              effectiveStart: selectedPolicy.effectiveStart.toISOString(),
              effectiveEnd: selectedPolicy.effectiveEnd?.toISOString(),
              lastVerifiedAt: selectedPolicy.lastVerifiedAt?.toISOString() ?? null,
              copayAmount: selectedPolicy.copayAmount?.toString() ?? null
            }
          : undefined,
        insuranceReason: reason,
        status: 'SUBMITTED'
      }
    });

    const ledgerEvents = [] as Prisma.LedgerEventUncheckedCreateInput[];

    ledgerEvents.push({
      patientId: patient.id,
      visitId: visit.id,
      claimId: claim.id,
      type: LedgerEventType.PROCEDURE_PERFORMED,
      amount: new Decimal('0'),
      occurredAt: dosDate,
      metadata: { note: 'Procedures performed and confirmed.' } as Prisma.InputJsonValue
    });

    procedures.forEach((procedure, index) => {
      const fee = feeMap.get(procedure.selectedCode)!;
      ledgerEvents.push({
        patientId: patient.id,
        visitId: visit.id,
        claimId: claim.id,
        type: LedgerEventType.CHARGE_CREATED,
        amount: new Decimal(fee.amount.toString()),
        occurredAt: dosDate,
        metadata: { code: fee.code, label: fee.label, lineNumber: index + 1 } as Prisma.InputJsonValue
      });
    });

    if (copayCollected && selectedPolicy?.copayAmount) {
      ledgerEvents.push({
        patientId: patient.id,
        visitId: visit.id,
        claimId: claim.id,
        type: LedgerEventType.PATIENT_PAYMENT,
        amount: new Decimal(selectedPolicy.copayAmount.toString()).mul(-1),
        occurredAt: dosDate,
        metadata: { note: 'Copay collected at visit.', source: 'copay' } as Prisma.InputJsonValue
      });
    }

    ledgerEvents.push({
      patientId: patient.id,
      visitId: visit.id,
      claimId: claim.id,
      type: LedgerEventType.CLAIM_SUBMITTED,
      amount: new Decimal('0'),
      occurredAt: new Date(),
      metadata: { channel: 'initial' } as Prisma.InputJsonValue
    });

    await tx.ledgerEvent.createMany({ data: ledgerEvents });

    const fullLedger = await tx.ledgerEvent.findMany({
      where: { claimId: claim.id },
      orderBy: [{ occurredAt: 'asc' }, { createdAt: 'asc' }]
    });
    const snapshot = (claim.insuranceSnapshot as InsuranceSnapshot | null) ?? null;

    await syncClaimArtifactsTx({
      tx,
      claim: claim as Claim,
      patient,
      visit,
      ledger: fullLedger,
      insuranceSnapshot: snapshot,
      submission: {
        insurancePolicyId: selectedPolicy?.id ?? null,
        reason
      }
    });

    await upsertSystemFlags(claim.id, tx);

    return {
      claimId: claim.id,
      patientId: patient.id
    };
  });

  return NextResponse.json(result);
}

