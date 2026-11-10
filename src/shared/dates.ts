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

export function dateKey(input: Date | string): string {
  const date = new Date(input);
  if (!Number.isFinite(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const part = (type: string) =>
    parts.find((item) => item.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function inputTime(input: string): string {
  if (!Number.isFinite(new Date(input).getTime())) return "";
  if (input.length === 10) return `${input}T09:00`;
  const time = new Intl.DateTimeFormat("en-GB", {
    timeZone: TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(input));
  return `${dateKey(input)}T${time}`;
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
    new Date(start).getTime() < new Date(range.end).getTime() &&
    new Date(end).getTime() > new Date(range.start).getTime()
  );
}
