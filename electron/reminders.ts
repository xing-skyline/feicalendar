import type { AppSnapshot, ReminderEntry } from "../src/shared/types";
import { expandCalendarEvents } from "../src/shared/occurrences";

export function scanReminders(
  state: AppSnapshot,
  now = Date.now(),
): ReminderEntry[] {
  const after = Math.max(
    new Date(
      state.reminderCheckedAt || new Date(now - 30_000).toISOString(),
    ).getTime(),
    now - 86400_000,
  );
  const entries = (state.reminderEntries ||= []);
  const notifications: ReminderEntry[] = [];
  const muted = new Set(state.settings.mutedReminderCalendars);
  const occurrences = expandCalendarEvents(state, {
    start: new Date(now - 2 * 86400_000).toISOString(),
    end: new Date(now + 15 * 86400_000).toISOString(),
  });
  const byId = new Map(occurrences.map((event) => [event.id, event]));
  for (const entry of entries) {
    if (entry.state === "dismissed") continue;
    const event = byId.get(entry.eventId);
    if (
      !event ||
      event.completed ||
      muted.has(event.calendarId) ||
      event.start !== entry.eventStart
    ) {
      entry.state = "dismissed";
      continue;
    }
    if (
      entry.state === "snoozed" &&
      state.settings.reminders &&
      new Date(entry.snoozedUntil!).getTime() <= now
    ) {
      entry.state = "unread";
      entry.snoozedUntil = undefined;
      notifications.push(entry);
    }
  }
  if (state.settings.reminders) {
    const known = new Set(entries.map((entry) => entry.id));
    for (const event of occurrences) {
      if (event.completed || muted.has(event.calendarId)) continue;
      const rule =
        state.reminderRules?.[event.id] ??
        state.reminderRules?.[event.seriesId || ""];
      const minutes = rule ?? (event.reminder >= 0 ? [event.reminder] : []);
      const at = new Date(
        event.allDay
          ? `${event.start}T${state.settings.allDayReminderTime}:00+08:00`
          : event.start,
      ).getTime();
      for (const advance of minutes) {
        const due = at - advance * 60_000;
        const id = `${event.id}|${due}`;
        if (due < after || due > now || known.has(id)) continue;
        const entry: ReminderEntry = {
          id,
          eventId: event.id,
          title: event.title,
          location: event.location,
          dueAt: new Date(due).toISOString(),
          eventStart: event.start,
          state: "unread",
        };
        entries.push(entry);
        known.add(id);
        notifications.push(entry);
      }
    }
  }
  state.reminderEntries = entries
    .filter((entry) => new Date(entry.dueAt).getTime() >= now - 30 * 86400_000)
    .slice(-1000);
  state.reminderCheckedAt = new Date(now).toISOString();
  return state.settings.reminders ? notifications : [];
}
