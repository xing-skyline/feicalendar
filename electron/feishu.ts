import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import type {
  AuthStatus,
  CalendarEvent,
  CalendarSource,
  DateRange,
} from "../src/shared/types";
import { shiftDate, TIME_ZONE } from "../src/shared/dates";

export interface RemoteEvent {
  event_id: string;
  summary?: string;
  description?: string;
  description_rich?: string;
  start_time: { date?: string; timestamp?: string };
  end_time: { date?: string; timestamp?: string };
  location?: { name?: string };
  reminders?: { minutes: number }[];
  recurrence?: string;
  recurring_event_id?: string;
  app_link?: string;
  status?: string;
  is_exception?: boolean;
}

export function fingerprint(event: CalendarEvent): string {
  const start = event.allDay
    ? event.start
    : new Date(event.start).toISOString();
  const end = event.allDay ? event.end : new Date(event.end).toISOString();
  return createHash("sha256")
    .update(
      JSON.stringify([
        event.title,
        start,
        end,
        event.allDay,
        event.description,
        event.location,
      ]),
    )
    .digest("hex");
}

export function fromFeishu(
  remote: RemoteEvent,
  calendarId: string,
): CalendarEvent {
  const allDay = Boolean(remote.start_time.date);
  const event: CalendarEvent = {
    id: `${calendarId}/${remote.event_id}`,
    calendarId,
    remoteId: remote.event_id,
    title: remote.summary || "未命名日程",
    start: allDay
      ? remote.start_time.date!
      : new Date(Number(remote.start_time.timestamp) * 1000).toISOString(),
    // Feishu uses an inclusive end date. FullCalendar and RFC 5545 use an exclusive end.
    end: allDay
      ? shiftDate(remote.end_time.date!, 1)
      : new Date(Number(remote.end_time.timestamp) * 1000).toISOString(),
    allDay,
    description: remote.description_rich || remote.description || "",
    location: remote.location?.name || "",
    reminder: remote.reminders?.[0]?.minutes ?? -1,
    recurrence: "",
    recurring: Boolean(
      remote.recurrence ||
      remote.recurring_event_id ||
      /_[1-9]\d*$/.test(remote.event_id),
    ),
    completed: false,
    syncState: "synced",
    url: remote.app_link,
    deleted: remote.status === "cancelled",
  };
  event.remoteFingerprint = fingerprint(event);
  return event;
}

export function toFeishu(event: CalendarEvent, creating = false) {
  const time = (value: string) =>
    event.allDay
      ? { date: value }
      : {
          timestamp: String(Math.floor(new Date(value).getTime() / 1000)),
          timezone: TIME_ZONE,
        };
  return {
    summary: event.title,
    description: event.description,
    start_time: time(event.start),
    end_time: time(event.allDay ? shiftDate(event.end, -1) : event.end),
    ...(event.location || !creating
      ? { location: { name: event.location } }
      : {}),
    ...(creating
      ? {
          ...(event.recurrence ? { recurrence: event.recurrence } : {}),
          reminders: event.reminder < 0 ? [] : [{ minutes: event.reminder }],
          vchat: { vc_type: "no_meeting" },
        }
      : {}),
  };
}

export class FeishuClient {
  constructor(private binary: string) {}

