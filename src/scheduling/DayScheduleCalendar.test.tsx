// @vitest-environment happy-dom

import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import DayScheduleCalendar from './DayScheduleCalendar';

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

const makeLocalDate = (year: number, monthIndex: number, day: number, hour = 0, minute = 0) =>
  new Date(year, monthIndex, day, hour, minute, 0, 0);
const toIso = (date: Date) => date.toISOString();

const buildAppointment = (overrides: Partial<CalendarAppointment> = {}): CalendarAppointment => ({
  id: overrides.id ?? 'appt-1',
  scheduledAt: overrides.scheduledAt ?? toIso(makeLocalDate(2026, 1, 4, 9, 0)),
  status: overrides.status ?? 'SCHEDULED',
  patientId: overrides.patientId ?? 'patient-1',
  patient: overrides.patient ?? { firstName: 'Alex', lastName: 'Ng' }
});

const replaceSpy = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: replaceSpy }),
  useSearchParams: () => new URLSearchParams('date=2026-02-04')
}));

describe('DayScheduleCalendar', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(makeLocalDate(2026, 1, 4, 10, 0));
    replaceSpy.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders booked blocks and same-day indicators', () => {
    const appointments = [
      buildAppointment(),
      buildAppointment({
        id: 'appt-2',
        scheduledAt: toIso(makeLocalDate(2026, 1, 4, 14, 0)),
        patient: { firstName: 'Jordan', lastName: 'Lee' }
      })
    ];

    render(
      <DayScheduleCalendar
        dateValue="2026-02-04"
        nowIso="2026-02-04T10:00:00.000Z"
        appointments={appointments}
        selectedSlot={null}
      />
    );

    expect(screen.getByText('Calendar view')).toBeInTheDocument();
    expect(screen.getByText('Today')).toBeInTheDocument();
    expect(screen.getAllByText('Booked').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Available').length).toBeGreaterThan(0);
    expect(screen.getByText('Alex Ng')).toBeInTheDocument();
    expect(screen.getByText('Jordan Lee')).toBeInTheDocument();
    expect(screen.getAllByText(/Now/).length).toBeGreaterThan(0);
  });

  it('summarizes availability for future dates', () => {
    const appointments = [buildAppointment({ scheduledAt: toIso(makeLocalDate(2026, 1, 6, 11, 0)) })];

    render(
      <DayScheduleCalendar
        dateValue="2026-02-06"
        nowIso="2026-02-04T10:00:00.000Z"
        appointments={appointments}
        selectedSlot={null}
      />
    );

    expect(screen.getByText(/1 booked - .* open slots/)).toBeInTheDocument();
    expect(screen.queryByText('Today')).toBeNull();
  });

  it('selects an open slot', () => {
    const appointments = [buildAppointment({ scheduledAt: toIso(makeLocalDate(2026, 1, 4, 9, 0)) })];

    render(
      <DayScheduleCalendar
        dateValue="2026-02-04"
        nowIso="2026-02-04T10:00:00.000Z"
        appointments={appointments}
        selectedSlot={null}
      />
    );

    const selectButtons = screen.getAllByRole('button', { name: /select slot/i });
    fireEvent.click(selectButtons[0]);

    expect(replaceSpy).toHaveBeenCalled();
    const calledWith = replaceSpy.mock.calls[0]?.[0] as string;
    expect(calledWith).toContain('slot=');
  });

  it('changes date via navigation controls', () => {
    render(
      <DayScheduleCalendar
        dateValue="2026-02-04"
        nowIso="2026-02-04T10:00:00.000Z"
        appointments={[]}
        selectedSlot={null}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Next day' }));

    expect(replaceSpy).toHaveBeenCalled();
    const calledWith = replaceSpy.mock.calls[0]?.[0] as string;
    expect(calledWith).toContain('date=2026-02-05');
    expect(calledWith).not.toContain('slot=');
  });
});
