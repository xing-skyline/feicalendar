import type { AppSnapshot, DateRange } from "./types";
import { expandLocalEvents } from "./recurrence";
import { specialEvents } from "./almanac";

export function expandCalendarEvents(state: AppSnapshot, range: DateRange) {
  return [
    ...expandLocalEvents(state.events, range),
    ...specialEvents(state, range),
  ];
}
