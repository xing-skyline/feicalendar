import type { AppSnapshot, CalendarEvent, DateRange } from "./types";
import { expandCalendarEvents } from "./occurrences";
import { shiftDate } from "./dates";
import { isWorkday } from "./almanac";

export function busyInterval(event: CalendarEvent, before = 0, after = 0) {
  return {
    start:
      new Date(
        event.allDay ? `${event.start}T00:00:00+08:00` : event.start,
      ).getTime() -
      before * 60_000,
    end:
      new Date(
        event.allDay ? `${event.end}T00:00:00+08:00` : event.end,
      ).getTime() +
      after * 60_000,
  };
}

export function eventConflicts(state: AppSnapshot, event: CalendarEvent) {
  const interval = busyInterval(
    event,
    state.settings.bufferBeforeMinutes,
    state.settings.bufferAfterMinutes,
  );
  if (!Number.isFinite(interval.start) || !Number.isFinite(interval.end))
    return [];
  return expandCalendarEvents(state, {
    start: new Date(interval.start - 86400_000).toISOString(),
    end: new Date(interval.end + 86400_000).toISOString(),
  }).filter((other) => {
    if (
      other.id === event.id ||
      other.completed ||
      other.calendarId === "special-dates" ||
      !state.calendars.some(
        (calendar) => calendar.id === other.calendarId && calendar.visible,
      )
    )
      return false;
    const busy = busyInterval(other);
    return interval.start < busy.end && interval.end > busy.start;
  });
}

export function freeSlots(
  state: AppSnapshot,
  options: {
    from: string;
    to: string;
    startTime: string;
    endTime: string;
    minutes: number;
    calendarIds: string[];
    workdaysOnly: boolean;
  },
): DateRange[] {
  if (
    !options.from ||
    !options.to ||
    !options.startTime ||
    !options.endTime ||
    options.from > options.to ||
    options.startTime >= options.endTime ||
    options.minutes < 1 ||
    new Date(options.to).getTime() - new Date(options.from).getTime() >
      60 * 86400_000
  )
    return [];
  const busy = expandCalendarEvents(state, {
    start: shiftDate(options.from, -1),
    end: shiftDate(options.to, 2),
  })
    .filter(
      (event) =>
        options.calendarIds.includes(event.calendarId) &&
        !event.completed &&
        event.calendarId !== "special-dates",
    )
    .map((event) =>
      busyInterval(
        event,
        state.settings.bufferBeforeMinutes,
        state.settings.bufferAfterMinutes,
      ),
    )
    .sort((a, b) => a.start - b.start);
  const result: DateRange[] = [];
  for (let day = options.from; day <= options.to; day = shiftDate(day, 1)) {
    if (options.workdaysOnly && !isWorkday(day, state)) continue;
    let cursor = new Date(`${day}T${options.startTime}:00+08:00`).getTime();
    const end = new Date(`${day}T${options.endTime}:00+08:00`).getTime();
    for (const interval of busy) {
      if (interval.end <= cursor || interval.start >= end) continue;
      if (interval.start - cursor >= options.minutes * 60_000)
        result.push({
          start: new Date(cursor).toISOString(),
          end: new Date(Math.min(end, interval.start)).toISOString(),
        });
      cursor = Math.max(cursor, interval.end);
      if (cursor >= end) break;
    }
    if (end - cursor >= options.minutes * 60_000)
      result.push({
        start: new Date(cursor).toISOString(),
        end: new Date(end).toISOString(),
      });
  }
  return result;
}
