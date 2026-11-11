import { createHash } from "node:crypto";
import type {
  CalendarEvent,
  CalendarSource,
  Connection,
  DateRange,
} from "../src/shared/types";
import {
  contentFingerprint,
  deletedEvent,
  type RemoteCalendarClient,
} from "./remote-calendar";
import { refreshOAuth } from "./oauth";
import { dateKey } from "../src/shared/dates";

interface GoogleEvent {
  id: string;
  status?: string;
  summary?: string;
  description?: string;
  location?: string;
  etag?: string;
  htmlLink?: string;
  start?: { date?: string; dateTime?: string };
  end?: { date?: string; dateTime?: string };
  recurrence?: string[];
  recurringEventId?: string;
  reminders?: { overrides?: { minutes: number }[] };
}
interface GraphEvent {
  id: string;
  subject?: string;
  body?: { content?: string };
  location?: { displayName?: string };
  webLink?: string;
  "@odata.etag"?: string;
  start?: { dateTime: string; timeZone: string };
  end?: { dateTime: string; timeZone: string };
  isAllDay?: boolean;
  isCancelled?: boolean;
  type?: string;
  isReminderOn?: boolean;
  reminderMinutesBeforeStart?: number;
  onlineMeeting?: { joinUrl?: string };
  originalStartTimeZone?: string;
}
const propertyId =
  "String {a0b5b230-6bf2-48fb-a316-cb58a58af122} Name FeiCalendarCreateKey";

export function googleEvent(
  calendar: CalendarSource,
  item: GoogleEvent,
): CalendarEvent {
  if (item.status === "cancelled" || !item.start || !item.end)
    return deletedEvent(calendar, item.id);
  const event: CalendarEvent = {
    id: `${calendar.id}/${item.id}`,
    calendarId: calendar.id,
    remoteId: item.id,
    remoteEtag: item.etag,
    title: item.summary || "未命名日程",
    description: item.description || "",
    location: item.location || "",
    start: item.start.date || item.start.dateTime!,
    end: item.end.date || item.end.dateTime!,
    allDay: Boolean(item.start.date),
    reminder: item.reminders?.overrides?.[0]?.minutes ?? -1,
    recurrence: "",
    recurring: Boolean(item.recurringEventId || item.recurrence?.length),
    completed: false,
    syncState: "synced",
    url: item.htmlLink,
  };
  event.remoteFingerprint = contentFingerprint(event, "google");
  return event;
}

export function graphEvent(
  calendar: CalendarSource,
  item: GraphEvent,
): CalendarEvent {
  if (item.isCancelled || !item.start || !item.end)
    return deletedEvent(calendar, item.id);
  const asTime = (value: { dateTime: string; timeZone: string }) => {
    if (item.isAllDay) return value.dateTime.slice(0, 10);
    // Graph requests explicitly ask for UTC. Refuse unexpected wall times instead of shifting them silently.
    if (
      !/^(UTC|Etc\/UTC)$/i.test(value.timeZone) &&
      !/(Z|[+-]\d\d:\d\d)$/.test(value.dateTime)
    )
      throw new Error("Microsoft 返回了非 UTC 日程，请重新同步");
    return new Date(
      value.dateTime + (/(Z|[+-]\d\d:\d\d)$/.test(value.dateTime) ? "" : "Z"),
    ).toISOString();
  };
  const event: CalendarEvent = {
    id: `${calendar.id}/${item.id}`,
    calendarId: calendar.id,
    remoteId: item.id,
    remoteEtag: item["@odata.etag"],
    title: item.subject || "未命名日程",
    description: item.body?.content || "",
    location: item.location?.displayName || "",
    start: asTime(item.start),
    end: asTime(item.end),
    allDay: Boolean(item.isAllDay),
    reminder: item.isReminderOn ? (item.reminderMinutesBeforeStart ?? 15) : -1,
    recurrence: "",
    recurring: Boolean(item.type && item.type !== "singleInstance"),
    completed: false,
    syncState: "synced",
    url: item.onlineMeeting?.joinUrl || item.webLink,
  };
  event.remoteFingerprint = contentFingerprint(event, "microsoft");
  return event;
}

