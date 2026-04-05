import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/shared/domain/db';
import { splitProcedures } from '@/intake/rules/procedure';

const schema = z.object({
  patientId: z.string().min(1),
  scheduledAt: z.string().min(1),
  plannedProcedures: z.string().min(1)
});

export async function POST(request: Request) {
  const body = await request.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
  }

  const { patientId, scheduledAt, plannedProcedures } = parsed.data;
  if (!scheduledAt.includes('T')) {
    return NextResponse.json({ error: 'Include a time for the appointment.' }, { status: 400 });
  }

  const scheduledDate = new Date(scheduledAt);
  if (Number.isNaN(scheduledDate.getTime())) {
    return NextResponse.json({ error: 'Scheduled time is invalid.' }, { status: 400 });
  }

  const patient = await prisma.patient.findUnique({ where: { id: patientId } });
  if (!patient) {
    return NextResponse.json({ error: 'Patient not found.' }, { status: 404 });
  }

  const items = splitProcedures(plannedProcedures);
  if (items.length === 0) {
    return NextResponse.json({ error: 'Provide at least one planned procedure.' }, { status: 400 });
  }

  const appointment = await prisma.appointment.create({
    data: {
      patientId,
      scheduledAt: scheduledDate,
      plannedProcedures: {
        rawText: plannedProcedures,
        items
      }
    }
  });

  return NextResponse.json({ appointmentId: appointment.id });
}

