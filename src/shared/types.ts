export type Provider =
  "local" | "feishu" | "caldav" | "webdav" | "ics" | "google" | "microsoft";
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
  taskId?: string;
  courseId?: string;
  courseWeek?: number;
}

export interface Connection {
  id: string;
  kind: "caldav" | "webdav" | "ics" | "google" | "microsoft";
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
  oauthClientId?: string;
  oauthTenant?: string;
  oauth?: OAuthCredentials;
}

export interface OAuthCredentials {
  clientId: string;
  clientSecret?: string;
  tenant: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  accountId: string;
}

export interface OAuthInput {
  id: string;
  name: string;
  kind: "google" | "microsoft";
  clientId: string;
  clientSecret: string;
  tenant: string;
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
  desktopEnabled: boolean;
  desktopView: "month" | "agenda" | "grid";
  desktopMode: "embedded" | "floating" | "topmost";
  desktopDisplay: string;
  desktopCalendarIds: string[] | null;
  desktopFontSize: number;
  desktopRowGap: number;
  desktopMaxEvents: number;
  desktopTheme: "light" | "dark" | "system";
  desktopColor: string;
  desktopOpacity: number;
  desktopLocked: boolean;
  autoCheckUpdates: boolean;
  captureShortcut: string;
  allDayReminderTime: string;
  mutedReminderCalendars: string[];
  showLunar: boolean;
  showSolarTerms: boolean;
  showHolidays: boolean;
  weekStartsOn: 0 | 1 | 6;
  hour12: boolean;
  dayStartHour: number;
  dayEndHour: number;
  defaultDurationMinutes: number;
  defaultReminder: number;
  bufferBeforeMinutes: number;
  bufferAfterMinutes: number;
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
  templates?: EventTemplate[];
  reminderRules?: Record<string, number[]>;
  reminderEntries?: ReminderEntry[];
  reminderCheckedAt?: string;
  history?: EventHistory[];
  trash?: TrashEntry[];
  backupError?: string;
  holidayData?: HolidayData;
  holidayOverrides?: Record<string, { name: string; work: boolean }>;
  specialDates?: SpecialDate[];
  tasks?: CalendarTask[];
  calendarSets?: CalendarSet[];
  semesters?: Semester[];
  courses?: Course[];
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
  localReminders?: number[];
}

export interface EventTemplate {
  id: string;
  name: string;
  title: string;
  calendarId: string;
  durationMinutes: number;
  allDay: boolean;
  location: string;
  description: string;
  reminder: number;
  recurrence: string;
}

export interface ReminderEntry {
  id: string;
  eventId: string;
  title: string;
  location: string;
  dueAt: string;
  eventStart: string;
  state: "unread" | "snoozed" | "dismissed";
  snoozedUntil?: string;
}

export interface EventHistory {
  id: string;
  label: string;
  at: string;
  before: CalendarEvent[];
  after: CalendarEvent[];
  tasksBefore?: CalendarTask[];
  tasksAfter?: CalendarTask[];
  metadataBefore?: HistoryMetadata;
  metadataAfter?: HistoryMetadata;
  undone?: boolean;
}

export interface TrashEntry {
  id: string;
  historyId: string;
  deletedAt: string;
  event: CalendarEvent;
}

export interface BackupSummary {
  id: string;
  name: string;
  events: number;
}

export interface HolidayData {
  version: 1;
  years: Record<
    string,
    {
      source: string;
      publishedAt: string;
      holidays: { name: string; start: string; end: string }[];
      workdays: string[];
    }
  >;
}

export interface SpecialDate {
  id: string;
  title: string;
  date: string;
  lunar: boolean;
  leapMonth: boolean;
  yearly: boolean;
  showDesktop: boolean;
  remindDays: number;
}

export interface CalendarTask {
  id: string;
  title: string;
  description: string;
  deadline: string;
  estimateMinutes: number;
  priority: number;
  completed: boolean;
  subtasks: { id: string; title: string; completed: boolean }[];
  updatedAt?: string;
}

export interface CalendarSet {
  id: string;
  name: string;
  calendarIds: string[];
}

export interface Semester {
  id: string;
  name: string;
  startDate: string;
  weeks: number;
  weekStartsOn: 0 | 1 | 6;
  periods: { id: string; name: string; start: string; end: string }[];
}

export interface Course {
  id: string;
  semesterId: string;
  title: string;
  calendarId: string;
  weekday: number;
  weeks: number[];
  firstPeriod: string;
  lastPeriod: string;
  location: string;
  description: string;
  exceptions: Record<
    string,
    {
      cancelled?: boolean;
      start?: string;
      end?: string;
      title?: string;
      location?: string;
      description?: string;
    }
  >;
}

export type HistoryMetadata = Partial<
  Pick<
    AppSnapshot,
    | "reminderRules"
    | "semesters"
    | "courses"
    | "settings"
    | "templates"
    | "specialDates"
    | "calendarSets"
    | "holidayOverrides"
  >
