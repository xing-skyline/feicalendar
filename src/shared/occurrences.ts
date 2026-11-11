import type {
  AppSnapshot,
  CalendarEvent,
  CalendarSource,
  DateRange,
} from "./types";
import { expandLocalEvents } from "./recurrence";
import { specialEvents } from "./almanac";

export function expandCalendarEvents(state: AppSnapshot, range: DateRange) {
  return [
    ...expandLocalEvents(state.events, range),
    ...specialEvents(state, range),
  ];
}

function sameEvents(a: CalendarEvent[], b: CalendarEvent[]) {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const left = a[i];
    const right = b[i];
    if (
      left.id !== right.id ||
      left.calendarId !== right.calendarId ||
      left.title !== right.title ||
      left.start !== right.start ||
      left.end !== right.end ||
      left.allDay !== right.allDay ||
      left.completed !== right.completed ||
      left.deleted !== right.deleted ||
      left.syncState !== right.syncState ||
      left.recurrence !== right.recurrence ||
      left.recurring !== right.recurring ||
      left.reminder !== right.reminder ||
      left.location !== right.location ||
      left.description !== right.description ||
      left.remoteId !== right.remoteId ||
      left.remoteEtag !== right.remoteEtag ||
      left.remoteFingerprint !== right.remoteFingerprint ||
      left.error !== right.error ||
      left.courseId !== right.courseId ||
      left.courseWeek !== right.courseWeek ||
      left.taskId !== right.taskId ||
      (left.exceptions?.length || 0) !== (right.exceptions?.length || 0) ||
      (left.exceptions &&
        right.exceptions &&
        left.exceptions.some((ex, idx) => ex !== right.exceptions![idx]))
    )
      return false;
  }
  return true;
}

function sameCalendars(a: CalendarSource[], b: CalendarSource[]) {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const left = a[i];
    const right = b[i];
    if (
      left.id !== right.id ||
      left.name !== right.name ||
      left.color !== right.color ||
      left.visible !== right.visible ||
      left.writable !== right.writable ||
      left.provider !== right.provider ||
      left.connectionId !== right.connectionId
    )
      return false;
  }
  return true;
}

function sameJson(a: unknown, b: unknown) {
  return a === b || JSON.stringify(a) === JSON.stringify(b);
}

export function reconcileSnapshot(
  prev: AppSnapshot | null | undefined,
  next: AppSnapshot,
): AppSnapshot {
  if (!prev) return next;
  const eventsEqual = sameEvents(prev.events, next.events);
  const calendarsEqual = sameCalendars(prev.calendars, next.calendars);
  const settingsEqual = sameJson(prev.settings, next.settings);
  const specialDatesEqual = sameJson(prev.specialDates, next.specialDates);
  const holidayOverridesEqual = sameJson(
    prev.holidayOverrides,
    next.holidayOverrides,
  );
  const holidayDataEqual = sameJson(prev.holidayData, next.holidayData);
  const connectionsEqual = sameJson(prev.connections, next.connections);
  const queueEqual = sameJson(prev.queue, next.queue);
  const tasksEqual = sameJson(prev.tasks, next.tasks);
  const templatesEqual = sameJson(prev.templates, next.templates);
  const reminderRulesEqual = sameJson(prev.reminderRules, next.reminderRules);
  const reminderEntriesEqual = sameJson(
    prev.reminderEntries,
    next.reminderEntries,
  );
  const semestersEqual = sameJson(prev.semesters, next.semesters);
  const coursesEqual = sameJson(prev.courses, next.courses);
  const calendarSetsEqual = sameJson(prev.calendarSets, next.calendarSets);
  const historyEqual =
    (prev.history?.length || 0) === (next.history?.length || 0) &&
    sameJson(prev.history, next.history);
  const trashEqual =
    (prev.trash?.length || 0) === (next.trash?.length || 0) &&
    sameJson(prev.trash, next.trash);

  if (
    eventsEqual &&
    calendarsEqual &&
    settingsEqual &&
    specialDatesEqual &&
    holidayOverridesEqual &&
    holidayDataEqual &&
    connectionsEqual &&
    queueEqual &&
    tasksEqual &&
    templatesEqual &&
    reminderRulesEqual &&
    reminderEntriesEqual &&
    semestersEqual &&
    coursesEqual &&
    calendarSetsEqual &&
    historyEqual &&
    trashEqual &&
    prev.lastSync === next.lastSync &&
    prev.syncError === next.syncError
  ) {
    return prev;
  }

  return {
    ...next,
    events: eventsEqual ? prev.events : next.events,
    calendars: calendarsEqual ? prev.calendars : next.calendars,
    settings: settingsEqual ? prev.settings : next.settings,
    specialDates: specialDatesEqual ? prev.specialDates : next.specialDates,
    holidayOverrides: holidayOverridesEqual
      ? prev.holidayOverrides
      : next.holidayOverrides,
    holidayData: holidayDataEqual ? prev.holidayData : next.holidayData,
  };
}
