import ical from "node-ical";
import { createDAVClient } from "tsdav";
import type {
  CalendarEvent,
  CalendarSource,
  Connection,
  DateRange,
} from "../src/shared/types";
import { inputTime, overlaps, shiftDate } from "../src/shared/dates";

export function checkedUrl(value: string): URL {
  const url = new URL(value.replace(/^webcal:/i, "https:"));
  if (url.protocol !== "https:" || url.username || url.password)
    throw new Error("请填写 HTTPS 地址，用户名和密码请使用专用输入框。");
  return url;
}

function calendarDay(date: Date & { tz?: string }): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: date.tz || "UTC",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  return ["year", "month", "day"]
    .map((key) => parts.find((part) => part.type === key)!.value)
    .join("-");
}

export async function parseSubscription(
  text: string,
  calendarId: string,
  range: DateRange,
): Promise<CalendarEvent[]> {
  if (!text.includes("BEGIN:VCALENDAR"))
    throw new Error("订阅地址返回的内容不是 iCalendar 数据");
  const components = await ical.async.parseICS(text);
  const result = new Map<string, CalendarEvent>();
  for (const component of Object.values(components)) {
    if (
      !component ||
      component.type !== "VEVENT" ||
      component.status === "CANCELLED"
    )
      continue;
    const instances = ical.expandRecurringEvent(component, {
      from: new Date(range.start),
      to: new Date(range.end),
      expandOngoing: true,
      includeOverrides: true,
      excludeExdates: true,
      maxIterations: 10_000,
    });
    for (const instance of instances) {
      const source = instance.event;
      if (source.status === "CANCELLED") continue;
      const allDay = instance.isFullDay;
      const start = allDay
        ? calendarDay(instance.start)
        : instance.start.toISOString();
      const end = allDay
        ? calendarDay(instance.end)
        : instance.end.toISOString();
      if (!overlaps(start, end, range)) continue;
      const event: CalendarEvent = {
        id: `${calendarId}/${component.uid}/${instance.start.toISOString()}`,
        calendarId,
        title: String(instance.summary || "未命名日程"),
        start,
        end:
          end > start
            ? end
            : allDay
              ? shiftDate(start, 1)
              : new Date(instance.start.getTime() + 3600_000).toISOString(),
        allDay,
        description: String(source.description || ""),
        location: String(source.location || ""),
        reminder: -1,
        recurrence: "",
        recurring: Boolean(component.rrule),
        completed: false,
        syncState: "synced",
      };
      result.set(event.id, event);
    }
  }
  return [...result.values()];
}

export async function fetchSubscription(
  connection: Connection,
  range: DateRange,
) {
  const endpoint = checkedUrl(connection.url);
  const calendars: CalendarSource[] = [];
  const events: CalendarEvent[] = [];
  if (connection.kind === "ics") {
    const response = await fetch(endpoint, {
      signal: AbortSignal.timeout(30_000),
      redirect: "error",
    });
    if (!response.ok)
      throw new Error(`订阅读取失败（HTTP ${response.status}）`);
    const text = await response.text();
    if (text.length > 20_000_000)
      throw new Error("订阅文件超过 20 MB，请缩小日程范围");
    const calendar: CalendarSource = {
      id: `ics:${connection.id}`,
      connectionId: connection.id,
      provider: "ics",
      name: connection.name,
      color: "#23a58d",
      visible: true,
      writable: false,
    };
    calendars.push(calendar);
    events.push(...(await parseSubscription(text, calendar.id, range)));
  } else {
    const client = await createDAVClient({
      serverUrl: endpoint.href,
      credentials: {
        username: connection.username,
        password: connection.password,
      },
      authMethod: "Basic",
      defaultAccountType: "caldav",
      fetch: async (url, options) => {
        const target = new URL(String(url));
        if (target.origin !== endpoint.origin)
          throw new Error("CalDAV 返回了不同服务器的地址，请核对服务器配置。");
        return fetch(target, {
          ...options,
          signal: AbortSignal.timeout(30_000),
          redirect: "error",
        });
      },
    });
    const remoteCalendars = await client.fetchCalendars();
    for (const remote of remoteCalendars) {
      const calendar: CalendarSource = {
        id: `caldav:${connection.id}:${remote.url}`,
        connectionId: connection.id,
        remoteId: remote.url,
        provider: "caldav",
        name: String(remote.displayName || connection.name),
        color: "#23a58d",
        writable: false,
        visible: true,
      };
      const objects = await client.fetchCalendarObjects({
        calendar: remote,
        timeRange: range,
      });
      const items: CalendarEvent[] = [];
      for (const object of objects) {
        if (object.data)
          items.push(
            ...(await parseSubscription(
              String(object.data),
              calendar.id,
              range,
            )),
          );
      }
      calendars.push(calendar);
      events.push(...items);
    }
  }
  return { calendars, events };
}

export function exportICS(events: CalendarEvent[]): string {
  const escape = (text: string) =>
    text
      .replace(/\\/g, "\\\\")
      .replace(/\r?\n/g, "\\n")
      .replace(/,/g, "\\,")
      .replace(/;/g, "\\;");
  const date = (value: string) =>
    value.replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//FeiCalendar//Desktop Calendar//ZH",
    "CALSCALE:GREGORIAN",
  ];
  for (const event of events.filter((item) => !item.deleted)) {
    const repeatedTime = Boolean(event.recurrence && !event.allDay);
    const timeParameter = event.allDay
      ? ";VALUE=DATE"
      : repeatedTime
        ? ";TZID=Asia/Shanghai"
        : "";
    const formatTime = (value: string) =>
      repeatedTime
        ? inputTime(value).replace(/[-:]/g, "") + "00"
        : date(event.allDay ? value : new Date(value).toISOString());
    lines.push(
      "BEGIN:VEVENT",
      `UID:${escape(event.id)}@feicalendar`,
      `DTSTAMP:${date(new Date().toISOString())}`,
      `SUMMARY:${escape(event.title)}`,
      `DTSTART${timeParameter}:${formatTime(event.start)}`,
      `DTEND${timeParameter}:${formatTime(event.end)}`,
      `DESCRIPTION:${escape(event.description)}`,
      `LOCATION:${escape(event.location)}`,
    );
    if (event.recurrence) lines.push(`RRULE:${event.recurrence}`);
    if (event.exceptions?.length) {
      lines.push(
        `EXDATE${event.allDay ? ";VALUE=DATE" : ""}:${event.exceptions.map((value) => date(event.allDay ? value : new Date(value).toISOString())).join(",")}`,
      );
    }
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  // RFC 5545 folds at octet boundaries without splitting a UTF-8 character.
  return (
    lines
      .map((line) => {
        let output = "";
        let width = 0;
        for (const character of line) {
          const size = Buffer.byteLength(character);
          if (width + size > 75) {
            output += "\r\n ";
            width = 1;
          }
          output += character;
          width += size;
        }
        return output;
      })
      .join("\r\n") + "\r\n"
  );
}
