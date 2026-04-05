import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/shared/domain/db';

const schema = z
  .object({
    claimId: z.string().optional(),
    patientId: z.string().optional(),
    likelyIssue: z.string().min(3),
    recommendedAction: z.string().min(3)
  })
  .refine((data) => data.claimId || data.patientId, {
    message: 'Claim or patient is required.'
  });

export async function POST(request: Request) {
  const body = await request.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
  }

  let patientId = parsed.data.patientId;
  let claimId = parsed.data.claimId;

  if (claimId) {
    const claim = await prisma.claim.findUnique({
      where: { id: claimId },
      include: { patient: true }
    });
    if (!claim) {
      return NextResponse.json({ error: 'Claim not found.' }, { status: 404 });
    }
    patientId = claim.patientId;
  } else if (patientId) {
    const patient = await prisma.patient.findUnique({ where: { id: patientId } });
    if (!patient) {
      return NextResponse.json({ error: 'Patient not found.' }, { status: 404 });
    }
  }

  if (!patientId) {
    return NextResponse.json({ error: 'Patient not resolved.' }, { status: 400 });
  }

  const fingerprintBase = claimId ? `manual-${claimId}` : `manual-${patientId}`;
  const flag = await prisma.flag.create({
    data: {
      patientId,
      claimId: claimId ?? undefined,
      source: 'MANUAL',
      status: 'OPEN',
      likelyIssue: parsed.data.likelyIssue,
      confidence: 0.5,
      recommendedAction: parsed.data.recommendedAction,
      fingerprint: `${fingerprintBase}-${Date.now()}`,
      lastDetectedAt: new Date()
    }
  });

  return NextResponse.json({ ok: true, flagId: flag.id });
}

