import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/shared/domain/db';

const schema = z.object({
  appointmentId: z.string().min(1)
});

export async function POST(request: Request) {
  const body = await request.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
  }

  const appointment = await prisma.appointment.findUnique({
    where: { id: parsed.data.appointmentId }
  });
  if (!appointment) {
    return NextResponse.json({ error: 'Appointment not found.' }, { status: 404 });
  }

  if (appointment.status === 'CANCELLED') {
    return NextResponse.json({ error: 'Appointment was cancelled.' }, { status: 409 });
  }

  if (appointment.status === 'COMPLETED') {
    return NextResponse.json({ error: 'Appointment already completed.' }, { status: 409 });
  }

  if (appointment.status !== 'CHECKED_IN') {
    await prisma.appointment.update({
      where: { id: appointment.id },
      data: { status: 'CHECKED_IN' }
    });
  }

  return NextResponse.json({ ok: true });
}

