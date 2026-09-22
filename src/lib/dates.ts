// Search Console reports dates in Pacific Time.
export const GSC_TIMEZONE = "America/Los_Angeles";
export const WINDOW_DAYS = 90;
// Final data usually lands about two days after the fact.
export const GSC_LAG_DAYS = 2;

export interface DateWindow {
  startDate: string;
  endDate: string;
}

export function isoDateInTimeZone(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function windowEndingOn(endDate: string, days = WINDOW_DAYS): DateWindow {
  return { startDate: addDays(endDate, -(days - 1)), endDate };
}

export function syncWindow(now = new Date(), days = WINDOW_DAYS): DateWindow {
  const today = isoDateInTimeZone(now, GSC_TIMEZONE);
  return windowEndingOn(addDays(today, -GSC_LAG_DAYS), days);
}

export function priorWindow(window: DateWindow, days = WINDOW_DAYS): DateWindow {
  return windowEndingOn(addDays(window.startDate, -1), days);
}
