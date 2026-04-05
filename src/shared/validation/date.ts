export type DateParseResult = {
  date: Date | null;
  error?: string;
};

function buildUtcDate(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day));
}

function normalizeInput(input: string): string {
  return input
    .trim()
    .replace(/(\d)(st|nd|rd|th)/gi, '$1')
    .replace(/,/g, ' ')
    .replace(/\s+/g, ' ');
}

export function formatDateInput(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function parseFlexibleDate(
  input: string,
  options?: { allowAmbiguous?: boolean }
): DateParseResult {
  const normalized = normalizeInput(input);
  if (!normalized) {
    return { date: null, error: 'Date is required.' };
  }

  const yearFirst = normalized.match(/^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})$/);
  if (yearFirst) {
    const year = Number(yearFirst[1]);
    const month = Number(yearFirst[2]);
    const day = Number(yearFirst[3]);
    if (month < 1 || month > 12 || day < 1 || day > 31) {
      return { date: null, error: 'Invalid date values.' };
    }
    return { date: buildUtcDate(year, month, day) };
  }

  const monthFirst = normalized.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})$/);
  if (monthFirst) {
    const month = Number(monthFirst[1]);
    const day = Number(monthFirst[2]);
    const yearRaw = monthFirst[3];
    const year = Number(yearRaw.length === 2 ? `20${yearRaw}` : yearRaw);
    if (month < 1 || month > 12 || day < 1 || day > 31) {
      return { date: null, error: 'Invalid date values.' };
    }
    if (month <= 12 && day <= 12 && !options?.allowAmbiguous) {
      return {
        date: null,
        error: 'Ambiguous date format. Use YYYY-MM-DD or spell out the month.'
      };
    }
    return { date: buildUtcDate(year, month, day) };
  }

  const parsed = Date.parse(normalized);
  if (!Number.isNaN(parsed)) {
    const parsedDate = new Date(parsed);
    return {
      date: buildUtcDate(
        parsedDate.getUTCFullYear(),
        parsedDate.getUTCMonth() + 1,
        parsedDate.getUTCDate()
      )
    };
  }

  return { date: null, error: 'Unrecognized date format. Use YYYY-MM-DD or Month DD, YYYY.' };
}