>;

export interface BackupOptions {
  includeCloud: boolean;
  deleteMissing: boolean;
}

export interface BackupPreview {
  token: string;
  changes: {
    action: "create" | "update" | "delete";
    title: string;
    start: string;
    calendar: string;
    cloud: boolean;
  }[];
  skipped: number;
}

export interface DesktopAPI {
  oauthConnect(input: OAuthInput): Promise<AppSnapshot>;
  oauthCancel(): Promise<void>;
  saveSemester(value: Semester, activate: boolean): Promise<AppSnapshot>;
  deleteSemester(id: string): Promise<AppSnapshot>;
  saveCourse(value: Course): Promise<AppSnapshot>;
  deleteCourse(id: string): Promise<AppSnapshot>;
  bulkEvents(input: BulkEventAction): Promise<AppSnapshot>;
  importPreview(
    calendarId: string,
    range: DateRange,
  ): Promise<ImportPreview | null>;
  importApply(token: string, ids: string[]): Promise<AppSnapshot>;
  printCalendar(input: PrintOptions, pdf: boolean): Promise<string | null>;
  saveTask(task: CalendarTask): Promise<AppSnapshot>;
  deleteTask(id: string, removeScheduled: boolean): Promise<AppSnapshot>;
  scheduleTask(
    id: string,
    start: string,
    calendarId: string,
    blockId: string,
  ): Promise<AppSnapshot>;
  saveCalendarSet(set: CalendarSet): Promise<AppSnapshot>;
  deleteCalendarSet(id: string): Promise<AppSnapshot>;
  applyCalendarSet(id: string, desktop: boolean): Promise<AppSnapshot>;
  updateHolidays(): Promise<AppSnapshot>;
  holidayOverride(
    date: string,
    value: { name: string; work: boolean } | null,
  ): Promise<AppSnapshot>;
  saveSpecialDate(value: SpecialDate): Promise<AppSnapshot>;
  deleteSpecialDate(id: string): Promise<AppSnapshot>;
  backupList(): Promise<BackupSummary[]>;
  backupExport(password: string): Promise<string | null>;
  backupImport(password: string): Promise<BackupSummary | null>;
  backupPreview(id: string, options: BackupOptions): Promise<BackupPreview>;
  backupRestore(token: string): Promise<AppSnapshot>;
  undoChange(): Promise<AppSnapshot>;
  restoreTrash(id: string): Promise<AppSnapshot>;
  displays(): Promise<{ id: string; label: string }[]>;
  reminderRule(eventId: string, minutes: number[] | null): Promise<AppSnapshot>;
  reminderAction(
    id: string,
    action: "dismiss" | "snooze5" | "snooze15",
  ): Promise<AppSnapshot>;
  quickCapture(action: "open" | "close"): Promise<void>;
  saveTemplate(template: EventTemplate): Promise<AppSnapshot>;
  deleteTemplate(id: string): Promise<AppSnapshot>;
  desktopRange(range: DateRange): Promise<void>;
  desktop(
    action: "show" | "hide" | "close" | "reset" | "move" | "resize" | "stop",
  ): Promise<void>;
  desktopStatus(): Promise<{
    mode: "embedded" | "floating" | "off";
    visible: boolean;
  }>;
  navigate(target: {
    settings?: "desktop" | "updates" | "reminders";
    event?: CalendarEvent;
    date?: string;
  }): Promise<void>;
  onNavigate(
    callback: (target: {
      settings?: string;
      event?: CalendarEvent;
      date?: string;
    }) => void,
  ): () => void;
  updateAction(
    action: "status" | "check" | "download" | "install",
  ): Promise<UpdateStatus>;
  onUpdate(callback: (status: UpdateStatus) => void): () => void;
  snapshot(): Promise<AppSnapshot>;
  saveEvent(input: EventSave): Promise<AppSnapshot>;
  saveEvents(inputs: EventSave[]): Promise<AppSnapshot>;
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

export interface BulkEventAction {
  operationId: string;
  ids: string[];
  action: "copy" | "move" | "reminder" | "complete" | "delete";
  calendarId: string;
  reminder: number;
}

export interface ImportPreview {
  token: string;
  events: { event: CalendarEvent; duplicate: boolean }[];
}

export interface PrintOptions {
  date: string;
  view: "week" | "month" | "course";
  calendarIds: string[];
  details: boolean;
}

export interface UpdateStatus {
  phase:
    | "idle"
    | "checking"
    | "latest"
    | "available"
    | "downloading"
    | "ready"
    | "installing"
    | "error";
  currentVersion: string;
  version?: string;
  notes?: string;
  url?: string;
  checkedAt?: string;
  progress?: number;
  error?: string;
  canInstall: boolean;
}

declare global {
  interface Window {
    calendar: DesktopAPI;
  }
}
