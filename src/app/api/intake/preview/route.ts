import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/shared/domain/db';
import { splitProcedures } from '@/intake/rules/procedure';
import { enrichNormalizedWithCatalog } from '@/intake/rules/procedureCatalog';
import { getLLMProvider } from '@/claims/llm';
import { selectInsurance } from '@/insurance/insurance';
import { parseFlexibleDate } from '@/shared/validation/date';
import type { Prisma } from '@prisma/client';

const schema = z.object({
  patientId: z.string().optional(),
  patientName: z.string().min(1),
  dob: z.string().min(1),
  dateOfService: z.string().min(1),
  proceduresText: z.string().min(1)
});

function splitName(value: string) {
  const parts = value.trim().split(/\s+/);
  if (parts.length === 1) {
    return { firstName: parts[0], lastName: '' };
  }
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') };
}

export async function POST(request: Request) {
  const body = await request.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
  }

  const { patientId, patientName, dob, dateOfService, proceduresText } = parsed.data;
  const dobResult = parseFlexibleDate(dob, { allowAmbiguous: true });
  const dosResult = parseFlexibleDate(dateOfService, { allowAmbiguous: true });

  if (!dobResult.date || !dosResult.date) {
    return NextResponse.json(
      {
        error: dobResult.error || dosResult.error || 'DOB or date of service is invalid.'
      },
      { status: 400 }
    );
  }

  const dobDate = dobResult.date;
  const dosDate = dosResult.date;
  const nameParts = splitName(patientName);
  const start = new Date(Date.UTC(dobDate.getUTCFullYear(), dobDate.getUTCMonth(), dobDate.getUTCDate()));
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);

  type PatientWithCoverage = Prisma.PatientGetPayload<{
    include: {
      insurances: true;
      insuranceOverrides: true;
    };
  }>;
  let matches: PatientWithCoverage[] = [];
  let patient: PatientWithCoverage | null = null;

  if (patientId) {
    const matched = await prisma.patient.findUnique({
      where: { id: patientId },
      include: { insurances: true, insuranceOverrides: true }
    });
    if (!matched) {
      return NextResponse.json({ error: 'Patient not found.' }, { status: 404 });
    }
    matches = [matched];
    patient = matched;
  } else {
    matches = await prisma.patient.findMany({
      where: {
        firstName: nameParts.firstName ? { contains: nameParts.firstName } : undefined,
        lastName: nameParts.lastName ? { contains: nameParts.lastName } : undefined,
        dob: { gte: start, lt: end }
      },
      include: { insurances: true, insuranceOverrides: true }
    });
    patient = matches.length === 1 ? matches[0] : null;
  }

  let patientMatchStatus: 'found' | 'ambiguous' | 'not_found' = 'not_found';
  if (matches.length === 1) {
    patientMatchStatus = 'found';
  } else if (matches.length > 1) {
    patientMatchStatus = 'ambiguous';
  }

  const ageDob = patient ? new Date(patient.dob) : dobDate;
  const patientAge = Math.floor(
    (dosDate.getTime() - ageDob.getTime()) / (365.25 * 24 * 60 * 60 * 1000)
  );

  const procedureCatalog = await prisma.procedureCatalog.findMany({
    select: {
      code: true,
      category: true,
      description: true,
      notes: true,
      patientDescription: true,
      estimatedCopayAvg: true,
      copayRate: true,
      copayBasis: true
    }
  });
  const provider = getLLMProvider();
  const procedureLines = splitProcedures(proceduresText);
  const normalized = await Promise.all(
    procedureLines.map(async (line) => {
      const base = await provider.normalizeProcedureIntent({ text: line, patientAge });
      return enrichNormalizedWithCatalog(base, procedureCatalog, patientAge);
    })
  );

  const insuranceSelection = patient
    ? selectInsurance(patient.insurances, dosDate, patient.insuranceOverrides)
    : {
        activePolicies: [],
        selectedPolicy: null,
        needsConfirmation: true,
        reason: 'Patient not resolved.',
        warnings: []
      };

  return NextResponse.json({
    patientMatchStatus,
    patientOptions: matches.map((entry) => ({
      id: entry.id,
      name: `${entry.firstName} ${entry.lastName}`,
      dob: entry.dob,
      policies: entry.insurances
    })),
    procedures: normalized,
    insuranceSelection
  });
}