export function googleBody(event: CalendarEvent) {
  return {
    summary: event.title,
    description: event.description,
    location: event.location,
    start: event.allDay
      ? { date: event.start }
      : { dateTime: event.start, timeZone: "Asia/Shanghai" },
    end: event.allDay
      ? { date: event.end }
      : { dateTime: event.end, timeZone: "Asia/Shanghai" },
    reminders: {
      useDefault: false,
      overrides:
        event.reminder >= 0
          ? [{ method: "popup", minutes: event.reminder }]
          : [],
    },
  };
}

export function graphBody(event: CalendarEvent) {
  return {
    subject: event.title,
    body: { contentType: "text", content: event.description },
    location: { displayName: event.location },
    start: event.allDay
      ? { dateTime: `${event.start}T00:00:00`, timeZone: "China Standard Time" }
      : {
          dateTime: new Date(event.start).toISOString().replace(/Z$/, ""),
          timeZone: "UTC",
        },
    end: event.allDay
      ? { dateTime: `${event.end}T00:00:00`, timeZone: "China Standard Time" }
      : {
          dateTime: new Date(event.end).toISOString().replace(/Z$/, ""),
          timeZone: "UTC",
        },
    isAllDay: event.allDay,
    isReminderOn: event.reminder >= 0,
    reminderMinutesBeforeStart: Math.max(0, event.reminder),
  };
}

function graphRecurrence(event: CalendarEvent) {
  if (!event.recurrence) return undefined;
  const day = dateKey(event.start);
  const weekday = [
    "sunday",
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
  ][new Date(`${day}T12:00:00Z`).getUTCDay()];
  const pattern: Record<string, unknown> = { interval: 1 };
  if (event.recurrence.includes("DAILY")) pattern.type = "daily";
  else if (event.recurrence.includes("WEEKLY"))
    Object.assign(pattern, {
      type: "weekly",
      firstDayOfWeek: "monday",
      daysOfWeek: event.recurrence.includes("BYDAY")
        ? ["monday", "tuesday", "wednesday", "thursday", "friday"]
        : [weekday],
    });
  else if (event.recurrence.includes("MONTHLY"))
    Object.assign(pattern, {
      type: "absoluteMonthly",
      dayOfMonth: Number(day.slice(8)),
    });
  else
    Object.assign(pattern, {
      type: "absoluteYearly",
      dayOfMonth: Number(day.slice(8)),
      month: Number(day.slice(5, 7)),
    });
  return {
    pattern,
    range: {
      type: "noEnd",
      startDate: day,
      recurrenceTimeZone: "China Standard Time",
    },
  };
}

class HttpError extends Error {
  constructor(readonly status: number) {
    super(
      `日历服务请求失败（HTTP ${status}）${status === 401 ? "，请重新授权账号" : status === 412 ? "，日程已被其他设备修改，请再次同步" : ""}`,
    );
  }
}

