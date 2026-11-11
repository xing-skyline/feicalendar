import { z } from "zod";
import { CALENDAR_VIEWS } from "../src/shared/types";

export const text = z.string().max(20_000);
export const id = z.string().min(1).max(3000);
export const date = z
  .string()
  .max(40)
  .refine(
    (value) => Number.isFinite(new Date(value).getTime()),
    "时间格式无效",
  );
export const eventSchema = z
  .object({
    id: z.string().max(3000),
    calendarId: id,
    title: z.string().trim().min(1).max(1000),
    start: date,
    end: date,
    allDay: z.boolean(),
    description: text,
    location: z.string().max(2000),
    reminder: z.number().int().min(-1).max(20160),
    recurrence: z.enum([
      "",
      "FREQ=DAILY",
      "FREQ=WEEKLY",
      "FREQ=MONTHLY",
      "FREQ=YEARLY",
      "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR",
    ]),
    completed: z.boolean(),
    syncState: z.enum(["local", "synced", "pending", "error", "conflict"]),
    remoteId: id.optional(),
    remoteFingerprint: text.optional(),
    remoteEtag: text.optional(),
    recurring: z.boolean().optional(),
    seriesId: id.optional(),
    occurrenceStart: date.optional(),
    exceptions: z.array(date).max(5000).optional(),
    url: text.optional(),
    taskId: id.optional(),
    courseId: id.optional(),
    courseWeek: z.number().int().min(1).max(60).optional(),
  })
  .refine(
    (event) => new Date(event.end) > new Date(event.start),
    "结束时间必须晚于开始时间",
  );
export const rangeSchema = z
  .object({ start: date, end: date })
  .refine((value) => {
    const duration =
      new Date(value.end).getTime() - new Date(value.start).getTime();
    return duration > 0 && duration <= 400 * 86400_000;
  }, "同步范围应在 400 天以内");
export const scopeSchema = z.enum(["single", "all"]).optional();

export const settingsSchema = z.object({
  defaultCalendarId: id.optional(),
  autoSync: z.boolean().optional(),
  syncMinutes: z.number().int().min(1).max(60).optional(),
  feishuEnabled: z.boolean().optional(),
  reminders: z.boolean().optional(),
  weekends: z.boolean().optional(),
  theme: z.enum(["light", "dark", "system"]).optional(),
  calendarView: z.enum(CALENDAR_VIEWS).optional(),
  closeToTray: z.boolean().optional(),
  desktopEnabled: z.boolean().optional(),
  desktopView: z.enum(["month", "agenda", "grid"]).optional(),
  desktopMode: z.enum(["embedded", "floating", "topmost"]).optional(),
  desktopDisplay: z.string().max(100).optional(),
  desktopCalendarIds: z.array(id).max(1000).nullable().optional(),
  desktopFontSize: z.number().int().min(11).max(22).optional(),
  desktopRowGap: z.number().int().min(2).max(18).optional(),
  desktopMaxEvents: z.number().int().min(1).max(12).optional(),
  desktopTheme: z.enum(["light", "dark", "system"]).optional(),
  desktopColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
  desktopOpacity: z.number().int().min(0).max(100).optional(),
  desktopLocked: z.boolean().optional(),
  autoCheckUpdates: z.boolean().optional(),
  captureShortcut: z.string().max(100).optional(),
  allDayReminderTime: z
    .string()
    .regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/)
    .optional(),
  mutedReminderCalendars: z.array(id).max(1000).optional(),
  showLunar: z.boolean().optional(),
  showSolarTerms: z.boolean().optional(),
  showHolidays: z.boolean().optional(),
  weekStartsOn: z.union([z.literal(0), z.literal(1), z.literal(6)]).optional(),
  hour12: z.boolean().optional(),
  dayStartHour: z.number().int().min(0).max(23).optional(),
  dayEndHour: z.number().int().min(1).max(24).optional(),
  defaultDurationMinutes: z.number().int().min(15).max(240).optional(),
  defaultReminder: z.number().int().min(-1).max(20160).optional(),
  bufferBeforeMinutes: z.number().int().min(0).max(180).optional(),
  bufferAfterMinutes: z.number().int().min(0).max(180).optional(),
  teachingStartDate: z.union([z.literal(""), z.iso.date()]).optional(),
  teachingWeeks: z.number().int().min(1).max(104).optional(),
});
