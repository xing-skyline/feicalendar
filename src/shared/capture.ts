import type { AppSnapshot, CalendarEvent, EventTemplate } from "./types";
import { dateKey, inputTime, shiftDate } from "./dates";

export function eventDraft(
  snapshot: AppSnapshot,
  start?: string,
  end?: string,
  allDay = false,
): CalendarEvent {
  const rounded = new Date(Math.ceil(Date.now() / 1_800_000) * 1_800_000);
  const from = start || rounded.toISOString();
  const calendar =
    snapshot.calendars.find(
      (item) =>
        item.id === snapshot.settings.defaultCalendarId && item.writable,
    ) || snapshot.calendars.find((item) => item.writable);
  if (!calendar) throw new Error("请先添加一个可写入日历");
  return {
    id: "",
    calendarId: calendar.id,
    title: "",
    start: from,
    end:
      end ||
      (allDay
        ? shiftDate(from, 1)
        : new Date(
            new Date(from).getTime() +
              snapshot.settings.defaultDurationMinutes * 60_000,
          ).toISOString()),
    allDay,
    description: "",
    location: "",
    reminder: snapshot.settings.defaultReminder,
    recurrence: "",
    completed: false,
    syncState: "local",
  };
}

function number(text: string): number {
  if (/^\d+$/.test(text)) return Number(text);
  const digits: Record<string, number> = {
    零: 0,
    一: 1,
    二: 2,
    两: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
  };
  if (text.includes("十")) {
    const [tens, ones] = text.split("十");
    return (tens ? digits[tens] : 1) * 10 + (ones ? digits[ones] : 0);
  }
  return digits[text] ?? NaN;
}

/** Parse common Chinese date expressions locally. The caller always presents editable fields. */
export function parseCapture(
  input: string,
  base: CalendarEvent,
  now = new Date(),
): CalendarEvent {
  let title = input.trim();
  let day = dateKey(base.start);
  let time = inputTime(base.start).slice(11);
  let hasDate = false;
  const today = dateKey(now);
  const replace = (
    pattern: RegExp,
    apply: (match: RegExpMatchArray) => void,
  ) => {
    const match = title.match(pattern);
    if (!match) return;
    apply(match);
    title = title.replace(match[0], " ");
  };
  replace(/(\d{4})[-年/](\d{1,2})[-月/](\d{1,2})日?/, (match) => {
    day = `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
    hasDate = true;
  });
  if (!hasDate)
    replace(/大后天|后天|明天|今天/, (match) => {
      day = shiftDate(
        today,
        { 今天: 0, 明天: 1, 后天: 2, 大后天: 3 }[match[0]]!,
      );
      hasDate = true;
    });
  if (!hasDate)
    replace(/(下下|下|本|这)?(?:周|星期)([一二三四五六日天])/, (match) => {
      const weekday = "一二三四五六日".indexOf(
        match[2] === "天" ? "日" : match[2],
      );
      const current = (new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7;
      const weeks = match[1] === "下下" ? 2 : match[1] === "下" ? 1 : 0;
      let distance = weekday - current + weeks * 7;
      if (!match[1] && distance < 0) distance += 7;
      day = shiftDate(today, distance);
      hasDate = true;
    });
  if (hasDate) time = "09:00";
  let duration =
    (new Date(base.end).getTime() - new Date(base.start).getTime()) / 60_000;
  replace(
    /(?:持续|时长)\s*([\d零一二两三四五六七八九十]+|半)\s*(小时|分钟)/,
    (match) => {
      const value = match[1] === "半" ? 0.5 : number(match[1]);
      duration = value * (match[2] === "小时" ? 60 : 1);
      if (!(duration > 0 && duration <= 20_160))
        throw new Error("时长应在 1 分钟到 14 天之间");
    },
  );
  replace(
    /(凌晨|早上|上午|中午|下午|晚上)?\s*([\d零一二两三四五六七八九十]+)(?:点|时|[:：])(?:(半)|([\d零一二两三四五六七八九十]+)分?)?/,
    (match) => {
      let hour = number(match[2]);
      const minute = match[3] ? 30 : match[4] ? number(match[4]) : 0;
      if (["下午", "晚上"].includes(match[1]) && hour < 12) hour += 12;
      if (match[1] === "中午" && hour < 11) hour += 12;
      if (match[1] === "凌晨" && hour === 12) hour = 0;
      if (!(hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59))
        throw new Error("请输入有效的小时和分钟");
      time = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
    },
  );
  const allDay = /全天/.test(title);
  title = title
    .replace(/全天/, " ")
    .replace(/^[\s，,、]+|[\s，,、]+$/g, "")
    .replace(/\s+/g, " ");
  const start = allDay ? day : `${day}T${time}:00+08:00`;
  if (
    !Number.isFinite(new Date(start).getTime()) ||
    dateKey(`${day}T12:00:00+08:00`) !== day
  )
    throw new Error("日期不存在，请检查年月日");
  return {
    ...base,
    title,
    start,
    allDay,
    end: allDay
      ? shiftDate(day, 1)
      : new Date(new Date(start).getTime() + duration * 60_000).toISOString(),
  };
}

export function templateDraft(
  template: EventTemplate,
  base: CalendarEvent,
): CalendarEvent {
  const day = dateKey(base.start);
  const start = template.allDay
    ? day
    : base.allDay
      ? `${day}T09:00:00+08:00`
      : base.start;
  return {
    ...base,
    title: template.title,
    calendarId: template.calendarId,
    allDay: template.allDay,
    start,
    end: template.allDay
      ? shiftDate(day, Math.max(1, Math.round(template.durationMinutes / 1440)))
      : new Date(
          new Date(start).getTime() + template.durationMinutes * 60_000,
        ).toISOString(),
    description: template.description,
    location: template.location,
    reminder: template.reminder,
    recurrence: template.recurrence,
  };
}