export class OAuthCalendarClient implements RemoteCalendarClient {
  private google: boolean;
  private root: string;
  constructor(
    private connection: Connection,
    private persist: (connection: Connection) => Promise<void>,
    private fetcher = fetch,
  ) {
    this.google = connection.kind === "google";
    this.root = this.google
      ? "https://www.googleapis.com/calendar/v3/"
      : "https://graph.microsoft.com/v1.0/";
  }
  private async request<T>(
    route: string,
    method = "GET",
    body?: unknown,
    etag?: string,
    retry = true,
    zone = "UTC",
  ): Promise<T> {
    const url = new URL(route, this.root);
    if (!url.href.startsWith(this.root) || url.username || url.password)
      throw new Error("日历服务返回了无效的分页地址");
    if (!this.connection.oauth) throw new Error("账号缺少授权凭据，请重新连接");
    if (this.connection.oauth.expiresAt < Date.now() + 60_000) {
      this.connection.oauth = await refreshOAuth(this.connection, this.fetcher);
      await this.persist(this.connection);
    }
    const response = await this.fetcher(url, {
      method,
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
      headers: {
        Authorization: `Bearer ${this.connection.oauth.accessToken}`,
        "Content-Type": "application/json",
        ...(this.google
          ? {}
          : {
              Prefer: `outlook.timezone="${zone}", outlook.body-content-type="text", IdType="ImmutableId"`,
            }),
        ...(etag ? { "If-Match": etag } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (response.status === 401 && retry) {
      this.connection.oauth.expiresAt = 0;
      return this.request(route, method, body, etag, false, zone);
    }
    if (!response.ok) throw new HttpError(response.status);
    return response.status === 204
      ? (undefined as T)
      : ((await response.json()) as T);
  }
  private async pages<T>(route: string): Promise<T[]> {
    let next = route;
    const result: T[] = [];
    const seen = new Set<string>();
    while (next) {
      if (seen.has(next) || seen.size >= 1000)
        throw new Error("日历分页超出限制，请缩小同步范围");
      seen.add(next);
      const page = await this.request<{
        items?: T[];
        value?: T[];
        nextPageToken?: string;
        "@odata.nextLink"?: string;
      }>(next);
      result.push(...(page.items || page.value || []));
      if (result.length > 100000)
        throw new Error("日历记录过多，请缩小同步范围");
      if (this.google && page.nextPageToken) {
        const url = new URL(route, this.root);
        url.searchParams.set("pageToken", page.nextPageToken);
        next = url.href;
      } else next = page["@odata.nextLink"] || "";
    }
    return result;
  }
  async calendars(): Promise<CalendarSource[]> {
    const records = await this.pages<{
      id: string;
      summary?: string;
      name?: string;
      backgroundColor?: string;
      hexColor?: string;
      accessRole?: string;
      canEdit?: boolean;
    }>(
      this.google
        ? "users/me/calendarList?maxResults=250"
        : "me/calendars?$top=100",
    );
    return records.map((item) => ({
      id: `${this.connection.kind}:${this.connection.id}:${item.id}`,
      remoteId: item.id,
      connectionId: this.connection.id,
      name: item.summary || item.name || this.connection.name,
      color: /^#[0-9a-fA-F]{6}$/.test(
        item.backgroundColor || item.hexColor || "",
      )
        ? (item.backgroundColor || item.hexColor)!
        : "#5474ee",
      provider: this.connection.kind as "google" | "microsoft",
      writable:
        !this.connection.readOnly &&
        (this.google
          ? ["owner", "writer"].includes(item.accessRole || "")
          : Boolean(item.canEdit)),
      visible: true,
    }));
  }
  private route(calendar: CalendarSource) {
    return this.google
      ? `calendars/${encodeURIComponent(calendar.remoteId!)}/events`
      : `me/calendars/${encodeURIComponent(calendar.remoteId!)}/events`;
  }
  private async decodeGraph(calendar: CalendarSource, item: GraphEvent) {
    if (
      item.isAllDay &&
      item.start &&
      (item.start.dateTime.slice(11, 19) !== "00:00:00" ||
        item.end?.dateTime.slice(11, 19) !== "00:00:00")
    ) {
      const zone = item.originalStartTimeZone;
      if (!zone || !/^[A-Za-z0-9 _./+-]{1,100}$/.test(zone))
        throw new Error("Microsoft 全天日程使用了无法识别的原始时区");
      item = await this.request<GraphEvent>(
        `${this.route(calendar)}/${encodeURIComponent(item.id)}`,
        "GET",
        undefined,
        undefined,
        true,
        zone,
      );
      if (
        item.start?.dateTime.slice(11, 19) !== "00:00:00" ||
        item.end?.dateTime.slice(11, 19) !== "00:00:00"
      )
        throw new Error("Microsoft 全天日程的原始时区转换失败");
    }
    return graphEvent(calendar, item);
  }
  async events(
    calendar: CalendarSource,
    range: DateRange,
  ): Promise<CalendarEvent[]> {
    const route = this.route(calendar);
    if (this.google)
      return (
        await this.pages<GoogleEvent>(
          `${route}?${new URLSearchParams({ timeMin: new Date(range.start).toISOString(), timeMax: new Date(range.end).toISOString(), singleEvents: "true", maxResults: "2500" })}`,
        )
      ).map((item) => googleEvent(calendar, item));
    const events = await this.pages<GraphEvent>(
      `${route.replace(/events$/, "calendarView")}?${new URLSearchParams({ startDateTime: range.start, endDateTime: range.end, $top: "1000" })}`,
    );
    const decoded: CalendarEvent[] = [];
    for (const event of events)
      decoded.push(await this.decodeGraph(calendar, event));
    return decoded;
  }
  async get(calendar: CalendarSource, remoteId: string) {
    try {
      const value = await this.request<GoogleEvent & GraphEvent>(
        `${this.route(calendar)}/${encodeURIComponent(remoteId)}`,
      );
      return this.google
        ? googleEvent(calendar, value)
        : await this.decodeGraph(calendar, value);
    } catch (error) {
      if (error instanceof HttpError && [404, 410].includes(error.status))
        return deletedEvent(calendar, remoteId);
      throw error;
    }
  }
  async create(calendar: CalendarSource, event: CalendarEvent, key: string) {
    const route = this.route(calendar);
    const stableKey = createHash("sha256").update(key).digest("hex");
    let body: Record<string, unknown>;
    if (this.google) {
      const existing = await this.get(calendar, stableKey);
      if (!existing.deleted) return existing;
      body = {
        ...googleBody(event),
        id: stableKey,
        ...(event.recurrence
          ? { recurrence: [`RRULE:${event.recurrence}`] }
          : {}),
      };
    } else {
      const query = new URLSearchParams({
        $filter: `singleValueExtendedProperties/Any(ep: ep/id eq '${propertyId}' and ep/value eq '${stableKey}')`,
      });
      const existing = await this.pages<GraphEvent>(`${route}?${query}`);
      if (existing[0]) return this.decodeGraph(calendar, existing[0]);
      body = {
        ...graphBody(event),
        transactionId: stableKey,
        singleValueExtendedProperties: [{ id: propertyId, value: stableKey }],
        ...(event.recurrence ? { recurrence: graphRecurrence(event) } : {}),
      };
    }
    try {
      const value = await this.request<GoogleEvent & GraphEvent>(
        route,
        "POST",
        body,
      );
      return this.google
        ? googleEvent(calendar, value)
        : await this.decodeGraph(calendar, value);
    } catch (error) {
      if (this.google && error instanceof HttpError && error.status === 409)
        return this.get(calendar, stableKey);
      throw error;
    }
  }
  async update(
    calendar: CalendarSource,
    event: CalendarEvent,
    remote: CalendarEvent,
  ) {
    const body = this.google ? googleBody(event) : graphBody(event);
    const previous = this.google ? googleBody(remote) : graphBody(remote);
    const changed = Object.fromEntries(
      Object.entries(body).filter(
        ([key, value]) =>
          JSON.stringify(value) !==
          JSON.stringify(previous[key as keyof typeof previous]),
      ),
    );
    if (Object.keys(changed).length)
      await this.request(
        `${this.route(calendar)}/${encodeURIComponent(event.remoteId!)}`,
        "PATCH",
        changed,
        remote.remoteEtag,
      );
    return this.get(calendar, event.remoteId!);
  }
  async delete(
    calendar: CalendarSource,
    remoteId: string,
    remote?: CalendarEvent,
  ) {
    try {
      await this.request(
        `${this.route(calendar)}/${encodeURIComponent(remoteId)}`,
        "DELETE",
        undefined,
        remote?.remoteEtag,
      );
    } catch (error) {
      if (!(error instanceof HttpError && [404, 410].includes(error.status)))
        throw error;
    }
  }
}
