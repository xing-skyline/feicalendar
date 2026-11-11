import rrule from "rrule";
import type { CalendarEvent, DateRange } from "./types";
import { inputTime } from "./dates";

const rruleCache = new Map<string, ReturnType<typeof rrule.rrulestr>>();

export function clearRecurrenceCache() {
  rruleCache.clear();
}

export function expandLocalEvents(
  events: CalendarEvent[],
  range: DateRange,
): CalendarEvent[] {
  const rangeStartMs = Date.parse(range.start);
  const rangeEndMs = Date.parse(range.end);
  const results: CalendarEvent[] = [];
  for (const event of events) {
    if (event.deleted) continue;
    if (!event.recurrence) {
      if (
        Date.parse(event.start) < rangeEndMs &&
        Date.parse(event.end) > rangeStartMs
      ) {
        results.push(event);
      }
      continue;
    }
    const start = event.allDay
      ? `${event.start.replace(/-/g, "")}T000000Z`
      : inputTime(event.start).replace(/[-:]/g, "") + "00Z";
    const duration = Date.parse(event.end) - Date.parse(event.start);
    // Shanghai has a fixed UTC+08 offset for supported modern dates. Expand wall-clock
    // dates in UTC and convert back explicitly so the host timezone cannot change RRULEs.
    const offset = event.allDay ? 0 : 8 * 3600_000;
    const ruleKey = `${start}\n${event.recurrence}`;
    let rule = rruleCache.get(ruleKey);
    if (!rule) {
      rule = rrule.rrulestr(`DTSTART:${start}\nRRULE:${event.recurrence}`, {
        cache: false,
      });
      if (rruleCache.size > 256) rruleCache.clear();
      rruleCache.set(ruleKey, rule);
    }
    const occurrences = rule.between(
      new Date(rangeStartMs - duration + offset),
      new Date(rangeEndMs + offset),
      true,
      (_, index) => index < 5000,
    );
    const exceptionSet =
      event.exceptions && event.exceptions.length > 2
        ? new Set(event.exceptions)
        : undefined;
    for (const wallClock of occurrences) {
      const date = new Date(wallClock.getTime() - offset);
      const occurrenceStart = event.allDay
        ? date.toISOString().slice(0, 10)
        : date.toISOString();
      if (
        exceptionSet
          ? exceptionSet.has(occurrenceStart)
          : event.exceptions?.includes(occurrenceStart)
      )
        continue;
      const end = new Date(date.getTime() + duration);
      results.push({
        ...event,
        id: `${event.id}::${occurrenceStart}`,
        seriesId: event.id,
        occurrenceStart,
        start: occurrenceStart,
        end: event.allDay ? end.toISOString().slice(0, 10) : end.toISOString(),
        recurring: true,
      });
    }
  }
  return results;
}
