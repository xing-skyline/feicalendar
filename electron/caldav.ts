import ICAL from "ical.js";
import ical from "node-ical";
import { createDAVClient } from "tsdav";
import type {
  CalendarEvent,
  CalendarSource,
  Connection,
  DateRange,
} from "../src/shared/types";
import {
  calendarDay,
  checkedUrl,
  exportICS,
  parseSubscription,
} from "./subscriptions";
import {
  contentFingerprint,
  deletedEvent,
  type RemoteCalendarClient,
} from "./remote-calendar";

function resourceId(remoteId: string) {
  const url = new URL(remoteId);
  const occurrence = decodeURIComponent(url.hash.slice(1));
  url.hash = "";
  return { url, occurrence };
}

function recurrenceDate(component: ICAL.Component): string {
  const wrapper = `BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${component.toString()}\r\nEND:VCALENDAR\r\n`;
  const entry = Object.values(ical.sync.parseICS(wrapper)).find(
    (item) => item?.type === "VEVENT",
  );
  if (!entry || entry.type !== "VEVENT" || !entry.recurrenceid) return "";
  return entry.recurrenceid.dateOnly
    ? calendarDay(entry.recurrenceid)
    : entry.recurrenceid.toISOString();
}

export function updateCalendarData(
  data: string,
  event: CalendarEvent,
  occurrence = "",
  deleting = false,
  changeReminder = true,
): string {
  const root = ICAL.Component.fromString(data);
  const master = root
    .getAllSubcomponents("vevent")
    .find((item) => !item.hasProperty("recurrence-id"));
  if (!master) throw new Error("CalDAV 日程缺少主记录");
  let component = occurrence
    ? root
        .getAllSubcomponents("vevent")
        .find((item) => recurrenceDate(item) === occurrence)
    : master;
  if (!component) {
    component = new ICAL.Component(structuredClone(master.toJSON()));
    component.removeAllProperties("rrule");
    component.removeAllProperties("rdate");
    component.removeAllProperties("exdate");
    component.updatePropertyWithValue(
      "recurrence-id",
      occurrence.length === 10
        ? ICAL.Time.fromDateString(occurrence)
        : ICAL.Time.fromJSDate(new Date(occurrence), true),
    );
    root.addSubcomponent(component);
  }
  if (deleting) component.updatePropertyWithValue("status", "CANCELLED");
  else {
    const target = new ICAL.Event(component);
    target.summary = event.title;
    target.description = event.description;
    target.location = event.location;
    target.startDate = event.allDay
      ? ICAL.Time.fromDateString(event.start)
      : ICAL.Time.fromJSDate(new Date(event.start), true);
    target.endDate = event.allDay
      ? ICAL.Time.fromDateString(event.end)
      : ICAL.Time.fromJSDate(new Date(event.end), true);
    if (changeReminder) {
      for (const alarm of component.getAllSubcomponents("valarm")) {
        if (alarm.getFirstPropertyValue("action") === "DISPLAY")
          component.removeSubcomponent(alarm);
      }
      if (event.reminder >= 0) {
        const alarm = new ICAL.Component("valarm");
        alarm.addPropertyWithValue("action", "DISPLAY");
        alarm.addPropertyWithValue("description", event.title);
        alarm.addPropertyWithValue(
          "trigger",
          ICAL.Duration.fromSeconds(-event.reminder * 60),
        );
        component.addSubcomponent(alarm);
      }
    }
  }
  component.updatePropertyWithValue(
    "dtstamp",
    ICAL.Time.fromJSDate(new Date(), true),
  );
  component.updatePropertyWithValue(
    "sequence",
    Number(component.getFirstPropertyValue("sequence") || 0) + 1,
  );
  return root.toString();
}

export class CalDAVClient implements RemoteCalendarClient {
  private endpoint: URL;
  private client?: Awaited<ReturnType<typeof createDAVClient>>;
  constructor(
    private connection: Connection,
    private request: typeof fetch = fetch,
  ) {
    this.endpoint = checkedUrl(connection.url);
  }

