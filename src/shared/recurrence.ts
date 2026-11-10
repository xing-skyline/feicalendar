import rrule from 'rrule';
import type { CalendarEvent, DateRange } from './types';
import { inputTime, overlaps } from './dates';

export function expandLocalEvents(events: CalendarEvent[], range: DateRange): CalendarEvent[] {
  return events.flatMap(event => {
    if (event.deleted) return [];
    if (!event.recurrence) return overlaps(event.start, event.end, range) ? [event] : [];
    const start = event.allDay ? `${event.start.replace(/-/g, '')}T000000Z`
      : inputTime(event.start).replace(/[-:]/g, '') + '00Z';
    const duration = new Date(event.end).getTime() - new Date(event.start).getTime();
    // Shanghai has a fixed UTC+08 offset for supported modern dates. Expand wall-clock
    // dates in UTC and convert back explicitly so the host timezone cannot change RRULEs.
    const offset = event.allDay ? 0 : 8 * 3600_000;
    const rule = rrule.rrulestr(`DTSTART:${start}\nRRULE:${event.recurrence}`);
    const occurrences = rule.between(new Date(new Date(range.start).getTime() - duration + offset), new Date(new Date(range.end).getTime() + offset), true, (_, index) => index < 5000);
    return occurrences.flatMap(wallClock => {
      const date = new Date(wallClock.getTime() - offset);
      const occurrenceStart = event.allDay ? date.toISOString().slice(0, 10) : date.toISOString();
      if (event.exceptions?.includes(occurrenceStart)) return [];
      const end = new Date(date.getTime() + duration);
      return [{ ...event, id: `${event.id}::${occurrenceStart}`, seriesId: event.id, occurrenceStart,
        start: occurrenceStart, end: event.allDay ? end.toISOString().slice(0, 10) : end.toISOString(), recurring: true }];
    });
  });
}
