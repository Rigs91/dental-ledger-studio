import Link from 'next/link';
import IntakeClient from './IntakeClient';
import { SectionHeader } from '@/components/StatCard';
import { prisma } from '@/shared/domain/db';
import { formatDate, formatDateTime } from '@/shared/domain/format';

export default async function IntakePage({
  searchParams
}: {
  searchParams?: Promise<{ appointmentId?: string }>;
}) {
  const resolvedParams = searchParams ? await searchParams : undefined;
  const appointmentId = resolvedParams?.appointmentId;
  let initialData;
  let appointmentWarning: string | null = null;

  const checkedInAppointments = await prisma.appointment.findMany({
    where: { status: 'CHECKED_IN' },
    include: { patient: true },
    orderBy: { scheduledAt: 'asc' }
  });

  if (appointmentId) {
    const appointment = await prisma.appointment.findUnique({
      where: { id: appointmentId },
      include: { patient: true }
    });

    if (!appointment) {
      appointmentWarning = 'Appointment not found. Start intake manually or reschedule.';
    } else {
      const planned = appointment.plannedProcedures as { rawText?: string; items?: string[] } | null;
      const proceduresText = planned?.rawText ?? planned?.items?.join(', ') ?? '';
      initialData = {
        appointmentId: appointment.id,
        patientId: appointment.patientId,
        patientName: `${appointment.patient.firstName} ${appointment.patient.lastName}`,
        dob: formatDate(appointment.patient.dob),
        dateOfService: formatDate(appointment.scheduledAt),
        proceduresText,
        appointmentNote: `Scheduled ${formatDateTime(appointment.scheduledAt)} - Status ${appointment.status}`
      };
    }
  }

  return (
    <div style={{ display: 'grid', gap: 24 }}>
      <SectionHeader
        title="Conversational Intake"
        subtitle="Capture intent, confirm ambiguous inputs, and generate a deterministic claim packet."
      />
      {checkedInAppointments.length > 0 ? (
        <div className="card">
          <div className="badge">Checked-in patients</div>
          <div style={{ display: 'grid', gap: 12, marginTop: 12 }}>
            {checkedInAppointments.map((appointment) => (
              <Link
                key={appointment.id}
                className="card"
                style={{ padding: 12 }}
                href={`/intake?appointmentId=${appointment.id}`}
              >
                <div style={{ fontWeight: 600 }}>
                  {appointment.patient.firstName} {appointment.patient.lastName}
                </div>
                <div className="text-muted" style={{ fontSize: 13 }}>
                  Scheduled {formatDateTime(appointment.scheduledAt)} - Status {appointment.status}
                </div>
              </Link>
            ))}
          </div>
        </div>
      ) : null}
      {appointmentWarning ? <div className="card">{appointmentWarning}</div> : null}
      <IntakeClient initialData={initialData} />
    </div>
  );
}

