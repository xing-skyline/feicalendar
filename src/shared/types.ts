export type Provider = "local" | "feishu" | "caldav" | "webdav" | "ics";
export type SyncState = "local" | "synced" | "pending" | "error" | "conflict";
export const CALENDAR_VIEWS = [
  "timeGridDay",
  "timeGridThreeDay",
  "timeGridWeek",
  "dayGridMonth",
  "multiMonthYear",
  "listMonth",
] as const;
export type CalendarView = (typeof CALENDAR_VIEWS)[number];

export interface CalendarSource {
  id: string;
  name: string;
  color: string;
  provider: Provider;
  visible: boolean;
  writable: boolean;
  remoteId?: string;
  connectionId?: string;
}

export interface CalendarEvent {
  id: string;
  calendarId: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  description: string;
  location: string;
  reminder: number;
  recurrence: string;
  completed: boolean;
  syncState: SyncState;
  remoteId?: string;
  remoteFingerprint?: string;
  remoteEtag?: string;
  recurring?: boolean;
  seriesId?: string;
  occurrenceStart?: string;
  exceptions?: string[];
  url?: string;
  deleted?: boolean;
  error?: string;
}

export interface Connection {
  id: string;
  kind: "caldav" | "webdav" | "ics";
  name: string;
  url: string;
  username: string;
  password?: string;
  hasPassword?: boolean;
  lastSync?: string;
  error?: string;
  enabled?: boolean;
  readOnly?: boolean;
  syncTeaching?: boolean;
  teachingBase?: TeachingSettings;
  teachingConflict?: TeachingSettings;
}

export interface TeachingSettings {
  teachingStartDate: string;
  teachingWeeks: number;
  weekStartsOn: 0 | 1 | 6;
}

export interface PendingChange {
  id: string;
  eventId: string;
  action: "create" | "update" | "delete";
  baseFingerprint?: string;
  status: "pending" | "error" | "conflict";
  error?: string;
  remote?: CalendarEvent;
  creation?: CalendarEvent;
}

export interface Settings {
  defaultCalendarId: string;
  autoSync: boolean;
  syncMinutes: number;
  feishuEnabled: boolean;
  reminders: boolean;
  weekends: boolean;
  theme: "light" | "dark" | "system";
  calendarView: CalendarView;
  closeToTray: boolean;
  weekStartsOn: 0 | 1 | 6;
  hour12: boolean;
  dayStartHour: number;
  dayEndHour: number;
  defaultDurationMinutes: number;
  defaultReminder: number;
  teachingStartDate: string;
  teachingWeeks: number;
}

export interface AppSnapshot {
  version: 1;
  calendars: CalendarSource[];
  events: CalendarEvent[];
  connections: Connection[];
  queue: PendingChange[];
  settings: Settings;
  lastSync?: string;
  syncError?: string;
}

export interface AuthStatus {
  available: boolean;
  name?: string;
  message: string;
}

export interface DateRange {
  start: string;
  end: string;
}
export interface AuthChallenge {
  url: string;
  qr: string;
  deviceCode: string;
}
export interface EventSave {
  event: CalendarEvent;
  scope?: "single" | "all";
}

export interface DesktopAPI {
  snapshot(): Promise<AppSnapshot>;
  saveEvent(input: EventSave): Promise<AppSnapshot>;
  deleteEvent(id: string, scope?: "single" | "all"): Promise<AppSnapshot>;
  saveCalendar(
    input: Partial<CalendarSource> & { name: string },
  ): Promise<AppSnapshot>;
  updateCalendar(
    id: string,
    patch: { visible?: boolean; color?: string; name?: string },
  ): Promise<AppSnapshot>;
  publishCalendar(id: string, targetId: string): Promise<AppSnapshot>;
  settings(patch: Partial<Settings>): Promise<AppSnapshot>;
  saveConnection(connection: Connection): Promise<AppSnapshot>;
  removeConnection(id: string): Promise<AppSnapshot>;
  resolveTeachingConflict(
    id: string,
    choice: "remote" | "local",
  ): Promise<AppSnapshot>;
  authStatus(): Promise<AuthStatus>;
  configureApp(appId: string, appSecret: string): Promise<void>;
  authStart(): Promise<AuthChallenge>;
  authFinish(code: string): Promise<AuthStatus>;
  sync(range: DateRange): Promise<AppSnapshot>;
  resolveConflict(id: string, choice: "remote" | "local"): Promise<AppSnapshot>;
  exportCalendar(): Promise<string | null>;
  openExternal(url: string): Promise<void>;
  window(action: "minimize" | "maximize" | "close"): void;
  onChanged(callback: (snapshot: AppSnapshot) => void): () => void;
  onSync(callback: (busy: boolean) => void): () => void;
}

declare global {
  interface Window {
    calendar: DesktopAPI;
  }
}
