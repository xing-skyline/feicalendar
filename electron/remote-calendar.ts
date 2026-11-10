import { createHash } from "node:crypto";
import type {
  CalendarEvent,
  CalendarSource,
  DateRange,
} from "../src/shared/types";
import { fingerprint } from "./feishu";

export interface RemoteCalendarClient {
  calendars(): Promise<CalendarSource[]>;
  events(calendar: CalendarSource, range: DateRange): Promise<CalendarEvent[]>;
  get(calendar: CalendarSource, remoteId: string): Promise<CalendarEvent>;
  create(
    calendar: CalendarSource,
    event: CalendarEvent,
    key: string,
  ): Promise<CalendarEvent>;
  update(
    calendar: CalendarSource,
    event: CalendarEvent,
    remote: CalendarEvent,
  ): Promise<CalendarEvent>;
  delete(
    calendar: CalendarSource,
    remoteId: string,
    remote?: CalendarEvent,
  ): Promise<void>;
  deleteCreated?(
    calendar: CalendarSource,
    remote: CalendarEvent,
  ): Promise<void>;
}

export function contentFingerprint(
  event: CalendarEvent,
  provider: string,
): string {
  if (provider === "feishu") return fingerprint(event);
  return createHash("sha256")
    .update(
      JSON.stringify([
        fingerprint(event),
        event.reminder,
        event.recurrence,
        event.exceptions || [],
        provider === "webdav" && event.completed,
        Boolean(event.deleted),
      ]),
    )
    .digest("hex");
}

export function deletedEvent(
  calendar: CalendarSource,
  remoteId: string,
): CalendarEvent {
  return {
    id: `${calendar.id}/${remoteId}`,
    calendarId: calendar.id,
    remoteId,
    title: "已删除的日程",
    start: "2000-01-01",
    end: "2000-01-02",
    allDay: true,
    description: "",
    location: "",
    reminder: -1,
    recurrence: "",
    completed: false,
    syncState: "synced",
    deleted: true,
  };
}
