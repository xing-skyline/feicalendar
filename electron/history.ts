import type {
  AppSnapshot,
  CalendarEvent,
  EventHistory,
  CalendarTask,
  HistoryMetadata,
} from "../src/shared/types";
import { randomUUID } from "node:crypto";

import { eventContent } from "../src/shared/event-content";
export { eventContent } from "../src/shared/event-content";

export function taskContent(task?: CalendarTask): string {
  if (!task) return "";
  const { updatedAt, ...content } = task;
  return JSON.stringify(content);
}

export function historyMetadata(state: AppSnapshot): HistoryMetadata {
  return structuredClone({
    reminderRules: state.reminderRules,
    semesters: state.semesters,
    courses: state.courses,
    settings: state.settings,
    templates: state.templates,
    specialDates: state.specialDates,
    calendarSets: state.calendarSets,
    holidayOverrides: state.holidayOverrides,
  });
}

export function matchesMetadata(state: AppSnapshot, expected: HistoryMetadata) {
  const current = historyMetadata(state);
  return (Object.keys(expected) as (keyof HistoryMetadata)[]).every(
    (key) =>
      JSON.stringify(current[key] ?? null) ===
      JSON.stringify(expected[key] ?? null),
  );
}

export function recordChange(
  state: AppSnapshot,
  before: CalendarEvent[],
  label: string,
  deleted?: CalendarEvent,
  tasksBefore: CalendarTask[] = state.tasks || [],
  metadataBefore: HistoryMetadata = historyMetadata(state),
): void {
  const previous = new Map(before.map((event) => [event.id, event]));
  const current = new Map(state.events.map((event) => [event.id, event]));
  const ids = new Set([...previous.keys(), ...current.keys()]);
  const changed = [...ids].filter(
    (id) => eventContent(previous.get(id)) !== eventContent(current.get(id)),
  );
  const taskIds = new Set(
    [...tasksBefore, ...(state.tasks || [])].map((task) => task.id),
  );
  const changedTasks = [...taskIds].filter(
    (id) =>
      taskContent(tasksBefore.find((task) => task.id === id)) !==
      taskContent(state.tasks?.find((task) => task.id === id)),
  );
  const metadataAfter = historyMetadata(state);
  const changedKeys = (
    Object.keys(metadataBefore) as (keyof HistoryMetadata)[]
  ).filter(
    (key) =>
      JSON.stringify(metadataBefore[key]) !==
      JSON.stringify(metadataAfter[key]),
  );
  const metadataChanged = changedKeys.length > 0;
  if (!changed.length && !changedTasks.length && !metadataChanged) return;
  const history: EventHistory = {
    id: randomUUID(),
    label,
    at: new Date().toISOString(),
    before: before.filter((event) => changed.includes(event.id)),
    after: structuredClone(
      state.events.filter((event) => changed.includes(event.id)),
    ),
    tasksBefore: tasksBefore.filter((task) => changedTasks.includes(task.id)),
    tasksAfter: structuredClone(
      (state.tasks || []).filter((task) => changedTasks.includes(task.id)),
    ),
    metadataBefore: metadataChanged
      ? (Object.fromEntries(
          changedKeys.map((key) => [key, metadataBefore[key] ?? null]),
        ) as HistoryMetadata)
      : undefined,
    metadataAfter: metadataChanged
      ? (Object.fromEntries(
          changedKeys.map((key) => [key, metadataAfter[key] ?? null]),
        ) as HistoryMetadata)
      : undefined,
  };
  state.history = [...(state.history || []), history].slice(-100);
  const deletions = deleted
    ? [deleted]
    : before.filter(
        (event) => !event.deleted && !eventContent(current.get(event.id)),
      );
  for (const event of deletions)
    state.trash = [
      ...(state.trash || []),
      {
        id: randomUUID(),
        historyId: history.id,
        deletedAt: history.at,
        event: structuredClone(event),
      },
    ];
  state.trash = (state.trash || []).filter(
    (item) => Date.now() - new Date(item.deletedAt).getTime() < 30 * 86400_000,
  );
}
