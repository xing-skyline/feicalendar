export const TIME_ZONE = "Asia/Shanghai";

export function hourTime(hour: number): string {
  return `${String(hour).padStart(2, "0")}:00`;
}

export function teachingWeek(
  date: string,
  firstWeekDate: string,
  totalWeeks: number,
  weekStartsOn: number,
): number | null {
  if (!firstWeekDate) return null;
  const current = new Date(`${date.slice(0, 10)}T00:00:00Z`);
  const first = new Date(`${firstWeekDate}T00:00:00Z`);
  const currentOffset = (current.getUTCDay() - weekStartsOn + 7) % 7;
  const firstOffset = (first.getUTCDay() - weekStartsOn + 7) % 7;
  const dayDistance = (current.getTime() - first.getTime()) / 86400_000;
  const week = Math.floor((dayDistance - currentOffset + firstOffset) / 7) + 1;
  return week >= 1 && week <= totalWeeks ? week : null;
}

const dateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const timeFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

const dateKeyCache = new Map<string, string>();
const inputTimeCache = new Map<string, string>();

export function clearDateCaches() {
  dateKeyCache.clear();
  inputTimeCache.clear();
}

export function dateKey(input: Date | string): string {
  if (typeof input === "string") {
    const cached = dateKeyCache.get(input);
    if (cached !== undefined) return cached;
  }
  const date = input instanceof Date ? input : new Date(input);
  if (!Number.isFinite(date.getTime())) return "";
  const parts = dateFormatter.formatToParts(date);
  let year = "";
  let month = "";
  let day = "";
  for (const item of parts) {
    if (item.type === "year") year = item.value;
    else if (item.type === "month") month = item.value;
    else if (item.type === "day") day = item.value;
  }
  const result = `${year}-${month}-${day}`;
  if (typeof input === "string") {
    if (dateKeyCache.size > 2048) dateKeyCache.clear();
    dateKeyCache.set(input, result);
  }
  return result;
}

export function inputTime(input: string): string {
  const cached = inputTimeCache.get(input);
  if (cached !== undefined) return cached;
  const date = new Date(input);
  if (!Number.isFinite(date.getTime())) return "";
  const result =
    input.length === 10
      ? `${input}T09:00`
      : `${dateKey(date)}T${timeFormatter.format(date)}`;
  if (inputTimeCache.size > 2048) inputTimeCache.clear();
  inputTimeCache.set(input, result);
  return result;
}

export function shiftDate(value: string, days: number): string {
  const date = new Date(`${value.slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(date.getTime())) return "";
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function overlaps(
  start: string,
  end: string,
  range: { start: string; end: string },
): boolean {
  return (
    Date.parse(start) < Date.parse(range.end) &&
    Date.parse(end) > Date.parse(range.start)
  );
}