  call<T = Record<string, unknown>>(
    args: string[],
    body?: unknown,
    timeout = 45_000,
    stdinText?: string,
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const formatArgs = args[0] === "config" ? [] : ["--json"];
      const process = spawn(
        this.binary,
        [
          ...args,
          ...formatArgs,
          ...(body === undefined ? [] : ["--data", "-"]),
        ],
        {
          windowsHide: true,
          shell: false,
          env: {
            ...globalThis.process.env,
            LARKSUITE_CLI_NO_UPDATE_NOTIFIER: "1",
            LARKSUITE_CLI_NO_SKILLS_NOTIFIER: "1",
          },
          stdio: ["pipe", "pipe", "pipe"],
        },
      );
      let stdout = "";
      let stderr = "";
      const timer = setTimeout(() => {
        process.kill();
        reject(new Error("飞书请求超时，修改已保存在本地，可稍后重试。"));
      }, timeout);
      process.stdout.on("data", (data) => {
        stdout += data;
      });
      process.stderr.on("data", (data) => {
        stderr += data;
      });
      process.on("error", () => {
        clearTimeout(timer);
        reject(new Error("无法启动飞书连接组件，请检查应用安装。"));
      });
      process.on("close", (code) => {
        clearTimeout(timer);
        try {
          const output = code === 0 ? stdout : stderr;
          const first = output.indexOf("{");
          const last = output.lastIndexOf("}");
          const parsed = JSON.parse(output.slice(first, last + 1));
          if (code !== 0 || parsed.ok === false) {
            const message =
              parsed.error?.message || parsed.message || "飞书请求失败";
            reject(
              new Error(
                `${message}${parsed.error?.missing_scopes ? "，请在连接设置中重新授权日历权限" : ""}`,
              ),
            );
            return;
          }
          resolve((parsed.ok === true ? parsed.data : parsed) as T);
        } catch {
          reject(
            new Error(
              code === 10
                ? "飞书要求额外确认，请到飞书客户端完成此操作。"
                : "飞书连接失败，请在连接设置中检查登录状态。",
            ),
          );
        }
      });
      process.stdin.on("error", () => {});
      process.stdin.end(
        stdinText ?? (body === undefined ? undefined : JSON.stringify(body)),
      );
    });
  }

  async authStatus(): Promise<AuthStatus> {
    try {
      const result = await this.call<{
        identities?: {
          user?: { available?: boolean; userName?: string; message?: string };
        };
      }>(["auth", "status"]);
      if (
        globalThis.process.env.FEICALENDAR_DATA_DIR &&
        globalThis.process.env.FEICALENDAR_ALLOW_REAL_FEISHU !== "1"
      ) {
        return {
          available: false,
          message: "飞书用户授权已过期或尚未登录",
        };
      }
      const user = result.identities?.user;
      return {
        available: Boolean(user?.available),
        name: user?.userName,
        message: user?.available
          ? "已连接飞书账号"
          : "飞书用户授权已过期或尚未登录",
      };
    } catch (error) {
      return { available: false, message: (error as Error).message };
    }
  }

  async calendars(): Promise<CalendarSource[]> {
    const calendars: CalendarSource[] = [];
    let token: string | undefined;
    do {
      const data = await this.call<{
        calendar_list?: Array<{
          calendar_id: string;
          summary: string;
          summary_alias?: string;
          color?: number;
          role: string;
          is_deleted?: boolean;
        }>;
        has_more?: boolean;
        page_token?: string;
      }>([
        "calendar",
        "calendars",
        "list",
        "--as",
        "user",
        "--page-size",
        "1000",
        ...(token ? ["--page-token", token] : []),
      ]);
      for (const calendar of data.calendar_list ?? []) {
        if (calendar.is_deleted) continue;
        calendars.push({
          id: `feishu:${calendar.calendar_id}`,
          name: calendar.summary_alias || calendar.summary,
          remoteId: calendar.calendar_id,
          provider: "feishu",
          visible: true,
          writable: ["owner", "writer"].includes(calendar.role),
          color:
            calendar.color && calendar.color > 0
              ? `#${(calendar.color & 0xffffff).toString(16).padStart(6, "0")}`
              : "#5474ee",
        });
      }
      token = data.has_more ? data.page_token : undefined;
      if (data.has_more && !token) throw new Error("飞书日历分页响应缺少游标");
    } while (token);
    return calendars;
  }

  async events(
    calendar: CalendarSource,
    range: DateRange,
  ): Promise<CalendarEvent[]> {
    const events = new Map<string, CalendarEvent>();
    let start = new Date(range.start).getTime();
    const end = new Date(range.end).getTime();
    while (start < end) {
      const next = Math.min(start + 30 * 86400_000, end);
      const data = await this.call<{ items?: RemoteEvent[] }>([
        "calendar",
        "events",
        "instance_view",
        "--as",
        "user",
        "--calendar-id",
        calendar.remoteId!,
        "--start-time",
        String(Math.floor(start / 1000)),
        "--end-time",
        String(Math.floor(next / 1000)),
      ]);
      for (const remote of data.items ?? []) {
        const event = fromFeishu(remote, calendar.id);
        if (!event.deleted) events.set(event.id, event);
      }
      start = next;
    }
    return [...events.values()];
  }

  async get(
    calendar: CalendarSource,
    remoteId: string,
  ): Promise<CalendarEvent> {
    const result = await this.call<{ event: RemoteEvent }>([
      "calendar",
      "events",
      "get",
      "--as",
      "user",
      "--calendar-id",
      calendar.remoteId!,
      "--event-id",
      remoteId,
    ]);
    return fromFeishu(result.event, calendar.id);
  }

  async create(calendar: CalendarSource, event: CalendarEvent, key: string) {
    const result = await this.call<{ event: RemoteEvent }>(
      [
        "calendar",
        "events",
        "create",
        "--as",
        "user",
        "--calendar-id",
        calendar.remoteId!,
        "--idempotency-key",
        key,
      ],
      toFeishu(event, true),
    );
    return fromFeishu(result.event, calendar.id);
  }

  async update(
    calendar: CalendarSource,
    event: CalendarEvent,
    previous: CalendarEvent,
  ) {
    const full = toFeishu(event);
    const payload: Record<string, unknown> = {};
    if (event.title !== previous.title) payload.summary = event.title;
    if (event.description !== previous.description)
      payload.description = event.description;
    if (
      new Date(event.start).getTime() !== new Date(previous.start).getTime() ||
      new Date(event.end).getTime() !== new Date(previous.end).getTime() ||
      event.allDay !== previous.allDay
    ) {
      payload.start_time = full.start_time;
      payload.end_time = full.end_time;
    }
    if (event.location !== previous.location)
      payload.location = event.location ? { name: event.location } : {};
    const result = await this.call<{ event: RemoteEvent }>(
      [
        "calendar",
        "events",
        "patch",
        "--as",
        "user",
        "--calendar-id",
        calendar.remoteId!,
        "--event-id",
        event.remoteId!,
      ],
      payload,
    );
    return fromFeishu(result.event, calendar.id);
  }

  async delete(calendar: CalendarSource, remoteId: string) {
    await this.call([
      "calendar",
      "events",
      "delete",
      "--as",
      "user",
      "--calendar-id",
      calendar.remoteId!,
      "--event-id",
      remoteId,
    ]);
  }
}