  private target(value: string | URL) {
    const target = checkedUrl(String(value));
    const appleShard =
      this.endpoint.hostname === "caldav.icloud.com" &&
      /^p\d+-caldav\.icloud\.com$/.test(target.hostname) &&
      !target.port;
    if (target.origin !== this.endpoint.origin && !appleShard)
      throw new Error("CalDAV 返回了其他服务器地址，请核对连接配置");
    return target;
  }

  private async call(value: string | URL, options: RequestInit = {}) {
    return this.request(this.target(value), {
      ...options,
      redirect: options.redirect === "manual" ? "manual" : "error",
      signal: AbortSignal.timeout(30_000),
      headers: {
        Authorization: `Basic ${Buffer.from(`${this.connection.username}:${this.connection.password}`).toString("base64")}`,
        ...options.headers,
      },
    });
  }

  private async dav() {
    this.client ||= await createDAVClient({
      serverUrl: this.endpoint.href,
      credentials: {
        username: this.connection.username,
        password: this.connection.password,
      },
      authMethod: "Basic",
      defaultAccountType: "caldav",
      fetch: (url, options) => this.call(String(url), options),
    });
    return this.client;
  }

  async calendars(): Promise<CalendarSource[]> {
    const calendars = await (
      await this.dav()
    ).fetchCalendars({
      props: {
        "d:displayname": {},
        "ca:calendar-color": {},
        "d:current-user-privilege-set": {},
      },
      projectedProps: { currentUserPrivilegeSet: true },
    });
    return calendars
      .filter(
        (calendar) =>
          !calendar.components?.length ||
          calendar.components.includes("VEVENT"),
      )
      .map((calendar) => {
        const privileges = calendar.projectedProps?.currentUserPrivilegeSet;
        const canWrite =
          privileges === undefined ||
          /"(?:write|writeContent|all)"/.test(JSON.stringify(privileges));
        return {
          id: `caldav:${this.connection.id}:${calendar.url}`,
          connectionId: this.connection.id,
          remoteId: calendar.url,
          provider: "caldav",
          name: String(calendar.displayName || this.connection.name),
          color:
            typeof calendar.calendarColor === "string"
              ? calendar.calendarColor.slice(0, 7)
              : "#23a58d",
          visible: true,
          writable: this.connection.readOnly === false && canWrite,
        };
      });
  }

  private async parse(
    data: string,
    calendar: CalendarSource,
    range: DateRange,
    url: string,
    etag?: string,
  ) {
    const events = await parseSubscription(data, calendar.id, range, {
      url,
      etag,
    });
    for (const event of events) {
      event.id = `${calendar.id}/${event.remoteId}`;
      event.remoteFingerprint = contentFingerprint(event, "caldav");
    }
    return events;
  }

  async events(calendar: CalendarSource, range: DateRange) {
    const objects = await (
      await this.dav()
    ).fetchCalendarObjects({
      calendar: { url: calendar.remoteId! },
      timeRange: range,
    });
    const events: CalendarEvent[] = [];
    for (const object of objects) {
      if (object.data)
        events.push(
          ...(await this.parse(
            String(object.data),
            calendar,
            range,
            object.url,
            object.etag,
          )),
        );
    }
    return events;
  }

  private async read(remoteId: string) {
    const { url } = resourceId(remoteId);
    const response = await this.call(url);
    if (response.status === 404) return undefined;
    if (!response.ok)
      throw new Error(`CalDAV 读取失败（HTTP ${response.status}）`);
    const data = await response.text();
    if (Buffer.byteLength(data) > 2_000_000)
      throw new Error("CalDAV 日程对象过大");
    return {
      data,
      url: url.href,
      etag: response.headers.get("etag") || undefined,
    };
  }

