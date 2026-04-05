'use client';

import { useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

type CalendarAppointment = {
  id: string;
  scheduledAt: string;
  status: string;
  patientId: string;
  patient: {
    firstName: string;
    lastName: string;
  };
};

type ParsedCalendarAppointment = Omit<CalendarAppointment, 'scheduledAt'> & { scheduledAt: Date };

type TemporalState = 'past' | 'current' | 'upcoming';

type ScheduleBlock = {
  key: string;
  start: Date;
  end: Date;
  tone: 'open' | 'booked';
  temporalState: TemporalState;
  appointments: ParsedCalendarAppointment[];
};

const SLOT_MINUTES = 30;
const SLOT_MS = SLOT_MINUTES * 60 * 1000;
const START_HOUR = 8;
const END_HOUR = 17;

function startOfDay(date: Date): Date {
  const value = new Date(date);
  value.setHours(0, 0, 0, 0);
  return value;
}

function compareDay(a: Date, b: Date): number {
  const aStart = startOfDay(a).getTime();
  const bStart = startOfDay(b).getTime();
  if (aStart === bStart) {
    return 0;
  }
  return aStart < bStart ? -1 : 1;
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

function parseDateInput(value: string): Date | null {
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

function formatDateInput(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseDateTimeLocal(value: string): Date | null {
  if (!value) {
    return null;
  }
  const [datePart, timePart] = value.split('T');
  if (!datePart || !timePart) {
    return null;
  }
  const [year, month, day] = datePart.split('-').map((part) => Number(part));
  const [hour, minute] = timePart.split(':').map((part) => Number(part));
  if (!year || !month || !day || Number.isNaN(hour) || Number.isNaN(minute)) {
    return null;
  }
  const date = new Date(year, month - 1, day, hour, minute, 0, 0);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDateTimeLocal(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  const hour = `${date.getHours()}`.padStart(2, '0');
  const minute = `${date.getMinutes()}`.padStart(2, '0');
  return `${year}-${month}-${day}T${hour}:${minute}`;
}

function addDays(base: Date, days: number): Date {
  const next = new Date(base);
  next.setDate(next.getDate() + days);
  return next;
}

function buildScheduleBlocks(
  date: Date,
  appointments: ParsedCalendarAppointment[],
  now: Date
): {
  blocks: ScheduleBlock[];
  dayComparison: number;
  dayEnd: Date;
  remainingOpenSlots: number;
  upcomingAppointments: number;
  pastAppointments: number;
  outsideCount: number;
} {
  const dayStart = startOfDay(date);
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);
  const windowStart = new Date(dayStart);
  windowStart.setHours(START_HOUR, 0, 0, 0);
  const windowEnd = new Date(dayStart);
  windowEnd.setHours(END_HOUR, 0, 0, 0);

  const slotCount = ((END_HOUR - START_HOUR) * 60) / SLOT_MINUTES;
  const appointmentSlots = new Map<number, ParsedCalendarAppointment[]>();
  let outsideCount = 0;

  for (const appointment of appointments) {
    if (appointment.scheduledAt.getTime() < windowStart.getTime() || appointment.scheduledAt.getTime() >= windowEnd.getTime()) {
      outsideCount += 1;
      continue;
    }
    const slotIndex = Math.floor((appointment.scheduledAt.getTime() - windowStart.getTime()) / SLOT_MS);
    if (slotIndex < 0 || slotIndex >= slotCount) {
      continue;
    }
    const existing = appointmentSlots.get(slotIndex);
    if (existing) {
      existing.push(appointment);
    } else {
      appointmentSlots.set(slotIndex, [appointment]);
    }
  }

  const dayComparison = compareDay(dayStart, now);
  const blocks: ScheduleBlock[] = [];
  let remainingOpenSlots = 0;

  for (let index = 0; index < slotCount; index += 1) {
    const start = new Date(windowStart.getTime() + index * SLOT_MS);
    const end = new Date(start.getTime() + SLOT_MS);
    const slotAppointments = appointmentSlots.get(index) ?? [];
    const tone: ScheduleBlock['tone'] = slotAppointments.length > 0 ? 'booked' : 'open';

    let temporalState: TemporalState = 'upcoming';
    if (dayComparison < 0) {
      temporalState = 'past';
    } else if (dayComparison === 0) {
      if (end.getTime() <= now.getTime()) {
        temporalState = 'past';
      } else if (start.getTime() <= now.getTime() && end.getTime() > now.getTime()) {
        temporalState = 'current';
      }
    }

    const countOpenSlot = dayComparison === 0 ? temporalState !== 'past' : dayComparison > 0;
    if (tone === 'open' && countOpenSlot) {
      remainingOpenSlots += 1;
    }

    blocks.push({
      key: `slot-${start.getTime()}`,
      start,
      end,
      tone,
      temporalState,
      appointments: [...slotAppointments]
    });
  }

  const upcomingAppointments = appointments.filter((appointment) => appointment.scheduledAt.getTime() > now.getTime()).length;
  const pastAppointments = appointments.length - upcomingAppointments;

  return { blocks, dayComparison, dayEnd, remainingOpenSlots, upcomingAppointments, pastAppointments, outsideCount };
}

export default function DayScheduleCalendar({
  dateValue,
  nowIso,
  appointments,
  selectedSlot
}: {
  dateValue: string;
  nowIso: string;
  appointments: CalendarAppointment[];
  selectedSlot?: string | null;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const resolvedDate = useMemo(() => parseDateInput(dateValue) ?? new Date(), [dateValue]);
  const dateInputValue = useMemo(() => formatDateInput(resolvedDate), [resolvedDate]);
  const parsedAppointments = useMemo<ParsedCalendarAppointment[]>(
    () =>
      appointments.map((appointment) => ({
        ...appointment,
        scheduledAt: new Date(appointment.scheduledAt)
      })),
    [appointments]
  );
  const selectedSlotDate = useMemo(() => (selectedSlot ? parseDateTimeLocal(selectedSlot) : null), [selectedSlot]);
  const now = useMemo(() => new Date(nowIso), [nowIso]);
  const {
    blocks,
    dayComparison,
    dayEnd,
    remainingOpenSlots,
    upcomingAppointments,
    pastAppointments,
    outsideCount
  } = buildScheduleBlocks(resolvedDate, parsedAppointments, now);

  const timeFormatter = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' });
  const formatTime = (value: Date) => timeFormatter.format(value);
  const formatTimeRange = (start: Date, end: Date) => {
    const endLabel = end.getTime() === dayEnd.getTime() ? '12:00 AM (next day)' : formatTime(end);
    return `${formatTime(start)} - ${endLabel}`;
  };

  const openTone = {
    background: 'rgba(16, 185, 129, 0.16)',
    border: '1px solid rgba(16, 185, 129, 0.45)',
    label: 'Available'
  };
  const bookedTone = {
    background: 'rgba(15, 23, 42, 0.12)',
    border: '1px solid rgba(15, 23, 42, 0.2)',
    label: 'Booked'
  };

  const showNow = dayComparison === 0;
  const summary = dayComparison === 0
    ? `${upcomingAppointments} upcoming - ${pastAppointments} earlier - ${remainingOpenSlots} open slots left`
    : `${appointments.length} booked - ${remainingOpenSlots} open slots`;

  const updateDateParam = (nextDate: Date) => {
    const nextParams = new URLSearchParams(searchParams?.toString());
    nextParams.set('date', formatDateInput(nextDate));
    nextParams.delete('slot');
    const nextQuery = nextParams.toString();
    router.replace(`/operations${nextQuery ? `?${nextQuery}` : ''}`);
  };

  const handleSelectSlot = (slotStart: Date) => {
    const nextParams = new URLSearchParams(searchParams?.toString());
    const nextSlot = formatDateTimeLocal(slotStart);
    if (selectedSlotDate && selectedSlotDate.getTime() === slotStart.getTime()) {
      nextParams.delete('slot');
    } else {
      nextParams.set('slot', nextSlot);
    }
    nextParams.set('date', dateInputValue);
    const nextQuery = nextParams.toString();
    router.replace(`/operations${nextQuery ? `?${nextQuery}` : ''}`);
    const scrollToForm = () => {
      const form = document.getElementById('schedule-form');
      form?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
    if (typeof window !== 'undefined') {
      if (typeof window.requestAnimationFrame === 'function') {
        window.requestAnimationFrame(scrollToForm);
      } else {
        window.setTimeout(scrollToForm, 0);
      }
    }
  };

  return (
    <div style={{ display: 'grid', gap: 12, marginTop: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <span className="badge">Calendar view</span>
          {dayComparison === 0 ? (
            <span className="badge" style={{ background: 'rgba(13, 148, 136, 0.2)', color: '#0f172a' }}>
              Today
            </span>
          ) : null}
          {dayComparison < 0 ? (
            <span className="badge" style={{ background: 'rgba(148, 163, 184, 0.2)', color: '#0f172a' }}>
              Past date
            </span>
          ) : null}
        </div>
        <div className="text-muted" style={{ fontSize: 12 }}>
          Slots shown in {SLOT_MINUTES}-minute blocks. Appointment duration is not stored.
        </div>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
        <button
          type="button"
          className="button secondary"
          style={{ padding: '6px 12px', fontSize: 12 }}
          onClick={() => updateDateParam(addDays(resolvedDate, -1))}
        >
          Previous day
        </button>
        <button
          type="button"
          className="button secondary"
          style={{ padding: '6px 12px', fontSize: 12 }}
          onClick={() => updateDateParam(addDays(resolvedDate, 1))}
        >
          Next day
        </button>
        <label style={{ display: 'grid', gap: 4 }}>
          <span className="text-muted" style={{ fontSize: 12 }}>
            Jump to date
          </span>
          <input
            className="input"
            style={{ padding: '6px 10px', fontSize: 12 }}
            type="date"
            value={dateInputValue}
            onChange={(event) => {
              const next = parseDateInput(event.target.value);
              if (next) {
                updateDateParam(next);
              }
            }}
          />
        </label>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <span className="badge" style={{ background: openTone.background, color: '#065f46' }}>
          Available
        </span>
        <span className="badge" style={{ background: bookedTone.background, color: '#0f172a' }}>
          Booked
        </span>
        {outsideCount > 0 ? (
          <span className="badge" style={{ background: 'rgba(148, 163, 184, 0.2)', color: '#0f172a' }}>
            {outsideCount} outside 8am-5pm
          </span>
        ) : null}
        {showNow ? (
          <span className="badge" style={{ background: 'rgba(13, 148, 136, 0.2)', color: '#0f172a' }}>
            Now {formatTime(now)}
          </span>
        ) : null}
        <span className="text-muted" style={{ fontSize: 12 }}>
          {summary}
        </span>
      </div>

      <div style={{ display: 'grid', gap: 10, maxHeight: 420, overflowY: 'auto', paddingRight: 6 }}>
        {blocks.map((block) => {
          const tone = block.tone === 'open' ? openTone : bookedTone;
          const isPast = block.temporalState === 'past';
          const isCurrent = block.temporalState === 'current';
          const isSelected = selectedSlotDate ? selectedSlotDate.getTime() === block.start.getTime() : false;
          const canSelect =
            block.tone === 'open' && (dayComparison > 0 || (dayComparison === 0 && block.temporalState !== 'past'));
          return (
            <div
              key={block.key}
              style={{
                display: 'grid',
                gridTemplateColumns: '120px 1fr',
                gap: 12,
                padding: 12,
                borderRadius: 14,
                background: tone.background,
                border: isSelected ? '2px solid #0f172a' : isCurrent ? '2px solid #0d9488' : tone.border,
                opacity: isPast && showNow ? 0.6 : 1
              }}
            >
              <div style={{ fontSize: 12, fontWeight: 600 }}>{formatTimeRange(block.start, block.end)}</div>
              <div style={{ display: 'grid', gap: 6 }}>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                  <span className="badge" style={{ background: 'rgba(255,255,255,0.6)', color: '#0f172a' }}>
                    {tone.label}
                  </span>
                  {isSelected ? (
                    <span className="badge" style={{ background: 'rgba(15, 23, 42, 0.12)', color: '#0f172a' }}>
                      Selected
                    </span>
                  ) : null}
                  {isCurrent && showNow ? (
                    <span className="badge" style={{ background: 'rgba(13, 148, 136, 0.2)', color: '#0f172a' }}>
                      Now
                    </span>
                  ) : null}
                  {isPast && showNow ? (
                    <span className="badge" style={{ background: 'rgba(148, 163, 184, 0.2)', color: '#0f172a' }}>
                      Past
                    </span>
                  ) : null}
                </div>

                {block.tone === 'open' ? (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                    <div className="text-muted" style={{ fontSize: 12 }}>
                      Open for {formatRelativeMinutes((block.end.getTime() - block.start.getTime()) / 60000)}.
                    </div>
                    <button
                      type="button"
                      className="button secondary"
                      style={{ padding: '6px 12px', fontSize: 12 }}
                      onClick={() => handleSelectSlot(block.start)}
                      disabled={!canSelect}
                      aria-pressed={isSelected}
                    >
                      {isSelected ? 'Selected slot' : canSelect ? 'Select slot' : 'Unavailable'}
                    </button>
                  </div>
                ) : (
                  <div style={{ display: 'grid', gap: 6 }}>
                    {block.appointments.map((appointment) => (
                      <div
                        key={appointment.id}
                        style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}
                      >
                        <div style={{ fontWeight: 600 }}>
                          {appointment.patient.firstName} {appointment.patient.lastName}
                        </div>
                        <div className="text-muted" style={{ fontSize: 12 }}>
                          {formatTime(appointment.scheduledAt)} - {appointment.status}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
