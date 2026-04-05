import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/shared/domain/db';
import { parseFlexibleDate } from '@/shared/validation/date';

const schema = z.object({
  firstName: z.string().min(1),
  middleName: z.string().optional().nullable(),
  lastName: z.string().min(1),
  dob: z.string().min(1),
  phone: z.string().optional().nullable(),
  email: z.string().optional().nullable(),
  addressLine1: z.string().optional().nullable(),
  addressLine2: z.string().optional().nullable(),
  city: z.string().optional().nullable(),
  state: z.string().optional().nullable(),
  postalCode: z.string().optional().nullable(),
  ssn: z.string().optional().nullable()
});

const normalize = (value?: string | null) => {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : null;
};

export async function POST(request: Request) {
  const body = await request.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
  }

  const {
    firstName,
    middleName,
    lastName,
    dob,
    phone,
    email,
    addressLine1,
    addressLine2,
    city,
    state,
    postalCode,
    ssn
  } = parsed.data;

  const dobResult = parseFlexibleDate(dob, { allowAmbiguous: true });
  if (!dobResult.date) {
    return NextResponse.json({ error: dobResult.error ?? 'Date of birth is invalid.' }, { status: 400 });
  }

  const normalizedSsnRaw = normalize(ssn);
  const normalizedSsn = normalizedSsnRaw ? normalizedSsnRaw.replace(/\D/g, '') : null;
  if (normalizedSsn && ![4, 9].includes(normalizedSsn.length)) {
    return NextResponse.json({ error: 'SSN must include 4 or 9 digits.' }, { status: 400 });
  }

  const normalizedEmail = normalize(email);
  if (normalizedEmail && !z.string().email().safeParse(normalizedEmail).success) {
    return NextResponse.json({ error: 'Email address is invalid.' }, { status: 400 });
  }

  const patient = await prisma.patient.create({
    data: {
      firstName: firstName.trim(),
      middleName: normalize(middleName),
      lastName: lastName.trim(),
      dob: dobResult.date,
      phone: normalize(phone),
      email: normalizedEmail,
      addressLine1: normalize(addressLine1),
      addressLine2: normalize(addressLine2),
      city: normalize(city),
      state: normalize(state),
      postalCode: normalize(postalCode),
      ssn: normalizedSsn
    }
  });

  return NextResponse.json({ patientId: patient.id });
}