  async get(
    calendar: CalendarSource,
    remoteId: string,
  ): Promise<CalendarEvent> {
    const resource = await this.read(remoteId);
    if (!resource) return deletedEvent(calendar, remoteId);
    const { occurrence } = resourceId(remoteId);
    const parsed = await ical.async.parseICS(resource.data);
    const master = Object.values(parsed).find(
      (item) => item?.type === "VEVENT",
    );
    if (!master || master.type !== "VEVENT")
      throw new Error("CalDAV 日程格式无效");
    const exception = occurrence ? master.recurrences?.[occurrence] : undefined;
    const start =
      exception?.start instanceof Date
        ? exception.start
        : occurrence
          ? new Date(occurrence)
          : master.start;
    const events = await this.parse(
      resource.data,
      calendar,
      {
        start: new Date(start.getTime() - 86400_000).toISOString(),
        end: new Date(start.getTime() + 2 * 86400_000).toISOString(),
      },
      resource.url,
      resource.etag,
    );
    return (
      events.find((event) => event.remoteId === remoteId) ||
      deletedEvent(calendar, remoteId)
    );
  }

  async create(calendar: CalendarSource, event: CalendarEvent, key: string) {
    const url = new URL(`${key}.ics`, calendar.remoteId!.replace(/\/?$/, "/"));
    const data = exportICS([{ ...event, id: key, deleted: false }]);
    const response = await this.call(url, {
      method: "PUT",
      headers: {
        "Content-Type": "text/calendar; charset=utf-8",
        "If-None-Match": "*",
      },
      body: data,
    });
    if (!response.ok && response.status !== 412)
      throw new Error(`CalDAV 新建失败（HTTP ${response.status}）`);
    const id =
      url.href +
      (event.recurrence
        ? `#${encodeURIComponent(event.allDay ? event.start : new Date(event.start).toISOString())}`
        : "");
    const remote = await this.get(calendar, id);
    if (remote.deleted) throw new Error("CalDAV 写入后回读失败，请稍后重试");
    return remote;
  }

  private async write(
    event: CalendarEvent,
    remote: CalendarEvent,
    deleting: boolean,
  ) {
    const resource = await this.read(event.remoteId!);
    if (!resource) throw new Error("云端日程已删除，请再次同步以处理冲突");
    if (!remote.remoteEtag || resource.etag !== remote.remoteEtag)
      throw new Error("云端日程已变化，请再次同步以处理冲突");
    const { occurrence } = resourceId(event.remoteId!);
    const response = await this.call(resource.url, {
      method: deleting && !occurrence ? "DELETE" : "PUT",
      headers: {
        "If-Match": remote.remoteEtag,
        "Content-Type": "text/calendar; charset=utf-8",
      },
      ...(deleting && !occurrence
        ? {}
        : {
            body: updateCalendarData(
              resource.data,
              event,
              occurrence,
              deleting,
              event.reminder !== remote.reminder,
            ),
          }),
    });
    if (!response.ok)
      throw new Error(`CalDAV 写入失败（HTTP ${response.status}），可重新同步`);
  }

  async update(
    calendar: CalendarSource,
    event: CalendarEvent,
    remote: CalendarEvent,
  ) {
    await this.write(event, remote, false);
    return this.get(calendar, event.remoteId!);
  }

  async delete(
    calendar: CalendarSource,
    remoteId: string,
    remote?: CalendarEvent,
  ) {
    const current = remote || (await this.get(calendar, remoteId));
    if (current.deleted) return;
    await this.write(current, current, true);
  }

  async deleteCreated(_calendar: CalendarSource, remote: CalendarEvent) {
    if (!remote.remoteEtag)
      throw new Error("CalDAV 日程缺少 ETag，无法安全删除");
    const { url } = resourceId(remote.remoteId!);
    const response = await this.call(url, {
      method: "DELETE",
      headers: { "If-Match": remote.remoteEtag },
    });
    if (!response.ok && response.status !== 404)
      throw new Error(`CalDAV 删除失败（HTTP ${response.status}）`);
  }
}
