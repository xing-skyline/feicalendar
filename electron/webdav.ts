import { z } from "zod";
import type {
  CalendarEvent,
  CalendarSource,
  Connection,
  DateRange,
  TeachingSettings,
} from "../src/shared/types";
import { checkedUrl } from "./subscriptions";
import {
  contentFingerprint,
  deletedEvent,
  type RemoteCalendarClient,
} from "./remote-calendar";

const date = z
  .string()
  .max(40)
  .refine((value) => Number.isFinite(new Date(value).getTime()));
const cloudEventSchema = z.object({
  title: z.string().max(1000),
  start: date,
  end: date,
  allDay: z.boolean(),
  description: z.string().max(20_000),
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
  exceptions: z.array(date).max(5000).optional(),
  deleted: z.boolean().optional(),
});
export const teachingSchema = z.object({
  teachingStartDate: z.union([z.literal(""), z.iso.date()]),
  teachingWeeks: z.number().int().min(1).max(104),
  weekStartsOn: z.union([z.literal(0), z.literal(1), z.literal(6)]),
});
const documentSchema = z.object({
  version: z.literal(1),
  events: z.record(z.string().regex(/^[a-zA-Z0-9-]{1,100}$/), cloudEventSchema),
  teaching: teachingSchema.optional(),
});
type CloudDocument = z.infer<typeof documentSchema>;

export class WebDAVClient implements RemoteCalendarClient {
  private folder: URL;
  private file: URL;
  constructor(
    private connection: Connection,
    private request: typeof fetch = fetch,
  ) {
    const base = checkedUrl(connection.url);
    if (base.search || base.hash)
      throw new Error("WebDAV 地址请使用文件夹地址");
    if (!base.pathname.endsWith("/")) base.pathname += "/";
    this.folder = new URL("FeiCalendar/", base);
    this.file = new URL("calendar-v1.json", this.folder);
  }

  private async call(url: URL, options: RequestInit = {}) {
    return this.request(url, {
      ...options,
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
      headers: {
        Authorization: `Basic ${Buffer.from(`${this.connection.username}:${this.connection.password}`).toString("base64")}`,
        ...options.headers,
      },
    });
  }

  private async read(): Promise<{ document: CloudDocument; etag?: string }> {
    const response = await this.call(this.file);
    if (response.status === 404)
      return { document: { version: 1, events: {} } };
    if (!response.ok)
      throw new Error(`WebDAV 读取失败（HTTP ${response.status}）`);
    const text = await response.text();
    if (Buffer.byteLength(text) > 20_000_000)
      throw new Error("云端日历超过 20 MB");
    const etag = response.headers.get("etag");
    if (!etag || etag.startsWith("W/"))
      throw new Error("此 WebDAV 服务未提供强 ETag，无法安全合并多端修改");
    const result = documentSchema.safeParse(JSON.parse(text));
    if (!result.success) throw new Error("云端日历格式无效，请检查同步目录");
    return { document: result.data, etag };
  }

  private async modify(
    operation: (document: CloudDocument) => boolean,
  ): Promise<void> {
    for (let attempt = 0; attempt < 4; attempt++) {
      const { document, etag } = await this.read();
      if (!operation(document)) return;
      if (!etag) {
        const folder = await this.call(this.folder, { method: "MKCOL" });
        if (!folder.ok && folder.status !== 405)
          throw new Error(`WebDAV 创建同步目录失败（HTTP ${folder.status}）`);
      }
      const response = await this.call(this.file, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          ...(etag ? { "If-Match": etag } : { "If-None-Match": "*" }),
        },
        body: JSON.stringify(document),
      });
      if (response.status === 412) continue;
      if (!response.ok)
        throw new Error(`WebDAV 写入失败（HTTP ${response.status}）`);
      return;
    }
    throw new Error("其他设备正在修改云端日历，请稍后重试同步");
  }

  private event(
    calendar: CalendarSource,
    remoteId: string,
    value: z.infer<typeof cloudEventSchema>,
  ): CalendarEvent {
    const event: CalendarEvent = {
      ...value,
      id: `${calendar.id}/${remoteId}`,
      calendarId: calendar.id,
      remoteId,
      syncState: "synced",
    };
    event.remoteFingerprint = contentFingerprint(event, "webdav");
    return event;
  }

  async calendars(): Promise<CalendarSource[]> {
    await this.read();
    return [
      {
        id: `webdav:${this.connection.id}`,
        remoteId: "calendar-v1",
        connectionId: this.connection.id,
        provider: "webdav",
        name: this.connection.name,
        color: "#8b6bd1",
        visible: true,
        writable: true,
      },
    ];
  }

  async events(calendar: CalendarSource, _range: DateRange) {
    const { document } = await this.read();
    return Object.entries(document.events).map(([id, value]) =>
      this.event(calendar, id, value),
    );
  }

  async get(calendar: CalendarSource, remoteId: string) {
    const { document } = await this.read();
    const value = document.events[remoteId];
    return value
      ? this.event(calendar, remoteId, value)
      : deletedEvent(calendar, remoteId);
  }

  async create(calendar: CalendarSource, event: CalendarEvent, key: string) {
    const value = cloudEventSchema.parse({ ...event, deleted: false });
    await this.modify((document) => {
      const existing = document.events[key];
      if (existing) return false;
      document.events[key] = value;
      return true;
    });
    return this.get(calendar, key);
  }

  async update(
    calendar: CalendarSource,
    event: CalendarEvent,
    remote: CalendarEvent,
  ) {
    const remoteId = event.remoteId!;
    const value = cloudEventSchema.parse(event);
    await this.modify((document) => {
      const existing = document.events[remoteId];
      const current = existing
        ? this.event(calendar, remoteId, existing)
        : deletedEvent(calendar, remoteId);
      if (
        contentFingerprint(current, "webdav") ===
        contentFingerprint(event, "webdav")
      )
        return false;
      if (
        contentFingerprint(current, "webdav") !==
        contentFingerprint(remote, "webdav")
      )
        throw new Error("云端日程已变化，请再次同步以处理冲突");
      document.events[remoteId] = value;
      return true;
    });
    return this.get(calendar, remoteId);
  }

  async delete(
    calendar: CalendarSource,
    remoteId: string,
    remote?: CalendarEvent,
  ) {
    await this.modify((document) => {
      const existing = document.events[remoteId];
      if (!existing || existing.deleted) return false;
      if (
        !remote ||
        contentFingerprint(
          this.event(calendar, remoteId, existing),
          "webdav",
        ) !== contentFingerprint(remote, "webdav")
      )
        throw new Error("云端日程已变化，请再次同步以处理冲突");
      document.events[remoteId] = { ...existing, deleted: true };
      return true;
    });
  }

  async syncTeaching(
    local: TeachingSettings,
    base?: TeachingSettings,
    choice?: "local" | "remote",
  ) {
    let value = local;
    let conflict: TeachingSettings | undefined;
    const equal = (
      left: TeachingSettings | undefined,
      right: TeachingSettings | undefined,
    ) => JSON.stringify(left) === JSON.stringify(right);
    await this.modify((document) => {
      const remote = document.teaching;
      if (choice === "remote") {
        value = remote || local;
        return false;
      }
      if (choice === "local") {
        document.teaching = local;
        return !equal(remote, local);
      }
      if (equal(remote, local)) return false;
      if (!remote || equal(remote, base)) {
        document.teaching = local;
        return true;
      }
      if (equal(local, base) || (!base && !local.teachingStartDate)) {
        value = remote;
        return false;
      }
      conflict = remote;
      return false;
    });
    return { value, conflict };
  }
}
