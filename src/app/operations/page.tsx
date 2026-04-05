import Link from 'next/link';
import { prisma } from '@/shared/domain/db';
import { formatDate, formatDateTime } from '@/shared/domain/format';
import { needsReverification, selectInsurance } from '@/insurance/insurance';
import { mapProcedureIntent, splitProcedures } from '@/intake/rules/procedure';
import { enrichNormalizedWithCatalog } from '@/intake/rules/procedureCatalog';
import DayScheduleCalendar from '@/scheduling/DayScheduleCalendar';
import ScheduleForm from './ScheduleForm';
import FollowUpFlagButton from './FollowUpFlagButton';
import CheckInButton from './CheckInButton';
import { PageHeader } from '@/components/ui/PageHeader';
import { PillBadge } from '@/components/ui/PillBadge';
import { SectionStack } from '@/components/ui/SectionStack';
import ReverifyInsuranceButton from '@/components/ReverifyInsuranceButton';

function toDateInput(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseDateInput(value?: string): Date | null {
  if (!value) {
    return null;
  }
  const [year, month, day] = value.split('-').map((part) => Number(part));
  if (!year || !month || !day) {
    return null;
  }
  const date = new Date(year, month - 1, day);
  return Number.isNaN(date.getTime()) ? null : date;
}

function getPlannedItems(planned: unknown): string[] {
  if (!planned || typeof planned !== 'object') {
    return [];
  }
  const record = planned as { rawText?: string; items?: string[] };
  if (record.items && Array.isArray(record.items)) {
    return record.items;
  }
  if (record.rawText) {
    return splitProcedures(record.rawText);
  }
  return [];
}

function isSameDay(left: Date, right: Date): boolean {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

function formatRelativeMinutes(totalMinutes: number): string {
  const minutes = Math.max(0, Math.round(totalMinutes));
  if (minutes < 60) {
    return `${minutes} min`;
  }
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (remainder === 0) {
    return `${hours} hr`;
  }
  return `${hours} hr ${remainder} min`;
}

function getSameDayTiming(scheduledAt: Date, status: string, now: Date, sameDay: boolean): string | null {
  if (!sameDay) {
    return null;
  }
  if (status === 'COMPLETED' || status === 'CANCELLED') {
    return null;
  }
  const deltaMinutes = Math.round((scheduledAt.getTime() - now.getTime()) / 60000);
  const relative = formatRelativeMinutes(Math.abs(deltaMinutes));
  if (deltaMinutes >= 0) {
    const prefix = status === 'CHECKED_IN' ? 'Scheduled in' : 'Starts in';
    return `${prefix} ${relative}`;
  }
  const prefix = status === 'CHECKED_IN' ? 'Scheduled' : 'Started';
  return `${prefix} ${relative} ago`;
}

export default async function OperationsPage({
  searchParams
}: {
  searchParams?: Promise<{ date?: string; slot?: string }>;
}) {
  const resolved = searchParams ? await searchParams : undefined;
  const dateParam = resolved?.date;
  const slotParam = resolved?.slot;
  const selectedDate = parseDateInput(dateParam) ?? new Date();
  const dayStart = new Date(selectedDate);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);
  const now = new Date();
  const sameDaySelected = isSameDay(dayStart, now);

  const appointments = await prisma.appointment.findMany({
    where: { scheduledAt: { gte: dayStart, lt: dayEnd } },
    select: {
      id: true,
      patientId: true,
      scheduledAt: true,
      plannedProcedures: true,
      status: true,
      patient: {
        select: {
          firstName: true,
          lastName: true,
          dob: true,
          insurances: true,
          insuranceOverrides: true,
          flags: { where: { status: 'OPEN' }, select: { id: true } }
        }
      },
      visit: { select: { claims: { select: { id: true } } } }
    },
    orderBy: { scheduledAt: 'asc' }
  });

  const procedureCatalog = await prisma.procedureCatalog.findMany({
    select: {
      code: true,
      category: true,
      description: true,
      notes: true,
      patientDescription: true
    }
  });

  const patients = await prisma.patient.findMany({
    select: { id: true, firstName: true, lastName: true },
    orderBy: { lastName: 'asc' }
  });

  const dateValue = toDateInput(dayStart);
  const calendarAppointments = appointments.map((appointment) => ({
    id: appointment.id,
    scheduledAt: appointment.scheduledAt.toISOString(),
    status: appointment.status,
    patientId: appointment.patientId,
    patient: {
      firstName: appointment.patient.firstName,
      lastName: appointment.patient.lastName
    }
  }));
  const checkedInAppointments = appointments.filter((appointment) => appointment.status === 'CHECKED_IN');

  return (
    <SectionStack>
      <PageHeader
        title="Daily Operations"
        subtitle="Front desk readiness, scheduled visits, and insurance risk indicators."
        actions={
          <form method="get" action="/operations" className="action-bar">
            <input className="input" type="date" name="date" defaultValue={dateValue} />
            <button className="button secondary" type="submit">
              Go
            </button>
          </form>
        }
      />

      <div className="grid-cards">
        <div className="card">
          <PillBadge tone="success">Checked-in patients</PillBadge>
          <div style={{ display: 'grid', gap: 12, marginTop: 12, maxHeight: 'min(420px, 70vh)', overflowY: 'auto', paddingRight: 4 }}>
            {checkedInAppointments.length === 0 ? (
              <div className="text-muted">No patients are checked in right now.</div>
            ) : (
              checkedInAppointments.map((appointment) => {
                const claim = appointment.visit?.claims?.[0];
                const sameDayTiming = getSameDayTiming(appointment.scheduledAt, appointment.status, now, sameDaySelected);
                return (
                  <div key={appointment.id} className="card" style={{ padding: 14 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                      <div>
                        <div style={{ fontWeight: 600 }}>
                          {appointment.patient.firstName} {appointment.patient.lastName}
                        </div>
                        <div className="text-muted" style={{ fontSize: 13 }}>
                          {formatDateTime(appointment.scheduledAt)} - Status {appointment.status}
                          {sameDayTiming ? ` - ${sameDayTiming}` : ''}
                        </div>
                      </div>
                      <div className="badge">Checked in</div>
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
                      <Link className="button secondary" href={`/patients/${appointment.patientId}`}>
                        Patient profile
                      </Link>
                      <Link className="button" href={`/intake?appointmentId=${appointment.id}`}>
                        Check out
                      </Link>
                      {appointment.patient.flags.length > 0 ? (
                        <Link className="button secondary" href={`/review?patientId=${appointment.patientId}`}>
                          Open flags
                        </Link>
                      ) : null}
                      {claim ? (
                        <Link className="button secondary" href={`/billing/${claim.id}`}>
                          View billing
                        </Link>
                      ) : null}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        <div className="card">
          <PillBadge tone="info">Schedule for {formatDate(dayStart)}</PillBadge>
          <div style={{ display: 'grid', gap: 18, marginTop: 12 }}>
            <div className="panel accent">
              <div className="panel-header">
                <div className="panel-title">30-minute slots</div>
                <div className="text-muted panel-subtitle">
                  Tap an open slot to schedule or adjust the day.
                </div>
              </div>
              <DayScheduleCalendar
                dateValue={dateValue}
                nowIso={now.toISOString()}
                appointments={calendarAppointments}
                selectedSlot={slotParam ?? null}
              />
            </div>
          </div>
        </div>

        <div className="card">
          <PillBadge tone="neutral">Booked appointments</PillBadge>
          <div className="text-muted" style={{ fontSize: 12, marginTop: 6 }}>
            Check in patients and launch intake from this list.
          </div>
          <div style={{ display: 'grid', gap: 12, marginTop: 12, maxHeight: 'min(640px, 75vh)', overflowY: 'auto', paddingRight: 4 }}>
            {appointments.length === 0 ? (
              <div className="text-muted">No appointments scheduled for this day.</div>
            ) : (
              appointments.map((appointment) => {
                const plannedItems = getPlannedItems(appointment.plannedProcedures);
                const patientAge = Math.floor(
                  (appointment.scheduledAt.getTime() - appointment.patient.dob.getTime()) /
                    (365.25 * 24 * 60 * 60 * 1000)
                );
                const sameDayTiming = getSameDayTiming(appointment.scheduledAt, appointment.status, now, sameDaySelected);
                const ambiguous = plannedItems.some((item) => {
                  const normalized = enrichNormalizedWithCatalog(
                    mapProcedureIntent(item, patientAge),
                    procedureCatalog,
                    patientAge
                  );
                  return normalized.needsConfirmation || normalized.confidence < 0.7;
                });

                const selection = selectInsurance(
                  appointment.patient.insurances,
                  appointment.scheduledAt,
                  appointment.patient.insuranceOverrides
                );
                const activePrimaryCount = selection.activePolicies.filter((policy) => policy.priority === 'PRIMARY')
                  .length;

                const indicators: { label: string; tone: 'warn' | 'risk' | 'info' }[] = [];
                if (appointment.patient.insurances.length === 0) {
                  indicators.push({ label: 'Missing insurance on file', tone: 'risk' });
                } else if (selection.activePolicies.length === 0) {
                  indicators.push({ label: 'No active policy for DOS', tone: 'risk' });
                }
                if (activePrimaryCount > 1 && selection.needsConfirmation) {
                  indicators.push({ label: 'Multiple active primaries', tone: 'risk' });
                }
                const needsReverificationWarning = selection.warnings.some((warning) =>
                  warning.toLowerCase().includes('re-verification')
                );
                const reverificationPolicies = appointment.patient.insurances.filter((policy) =>
                  needsReverification(policy, appointment.scheduledAt)
                );
                const policyChangedNearDos = selection.warnings.some((warning) =>
                  warning.toLowerCase().includes('changed within 14 days')
                );
                if (needsReverificationWarning) {
                  indicators.push({ label: 'Insurance re-verification required', tone: 'warn' });
                }
                if (policyChangedNearDos) {
                  indicators.push({ label: 'Policy changed near DOS', tone: 'warn' });
                }
                if (appointment.patient.flags.length > 0) {
                  indicators.push({ label: 'Open review flags', tone: 'warn' });
                }
                if (ambiguous) {
                  indicators.push({ label: 'Planned procedure ambiguous', tone: 'warn' });
                }

                const claim = appointment.visit?.claims?.[0];

                return (
                  <div key={appointment.id} className="card" style={{ padding: 14 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                      <div>
                        <div style={{ fontWeight: 600 }}>{appointment.patient.firstName} {appointment.patient.lastName}</div>
                        <div className="text-muted" style={{ fontSize: 13 }}>
                          {formatDateTime(appointment.scheduledAt)} - Status {appointment.status}
                          {sameDayTiming ? ` - ${sameDayTiming}` : ''}
                        </div>
                      </div>
                      <div className="badge">{appointment.status}</div>
                    </div>

                    <div style={{ marginTop: 12, display: 'grid', gap: 10 }}>
                      <div>
                        <div className="text-muted" style={{ fontSize: 12 }}>
                          Planned procedures
                        </div>
                        {plannedItems.length === 0 ? (
                          <div className="text-muted">No planned procedures recorded.</div>
                        ) : (
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 6 }}>
                            {plannedItems.map((item) => (
                              <span key={item} className="badge">
                                {item}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>

                      <div>
                        <div className="text-muted" style={{ fontSize: 12 }}>
                          Insurance on file
                        </div>
                        {appointment.patient.insurances.length === 0 ? (
                          <div className="text-muted">No policies on file.</div>
                        ) : (
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 6 }}>
                            {appointment.patient.insurances.map((policy) => (
                              <span key={policy.id} className="badge">
                                {policy.payerName} ({policy.priority})
                                {policy.employerName ? ` - ${policy.employerName}` : ''}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>

                      <div>
                        <div className="text-muted" style={{ fontSize: 12 }}>
                          Readiness indicators
                        </div>
                        {indicators.length === 0 ? (
                          <div className="text-muted">No risks detected.</div>
                        ) : (
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 6 }}>
                            {indicators.map((indicator) => (
                              <span
                                key={indicator.label}
                                className="badge"
                                style={{
                                  background:
                                    indicator.tone === 'risk'
                                      ? 'rgba(248, 113, 113, 0.2)'
                                      : indicator.tone === 'warn'
                                      ? 'rgba(245, 158, 11, 0.2)'
                                      : 'rgba(59, 130, 246, 0.2)'
                                }}
                              >
                                {indicator.label}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>

                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                        <Link className="button secondary" href={`/patients/${appointment.patientId}`}>
                          Patient profile
                        </Link>
                        <Link className="button secondary" href={`/patients/${appointment.patientId}/insurance/new`}>
                          Update insurance
                        </Link>
                        {reverificationPolicies.map((policy) => (
                          <ReverifyInsuranceButton
                            key={`${appointment.id}-${policy.id}`}
                            policyId={policy.id}
                            payerName={policy.payerName}
                            compact
                          />
                        ))}
                        {appointment.patient.flags.length > 0 ? (
                          <Link className="button secondary" href={`/review?patientId=${appointment.patientId}`}>
                            Open flags
                          </Link>
                        ) : null}
                        {appointment.status === 'CHECKED_IN' ? (
                          <Link className="button" href={`/intake?appointmentId=${appointment.id}`}>
                            Check out
                          </Link>
                        ) : appointment.status === 'SCHEDULED' ? (
                          <CheckInButton appointmentId={appointment.id} />
                        ) : claim ? (
                          <Link className="button" href={`/billing/${claim.id}`}>
                            View billing
                          </Link>
                        ) : (
                          <Link className="button" href={`/intake?appointmentId=${appointment.id}`}>
                            Start intake
                          </Link>
                        )}
                        <FollowUpFlagButton
                          patientId={appointment.patientId}
                          context={`appointment on ${formatDateTime(appointment.scheduledAt)}`}
                        />
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        <div id="schedule-form">
          <ScheduleForm
            key={slotParam ?? 'no-slot'}
            patients={patients.map((patient) => ({
              id: patient.id,
              name: `${patient.firstName} ${patient.lastName}`
            }))}
            defaultDate={slotParam ?? ''}
          />
        </div>
      </div>
    </SectionStack>
  );
}

