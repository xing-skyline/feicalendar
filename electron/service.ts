import { randomUUID } from "node:crypto";
import type {
  AppSnapshot,
  CalendarEvent,
  CalendarSource,
  Connection,
  DateRange,
  EventSave,
  Settings,
} from "../src/shared/types";
import { overlaps } from "../src/shared/dates";
import { fingerprint, FeishuClient } from "./feishu";
import { checkedUrl, fetchSubscription } from "./subscriptions";
import { Store } from "./store";

export interface Vault {
  read(id: string): Promise<Connection | undefined>;
  write(connection: Connection): Promise<void>;
  remove(id: string): Promise<void>;
}

export class CalendarService {
  private tail: Promise<unknown> = Promise.resolve();
  constructor(
    readonly store: Store,
    readonly feishu: FeishuClient,
    private vault: Vault,
    private changed: (snapshot: AppSnapshot) => void = () => {},
  ) {}

  exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.tail.then(operation, operation);
    this.tail = next.catch(() => {});
    return next;
  }

  async snapshot(): Promise<AppSnapshot> {
    const state = structuredClone(this.store.state);
    state.connections = await Promise.all(
      state.connections.map(async (connection) => {
        try {
          const secret = await this.vault.read(connection.id);
          return {
            ...connection,
            url: secret?.url || "",
            username: secret?.username || "",
            hasPassword: Boolean(secret?.password),
          };
        } catch {
          return {
            ...connection,
            error:
              "当前 Windows 账号无法读取订阅凭据，请使用保存连接时的系统账号。",
          };
        }
      }),
    );
    return state;
  }

  private async commit() {
    await this.store.save();
    const snapshot = await this.snapshot();
    this.changed(snapshot);
    return snapshot;
  }

  private calendar(id: string) {
    const calendar = this.store.state.calendars.find((item) => item.id === id);
    if (!calendar) throw new Error("找不到所属日历");
    return calendar;
  }

  private enqueue(
    event: CalendarEvent,
    action: "create" | "update" | "delete",
    base?: string,
  ) {
    const existing = this.store.state.queue.find(
      (item) => item.eventId === event.id,
    );
    if (existing) {
      if (existing.action === "create" && action === "delete") {
        // A failed create may have reached Feishu. Keep the same idempotency key and
        // create then delete on retry, so an uncertain response cannot leave an orphan.
        event.deleted = true;
      } else if (existing.action !== "create") existing.action = action;
      existing.status = "pending";
      existing.error = undefined;
    } else {
      this.store.state.queue.push({
        id: randomUUID(),
        eventId: event.id,
        action,
        status: "pending",
        baseFingerprint: base,
      });
    }
    event.syncState = "pending";
    event.error = undefined;
  }

  async saveEvent({ event: input, scope }: EventSave) {
    let event = structuredClone(input);
    const calendar = this.calendar(event.calendarId);
    if (!calendar.writable)
      throw new Error("此日历为订阅日历，请选择本地或可写入的飞书日历");
    let previous = this.store.state.events.find((item) => item.id === event.id);
    if (previous?.recurrence && !event.seriesId && scope !== "all")
      throw new Error("请选择整个重复系列，单次修改请从日历中打开具体日期");
    if (event.seriesId) {
      const master = this.store.state.events.find(
        (item) => item.id === event.seriesId,
      );
      if (!master || !scope) throw new Error("请选择重复日程的修改范围");
      if (master.remoteId)
        throw new Error("请先同步重复日程，再编辑展开后的具体日程");
      if (scope === "all") {
        const timeShift =
          new Date(event.start).getTime() -
          new Date(event.occurrenceStart!).getTime();
        const duration =
          new Date(event.end).getTime() - new Date(event.start).getTime();
        const start = new Date(new Date(master.start).getTime() + timeShift);
        event = {
          ...event,
          id: master.id,
          seriesId: undefined,
          occurrenceStart: undefined,
          start: event.allDay
            ? start.toISOString().slice(0, 10)
            : start.toISOString(),
          end: event.allDay
            ? new Date(start.getTime() + duration).toISOString().slice(0, 10)
            : new Date(start.getTime() + duration).toISOString(),
          exceptions: master.exceptions,
        };
        previous = master;
      } else {
        if (calendar.provider !== "local")
          throw new Error("请先同步新建的重复日程，再修改单次日程");
        master.exceptions = [
          ...new Set([...(master.exceptions || []), event.occurrenceStart!]),
        ];
        event = {
          ...event,
          id: randomUUID(),
          recurrence: "",
          recurring: false,
          seriesId: undefined,
          occurrenceStart: undefined,
        };
        previous = undefined;
      }
    }
    if (previous && previous.calendarId !== event.calendarId)
      throw new Error(
        "已保存日程的所属日历不能直接更换，请复制日程后选择目标日历",
      );
    if (event.remoteId && event.recurring && scope !== "single")
      throw new Error("飞书重复日程请选择“仅此次”，系列管理可在飞书中打开");
    event.id ||= randomUUID();
    event.title = event.title.trim();
    event.remoteId = previous?.remoteId;
    event.remoteFingerprint = previous?.remoteFingerprint;
    event.syncState = calendar.provider === "local" ? "local" : "pending";
    event.deleted = false;
    if (calendar.provider === "feishu")
      this.enqueue(
        event,
        previous?.remoteId ? "update" : "create",
        previous?.remoteFingerprint,
      );
    this.store.state.events = this.store.state.events.filter(
      (item) => item.id !== event.id,
    );
    this.store.state.events.push(event);
    return this.commit();
  }

  async deleteEvent(id: string, scope?: "single" | "all") {
    const [masterId, occurrenceStart] = id.split("::");
    const event = this.store.state.events.find((item) => item.id === masterId);
    if (!event) throw new Error("日程已不存在");
    if (!this.calendar(event.calendarId).writable)
      throw new Error("订阅日程为只读");
    if ((event.recurrence || event.recurring) && !scope)
      throw new Error("请选择重复日程的删除范围");
    if (event.recurrence && !occurrenceStart && scope === "single")
      throw new Error("单次删除请从日历中打开具体日期");
    if (occurrenceStart && scope === "single") {
      if (this.calendar(event.calendarId).provider !== "local")
        throw new Error("请先同步新建的重复日程");
      event.exceptions = [
        ...new Set([...(event.exceptions || []), occurrenceStart]),
      ];
      return this.commit();
    }
    if (event.remoteId && event.recurring && scope !== "single")
      throw new Error("飞书系列日程请在飞书中删除整个系列");
    if (
      event.remoteId ||
      this.store.state.queue.some((item) => item.eventId === event.id)
    ) {
      event.deleted = true;
      this.enqueue(event, "delete", event.remoteFingerprint);
    } else
      this.store.state.events = this.store.state.events.filter(
        (item) => item.id !== event.id,
      );
    return this.commit();
  }

  async saveCalendar(input: Partial<CalendarSource> & { name: string }) {
    this.store.state.calendars.push({
      id: randomUUID(),
      name: input.name.trim(),
      color: input.color || "#5474ee",
      provider: "local",
      visible: true,
      writable: true,
    });
    return this.commit();
  }

  async updateCalendar(
    id: string,
    patch: { visible?: boolean; color?: string; name?: string },
  ) {
    Object.assign(this.calendar(id), patch);
    return this.commit();
  }

  async publishCalendar(id: string, targetId: string) {
    const source = this.calendar(id);
    const target = this.calendar(targetId);
    if (
      source.provider !== "local" ||
      target.provider !== "feishu" ||
      !target.writable
    )
      throw new Error("请选择本地来源日历和可写入的飞书目标日历");
    for (const event of this.store.state.events.filter(
      (item) => item.calendarId === id && !item.deleted,
    )) {
      if (event.exceptions?.length)
        throw new Error(
          "此日历含已修改单次的重复日程，请先分别整理重复系列再迁移",
        );
    }
    for (const event of this.store.state.events.filter(
      (item) => item.calendarId === id && !item.deleted,
    )) {
      event.calendarId = targetId;
      this.enqueue(event, "create");
    }
    this.store.state.settings.defaultCalendarId = targetId;
    return this.commit();
  }

  async settings(patch: Partial<Settings>) {
    if (
      patch.defaultCalendarId &&
      !this.calendar(patch.defaultCalendarId).writable
    )
      throw new Error("默认日历必须具有写入权限");
    Object.assign(this.store.state.settings, patch);
    return this.commit();
  }

  async saveConnection(input: Connection) {
    checkedUrl(input.url);
    const connection = { ...input, id: input.id || randomUUID() };
    const previous = await this.vault.read(connection.id);
    connection.password ||= previous?.password;
    if (
      connection.kind === "caldav" &&
      (!connection.username || !connection.password)
    )
      throw new Error("请填写 CalDAV 用户名和密码");
    await this.vault.write(connection);
    this.store.state.connections = this.store.state.connections.filter(
      (item) => item.id !== connection.id,
    );
    this.store.state.connections.push({
      id: connection.id,
      kind: connection.kind,
      name: connection.name,
      url: "",
      username: "",
    });
    return this.commit();
  }

  async removeConnection(id: string) {
    const ids = this.store.state.calendars
      .filter((item) => item.connectionId === id)
      .map((item) => item.id);
    this.store.state.calendars = this.store.state.calendars.filter(
      (item) => item.connectionId !== id,
    );
    this.store.state.events = this.store.state.events.filter(
      (item) => !ids.includes(item.calendarId),
    );
    this.store.state.connections = this.store.state.connections.filter(
      (item) => item.id !== id,
    );
    await this.vault.remove(id);
    return this.commit();
  }

  private mergeCalendar(calendar: CalendarSource) {
    const previous = this.store.state.calendars.find(
      (item) => item.id === calendar.id,
    );
    if (previous)
      Object.assign(previous, calendar, {
        visible: previous.visible,
        color: previous.color,
      });
    else this.store.state.calendars.push(calendar);
  }

  private mergeEvents(
    calendarId: string,
    incoming: CalendarEvent[],
    range: DateRange,
  ) {
    const protectedIds = new Set(
      this.store.state.queue.map((item) => item.eventId),
    );
    const previous = this.store.state.events.filter(
      (item) => item.calendarId === calendarId,
    );
    const byRemoteId = new Map(
      previous
        .filter((item) => item.remoteId)
        .map((item) => [item.remoteId, item]),
    );
    const mapped = incoming.map((event) => {
      const old = byRemoteId.get(event.remoteId);
      return old
        ? {
            ...event,
            id: old.id,
            completed: old.completed,
            reminder: old.reminder,
          }
        : event;
    });
    const incomingIds = new Set(mapped.map((item) => item.id));
    this.store.state.events = this.store.state.events.filter(
      (item) =>
        item.calendarId !== calendarId ||
        protectedIds.has(item.id) ||
        (!incomingIds.has(item.id) && !overlaps(item.start, item.end, range)),
    );
    this.store.state.events.push(
      ...mapped.filter((item) => !protectedIds.has(item.id)),
    );
  }

  private async pushQueue() {
    for (const change of [...this.store.state.queue]) {
      if (change.status === "conflict") continue;
      const event = this.store.state.events.find(
        (item) => item.id === change.eventId,
      );
      if (!event) throw new Error("待同步记录丢失，请从本地备份恢复");
      const calendar = this.calendar(event.calendarId);
      try {
        let remote: CalendarEvent | undefined;
        if (change.action === "create") {
          remote = await this.feishu.create(calendar, event, change.id);
          if (event.deleted)
            await this.feishu.delete(calendar, remote.remoteId!);
        } else {
          remote = await this.feishu.get(calendar, event.remoteId!);
          if (remote.deleted && change.action === "delete") {
            this.store.state.events = this.store.state.events.filter(
              (item) => item.id !== event.id,
            );
          } else if (
            change.action === "update" &&
            fingerprint(remote) === fingerprint(event)
          ) {
            // A previous successful write can be retried after its response was lost.
          } else if (
            remote.deleted ||
            (change.baseFingerprint &&
              fingerprint(remote) !== change.baseFingerprint)
          ) {
            change.status = "conflict";
            change.remote = remote;
            change.error = "飞书上的日程已变化，请选择保留的版本";
            event.syncState = "conflict";
            event.error = change.error;
            await this.commit();
            continue;
          } else if (change.action === "delete")
            await this.feishu.delete(calendar, event.remoteId!);
          else remote = await this.feishu.update(calendar, event, remote);
        }
        if (event.deleted)
          this.store.state.events = this.store.state.events.filter(
            (item) => item.id !== event.id,
          );
        else
          Object.assign(event, {
            remoteId: remote!.remoteId,
            remoteFingerprint: remote!.remoteFingerprint,
            syncState: "synced",
            error: undefined,
            recurrence: "",
            recurring: remote!.recurring,
          });
        this.store.state.queue = this.store.state.queue.filter(
          (item) => item.id !== change.id,
        );
        await this.commit();
      } catch (error) {
        change.status = "error";
        change.error = (error as Error).message;
        event.syncState = "error";
        event.error = change.error;
        await this.commit();
      }
    }
  }

  async sync(range: DateRange) {
    const errors: string[] = [];
    if (this.store.state.settings.feishuEnabled) {
      try {
        const auth = await this.feishu.authStatus();
        if (!auth.available) throw new Error(auth.message);
        const calendars = await this.feishu.calendars();
        for (const calendar of calendars) this.mergeCalendar(calendar);
        await this.pushQueue();
        for (const calendar of calendars) {
          try {
            this.mergeEvents(
              calendar.id,
              await this.feishu.events(calendar, range),
              range,
            );
          } catch (error) {
            errors.push(`${calendar.name} · ${(error as Error).message}`);
          }
        }
      } catch (error) {
        errors.push((error as Error).message);
      }
    }
    for (const connection of this.store.state.connections) {
      try {
        const secret = await this.vault.read(connection.id);
        if (!secret) throw new Error("本地连接凭据缺失，请重新填写");
        const result = await fetchSubscription(
          { ...connection, ...secret },
          range,
        );
        for (const calendar of result.calendars) {
          this.mergeCalendar(calendar);
          this.mergeEvents(
            calendar.id,
            result.events.filter((item) => item.calendarId === calendar.id),
            range,
          );
        }
        connection.lastSync = new Date().toISOString();
        connection.error = undefined;
      } catch {
        connection.error =
          "订阅读取失败，请检查服务器地址、账号密码和网络，原有缓存已保留";
        errors.push(`${connection.name} · ${connection.error}`);
      }
    }
    if (this.store.state.queue.some((item) => item.status === "error"))
      errors.push("部分修改同步失败，详情见待同步记录");
    this.store.state.syncError = errors.join("\n") || undefined;
    if (errors.length === 0)
      this.store.state.lastSync = new Date().toISOString();
    return this.commit();
  }

  async resolveConflict(id: string, choice: "remote" | "local") {
    const change = this.store.state.queue.find((item) => item.id === id);
    if (!change?.remote) throw new Error("找不到冲突记录");
    const event = this.store.state.events.find(
      (item) => item.id === change.eventId,
    )!;
    if (choice === "remote") {
      this.store.state.events = this.store.state.events.filter(
        (item) => item.id !== event.id,
      );
      if (!change.remote.deleted)
        this.store.state.events.push({ ...change.remote, id: event.id });
      this.store.state.queue = this.store.state.queue.filter(
        (item) => item.id !== id,
      );
    } else {
      change.baseFingerprint = change.remote.remoteFingerprint;
      change.status = "pending";
      change.error = undefined;
      if (change.remote.deleted) {
        change.action = "create";
        change.id = randomUUID();
        event.remoteId = undefined;
      }
      event.syncState = "pending";
      event.error = undefined;
      change.remote = undefined;
    }
    return this.commit();
  }
}
