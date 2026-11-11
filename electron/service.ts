import { randomUUID } from "node:crypto";
import type {
  AppSnapshot,
  CalendarEvent,
  CalendarSource,
  Connection,
  DateRange,
  EventSave,
  EventTemplate,
  Settings,
  HolidayData,
  SpecialDate,
  CalendarTask,
  CalendarSet,
  BulkEventAction,
  Semester,
  Course,
  HistoryMetadata,
} from "../src/shared/types";
import { overlaps } from "../src/shared/dates";
import { FeishuClient } from "./feishu";
import { CalDAVClient } from "./caldav";
import { WebDAVClient, teachingSchema } from "./webdav";
import {
  contentFingerprint,
  type RemoteCalendarClient,
} from "./remote-calendar";
import { checkedUrl, fetchSubscription } from "./subscriptions";
import { Store } from "./store";
import { scanReminders } from "./reminders";
import {
  eventContent,
  recordChange,
  taskContent,
  historyMetadata,
  matchesMetadata,
} from "./history";
import { expandLocalEvents } from "../src/shared/recurrence";
import type { RestorePlan } from "./backups";
import { nextSpecialDate, validateSpecialDate } from "../src/shared/almanac";
import { eventDraft } from "../src/shared/capture";
import { courseEvents, validateSemester } from "../src/shared/courses";
import { OAuthCalendarClient } from "./oauth-calendar";

export interface Vault {
  read(id: string): Promise<Connection | undefined>;
  write(connection: Connection): Promise<void>;
  remove(id: string): Promise<void>;
}

export class CalendarService {
  private reminderSavedAt = 0;
  private applyingCourse = false;
  private pendingHistory?: {
    before: CalendarEvent[];
    tasksBefore: CalendarTask[];
    metadataBefore: HistoryMetadata;
    label: string;
    deleted?: CalendarEvent;
  };
  private batchDepth = 0;
  private tail: Promise<unknown> = Promise.resolve();
  constructor(
    readonly store: Store,
    readonly feishu: FeishuClient,
    private vault: Vault,
    private changed: (snapshot: AppSnapshot) => void = () => {},
    private makeClient: (connection: Connection) => RemoteCalendarClient = (
      connection,
    ) =>
      connection.kind === "google" || connection.kind === "microsoft"
        ? new OAuthCalendarClient(connection, (updated) =>
            this.vault.write(updated),
          )
        : connection.kind === "webdav"
          ? new WebDAVClient(connection)
          : new CalDAVClient(connection),
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
    if (this.batchDepth) return this.snapshot();
    if (this.pendingHistory) {
      recordChange(
        this.store.state,
        this.pendingHistory.before,
        this.pendingHistory.label,
        this.pendingHistory.deleted,
        this.pendingHistory.tasksBefore,
        this.pendingHistory.metadataBefore,
      );
      this.pendingHistory = undefined;
    }
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
        // A failed create may have reached the server. Keep the same idempotency key and
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

  private async recordEdit(
    label: string,
    operation: () => Promise<AppSnapshot>,
    deleted?: CalendarEvent,
  ) {
    const before = structuredClone(this.store.state);
    this.pendingHistory = {
      before: before.events,
      tasksBefore: before.tasks || [],
      metadataBefore: historyMetadata(before),
      label,
      deleted,
    };
    try {
      return await operation();
    } catch (error) {
      this.store.state = before;
      throw error;
    } finally {
      this.pendingHistory = undefined;
    }
  }

  async saveEvent(input: EventSave) {
    return this.recordEdit(input.event.id ? "修改日程" : "新建日程", () =>
      this.writeEvent(input),
    );
  }

  async saveEvents(inputs: EventSave[]) {
    return this.recordEdit("批量安排日程", async () => {
      this.batchDepth++;
      try {
        for (const input of inputs) await this.writeEvent(input);
      } finally {
        this.batchDepth--;
      }
      return this.commit();
    });
  }

  async bulkEvents(input: BulkEventAction) {
    const events = [...new Set(input.ids)].map((id) => {
      const event = this.store.state.events.find((event) => event.id === id);
      if (event) return event;
      const [masterId, occurrence] = id.split("::");
      const master = this.store.state.events.find(
        (event) => event.id === masterId,
      );
      const expanded =
        master &&
        occurrence &&
        expandLocalEvents([master], {
          start: occurrence,
          end: new Date(
            new Date(occurrence).getTime() + 86400_000,
          ).toISOString(),
        }).find((item) => item.id === id);
      if (!expanded) throw new Error("部分日程已变化，请重新搜索后操作");
      return expanded;
    });
    return this.recordEdit("批量日程操作", async () => {
      this.batchDepth++;
      try {
        for (const event of events) {
          const scope =
            event.seriesId || (event.remoteId && event.recurring)
              ? "single"
              : "all";
          if (input.action === "reminder") {
            (this.store.state.reminderRules ||= {})[event.id] =
              input.reminder < 0 ? [] : [input.reminder];
          } else if (input.action === "complete")
            await this.writeEvent({
              event: { ...event, completed: true },
              scope,
            });
          else if (input.action === "delete")
            await this.removeEvent(event.id, scope);
          else {
            if (
              input.action === "move" &&
              !this.calendar(event.calendarId).writable
            )
              throw new Error("只读日历支持复制，请取消移动只读日程");
            if (
              input.action === "move" &&
              event.calendarId === input.calendarId
            )
              continue;
            await this.writeEvent({
              event: {
                ...event,
                id: `copy:${input.operationId}:${event.id}`,
                calendarId: input.calendarId,
                remoteId: undefined,
                remoteFingerprint: undefined,
                remoteEtag: undefined,
                seriesId: undefined,
                occurrenceStart: undefined,
                recurring: false,
                recurrence: "",
                exceptions: undefined,
                taskId: undefined,
                courseId: undefined,
                courseWeek: undefined,
              },
            });
            if (input.action === "move")
              await this.removeEvent(event.id, scope);
          }
        }
      } finally {
        this.batchDepth--;
      }
      return this.commit();
    });
  }

  async saveTask(input: CalendarTask) {
    const task = {
      ...input,
      id: input.id || randomUUID(),
      updatedAt: new Date().toISOString(),
    };
    const old = this.store.state.tasks?.find((item) => item.id === task.id);
    return this.recordEdit("修改待办安排", async () => {
      this.store.state.tasks = [
        ...(this.store.state.tasks || []).filter((item) => item.id !== task.id),
        task,
      ];
      if (old && old.completed !== task.completed) {
        this.batchDepth++;
        try {
          for (const event of this.store.state.events.filter(
            (item) => item.taskId === task.id && !item.deleted,
          ))
            await this.writeEvent({
              event: { ...event, completed: task.completed },
              scope: event.recurring && event.remoteId ? "single" : "all",
            });
        } finally {
          this.batchDepth--;
        }
      }
      return this.commit();
    });
  }

  async deleteTask(id: string, removeScheduled: boolean) {
    return this.recordEdit("删除待办安排", async () => {
      this.batchDepth++;
      try {
        for (const event of this.store.state.events.filter(
          (item) => item.taskId === id && !item.deleted,
        )) {
          if (removeScheduled)
            await this.removeEvent(
              event.id,
              event.recurring && event.remoteId ? "single" : "all",
            );
          else event.taskId = undefined;
        }
        this.store.state.tasks = (this.store.state.tasks || []).filter(
          (item) => item.id !== id,
        );
      } finally {
        this.batchDepth--;
      }
      return this.commit();
    });
  }

  async scheduleTask(
    id: string,
    start: string,
    calendarId: string,
    blockId: string,
  ) {
    const task = this.store.state.tasks?.find((item) => item.id === id);
    if (!task) throw new Error("待办已不存在");
    if (task.completed) throw new Error("已完成的待办需要先恢复为未完成");
    const event = {
      ...eventDraft(
        this.store.state,
        start,
        new Date(
          new Date(start).getTime() + task.estimateMinutes * 60_000,
        ).toISOString(),
      ),
      id: `task-block:${blockId}`,
      title: task.title,
      description: task.description,
      calendarId,
      taskId: task.id,
    };
    return this.saveEvent({ event });
  }

  async saveCalendarSet(input: CalendarSet) {
    const set = {
      ...input,
      id: input.id || randomUUID(),
      calendarIds: [...new Set(input.calendarIds)].filter((id) =>
        this.store.state.calendars.some((item) => item.id === id),
      ),
    };
    this.store.state.calendarSets = [
      ...(this.store.state.calendarSets || []).filter(
        (item) => item.id !== set.id,
      ),
      set,
    ];
    return this.commit();
  }

  async deleteCalendarSet(id: string) {
    this.store.state.calendarSets = (
      this.store.state.calendarSets || []
    ).filter((item) => item.id !== id);
    return this.commit();
  }

  async saveSemester(input: Semester, activate: boolean) {
    validateSemester(input);
    const semester = { ...input, id: input.id || randomUUID() };
    return this.recordEdit("保存学期", async () => {
      this.store.state.semesters = [
        ...(this.store.state.semesters || []).filter(
          (item) => item.id !== semester.id,
        ),
        semester,
      ];
      this.batchDepth++;
      try {
        for (const course of [...(this.store.state.courses || [])])
          if (course.semesterId === semester.id) await this.writeCourse(course);
        if (activate)
          Object.assign(this.store.state.settings, {
            teachingStartDate: semester.startDate,
            teachingWeeks: semester.weeks,
            weekStartsOn: semester.weekStartsOn,
          });
      } finally {
        this.batchDepth--;
      }
      return this.commit();
    });
  }

  async deleteSemester(id: string) {
    if (this.store.state.courses?.some((course) => course.semesterId === id))
      throw new Error("请先删除该学期的课程安排，再删除学期");
    return this.recordEdit("删除学期", async () => {
      this.store.state.semesters = (this.store.state.semesters || []).filter(
        (semester) => semester.id !== id,
      );
      return this.commit();
    });
  }

  async saveCourse(input: Course) {
    return this.recordEdit("保存课程安排", async () => {
      this.batchDepth++;
      try {
        await this.writeCourse({ ...input, id: input.id || randomUUID() });
      } finally {
        this.batchDepth--;
      }
      return this.commit();
    });
  }

  private async writeCourse(course: Course) {
    const existing = this.store.state.courses?.find(
      (item) => item.id === course.id,
    );
    if (existing && existing.calendarId !== course.calendarId)
      throw new Error("已有课程请保留所属日历，或新建课程后删除旧课程");
    const generated = courseEvents(this.store.state, course);
    const generatedIds = new Set(generated.map((event) => event.id));
    this.store.state.courses = [
      ...(this.store.state.courses || []).filter(
        (item) => item.id !== course.id,
      ),
      course,
    ];
    this.applyingCourse = true;
    try {
      for (const event of this.store.state.events.filter(
        (event) =>
          event.courseId === course.id &&
          !event.deleted &&
          !generatedIds.has(event.id),
      ))
        await this.removeEvent(event.id);
      for (const event of generated) {
        const old = this.store.state.events.find(
          (item) => item.id === event.id,
        );
        await this.writeEvent({
          event: { ...event, completed: old?.completed || false },
        });
      }
    } finally {
      this.applyingCourse = false;
    }
  }

  async deleteCourse(id: string) {
    return this.recordEdit("删除课程安排", async () => {
      this.batchDepth++;
      this.applyingCourse = true;
      try {
        for (const event of this.store.state.events.filter(
          (event) => event.courseId === id && !event.deleted,
        ))
          await this.removeEvent(event.id);
        this.store.state.courses = (this.store.state.courses || []).filter(
          (course) => course.id !== id,
        );
      } finally {
        this.batchDepth--;
        this.applyingCourse = false;
      }
      return this.commit();
    });
  }

  async applyCalendarSet(id: string, desktop: boolean) {
    const set = this.store.state.calendarSets?.find((item) => item.id === id);
    if (!set) throw new Error("日历组合已不存在");
    if (desktop)
      this.store.state.settings.desktopCalendarIds = [...set.calendarIds];
    else
      for (const calendar of this.store.state.calendars)
        calendar.visible = set.calendarIds.includes(calendar.id);
    return this.commit();
  }

  private async writeEvent({ event: input, scope, localReminders }: EventSave) {
    let event = structuredClone(input);
    const calendar = this.calendar(event.calendarId);
    if (!calendar.writable) throw new Error("此日历为只读，请选择可写入的日历");
    let previous = this.store.state.events.find((item) => item.id === event.id);
    if (previous?.recurrence && !event.seriesId && scope !== "all")
      throw new Error("请选择整个重复系列，单次修改请从日历中打开具体日期");
    if (event.seriesId) {
      const master = this.store.state.events.find(
        (item) => item.id === event.seriesId,
      );
      if (!master || !scope) throw new Error("请选择重复日程的修改范围");
      if (master.remoteId && calendar.provider !== "webdav")
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
        if (calendar.provider !== "local" && calendar.provider !== "webdav")
          throw new Error("请先同步新建的重复日程，再修改单次日程");
        master.exceptions = [
          ...new Set([...(master.exceptions || []), event.occurrenceStart!]),
        ];
        if (calendar.provider === "webdav")
          this.enqueue(
            master,
            master.remoteId ? "update" : "create",
            master.remoteFingerprint,
          );
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
    if (
      event.remoteId &&
      event.recurring &&
      calendar.provider !== "webdav" &&
      scope !== "single"
    )
      throw new Error("远程重复日程请选择“仅此次”，系列管理可在来源日历中操作");
    event.id ||= randomUUID();
    event.title = event.title.trim();
    if (!this.store.state.tasks?.some((task) => task.id === event.taskId))
      event.taskId = undefined;
    const course = this.store.state.courses?.find(
      (course) => course.id === event.courseId,
    );
    if (!course) {
      event.courseId = undefined;
      event.courseWeek = undefined;
    } else if (
      !this.applyingCourse &&
      event.courseWeek &&
      (!previous ||
        ["start", "end", "title", "location", "description"].some(
          (key) =>
            event[key as keyof CalendarEvent] !==
            previous![key as keyof CalendarEvent],
        ))
    )
      course.exceptions[String(event.courseWeek)] = {
        start: event.start,
        end: event.end,
        title: event.title,
        location: event.location,
        description: event.description,
      };
    event.remoteId = previous?.remoteId;
    event.remoteFingerprint = previous?.remoteFingerprint;
    event.remoteEtag = previous?.remoteEtag;
    event.syncState = calendar.provider === "local" ? "local" : "pending";
    event.deleted = false;
    if (calendar.provider !== "local")
      this.enqueue(
        event,
        previous?.remoteId ? "update" : "create",
        previous?.remoteFingerprint,
      );
    this.store.state.events = this.store.state.events.filter(
      (item) => item.id !== event.id,
    );
    this.store.state.events.push(event);
    if (localReminders !== undefined) {
      const rules = (this.store.state.reminderRules ||= {});
      rules[event.id] = [...new Set(localReminders)];
    }
    return this.commit();
  }

  async deleteEvent(id: string, scope?: "single" | "all") {
    const [masterId, occurrence] = id.split("::");
    let deleted = this.store.state.events.find(
      (event) => event.id === masterId,
    );
    if (deleted && occurrence && scope === "single") {
      deleted = expandLocalEvents([deleted], {
        start: occurrence,
        end: new Date(new Date(occurrence).getTime() + 86400_000).toISOString(),
      }).find((event) => event.id === id);
    }
    return this.recordEdit(
      "删除日程",
      () => this.removeEvent(id, scope),
      deleted,
    );
  }

  private async removeEvent(id: string, scope?: "single" | "all") {
    const [masterId, occurrenceStart] = id.split("::");
    const event = this.store.state.events.find((item) => item.id === masterId);
    if (!event) throw new Error("日程已不存在");
    if (!this.calendar(event.calendarId).writable)
      throw new Error("订阅日程为只读");
    const course = this.store.state.courses?.find(
      (course) => course.id === event.courseId,
    );
    if (course && event.courseWeek && !this.applyingCourse)
      course.exceptions[String(event.courseWeek)] = { cancelled: true };
    if ((event.recurrence || event.recurring) && !scope)
      throw new Error("请选择重复日程的删除范围");
    if (event.recurrence && !occurrenceStart && scope === "single")
      throw new Error("单次删除请从日历中打开具体日期");
    if (occurrenceStart && scope === "single") {
      const provider = this.calendar(event.calendarId).provider;
      if (provider !== "local" && provider !== "webdav")
        throw new Error("请先同步新建的重复日程");
      event.exceptions = [
        ...new Set([...(event.exceptions || []), occurrenceStart]),
      ];
      if (provider === "webdav")
        this.enqueue(
          event,
          event.remoteId ? "update" : "create",
          event.remoteFingerprint,
        );
      return this.commit();
    }
    if (
      event.remoteId &&
      event.recurring &&
      this.calendar(event.calendarId).provider !== "webdav" &&
      scope !== "single"
    )
      throw new Error("远程系列日程请在来源日历中删除整个系列");
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

  async undoChange(historyId?: string) {
    const history = historyId
      ? this.store.state.history?.find(
          (item) => item.id === historyId && !item.undone,
        )
      : this.store.state.history
          ?.slice()
          .reverse()
          .find((item) => !item.undone);
    if (!history) throw new Error("没有可撤销的操作");
    const ids = new Set(
      [...history.before, ...history.after].map((event) => event.id),
    );
    for (const id of ids) {
      if (
        eventContent(
          this.store.state.events.find((event) => event.id === id),
        ) !== eventContent(history.after.find((event) => event.id === id))
      )
        throw new Error("相关日程已发生新的修改，请从回收站恢复副本或手动编辑");
    }
    const beforeState = structuredClone(this.store.state);
    if (
      history.metadataAfter &&
      !matchesMetadata(this.store.state, history.metadataAfter)
    )
      throw new Error("关联设置已发生新的修改，请手动恢复");
    const taskIds = new Set(
      [...(history.tasksBefore || []), ...(history.tasksAfter || [])].map(
        (task) => task.id,
      ),
    );
    for (const id of taskIds) {
      if (
        taskContent(this.store.state.tasks?.find((task) => task.id === id)) !==
        taskContent(history.tasksAfter?.find((task) => task.id === id))
      )
        throw new Error("相关待办已发生新的修改，请手动编辑");
    }
    this.batchDepth++;
    this.applyingCourse = true;
    try {
      if (history.metadataBefore)
        Object.assign(
          this.store.state,
          structuredClone(history.metadataBefore),
        );
      this.store.state.tasks = [
        ...(this.store.state.tasks || []).filter(
          (task) => !taskIds.has(task.id),
        ),
        ...structuredClone(history.tasksBefore || []),
      ];
      for (const id of ids) {
        const old = history.before.find(
          (event) => event.id === id && !event.deleted,
        );
        const current = this.store.state.events.find(
          (event) => event.id === id && !event.deleted,
        );
        if (old) {
          const restored = structuredClone(old);
          if (
            !current &&
            restored.remoteId &&
            restored.recurring &&
            !restored.recurrence
          ) {
            restored.remoteId = undefined;
            restored.recurring = false;
          }
          await this.writeEvent({
            event: restored,
            scope:
              restored.remoteId && restored.recurring && !restored.recurrence
                ? "single"
                : "all",
          });
        } else if (current)
          await this.removeEvent(
            current.id,
            current.remoteId && current.recurring && !current.recurrence
              ? "single"
              : "all",
          );
      }
      history.undone = true;
      this.store.state.trash = this.store.state.trash?.filter(
        (entry) => entry.historyId !== history.id,
      );
    } catch (error) {
      this.store.state = beforeState;
      throw error;
    } finally {
      this.batchDepth--;
      this.applyingCourse = false;
    }
    return this.commit();
  }

  async restoreTrash(id: string) {
    const entry = this.store.state.trash?.find((item) => item.id === id);
    if (!entry) throw new Error("回收站记录已不存在");
    const history = this.store.state.history?.find(
      (item) => item.id === entry.historyId && !item.undone,
    );
    const untouched =
      history &&
      new Set([...history.before, ...history.after].map((event) => event.id))
        .size === 1 &&
      !history.tasksBefore?.length &&
      !history.tasksAfter?.length &&
      (!history.metadataAfter ||
        matchesMetadata(this.store.state, history.metadataAfter)) &&
      [...history.before, ...history.after].every(
        (event) =>
          eventContent(
            this.store.state.events.find((item) => item.id === event.id),
          ) ===
          eventContent(history.after.find((item) => item.id === event.id)),
      );
    if (untouched) return this.undoChange(entry.historyId);
    const calendar = this.store.state.calendars.find(
      (item) => item.id === entry.event.calendarId && item.writable,
    );
    const restored = {
      ...entry.event,
      id: "",
      calendarId: calendar?.id || "local",
      remoteId: undefined,
      remoteEtag: undefined,
      remoteFingerprint: undefined,
      seriesId: undefined,
      occurrenceStart: undefined,
      recurring: false,
      deleted: false,
      courseId: undefined,
      courseWeek: undefined,
    };
    await this.saveEvent({ event: restored });
    this.store.state.trash = this.store.state.trash?.filter(
      (item) => item.id !== id,
    );
    return this.commit();
  }

  async restoreBackup(plan: RestorePlan) {
    return this.recordEdit("恢复备份", async () => {
      this.batchDepth++;
      try {
        this.store.state.calendars.push(...structuredClone(plan.calendars));
        for (const change of plan.changes) {
          const event = structuredClone(change.event);
          if (change.action === "delete") {
            await this.removeEvent(
              event.id,
              event.remoteId && event.recurring && !event.recurrence
                ? "single"
                : "all",
            );
            continue;
          }
          event.seriesId = undefined;
          event.occurrenceStart = undefined;
          if (change.action === "create") {
            event.remoteId = undefined;
            event.recurring = Boolean(event.recurrence);
          }
          await this.writeEvent({
            event,
            scope:
              event.remoteId && event.recurring && !event.recurrence
                ? "single"
                : "all",
          });
        }
      } finally {
        this.batchDepth--;
      }
      return this.commit();
    });
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

  async saveTemplate(input: EventTemplate) {
    if (!this.calendar(input.calendarId).writable)
      throw new Error("模板请选择可写入的日历");
    const templates = this.store.state.templates || [];
    if (!input.id && templates.length >= 200)
      throw new Error("最多保存 200 个模板");
    const template = { ...input, id: input.id || randomUUID() };
    this.store.state.templates = templates.filter(
      (item) => item.id !== template.id,
    );
    this.store.state.templates.push(template);
    return this.commit();
  }

  async reminderRule(eventId: string, minutes: number[] | null) {
    const [masterId] = eventId.split("::");
    if (
      !this.store.state.specialDates?.some((item) =>
        eventId.startsWith(`special:${item.id}:`),
      ) &&
      !this.store.state.events.some(
        (event) => event.id === masterId && !event.deleted,
      )
    )
      throw new Error("日程已不存在");
    const rules = (this.store.state.reminderRules ||= {});
    if (minutes === null) delete rules[eventId];
    else
      rules[eventId] = [...new Set(minutes)].sort(
        (left, right) => right - left,
      );
    return this.commit();
  }

  async saveHolidayData(data: HolidayData) {
    this.store.state.holidayData = data;
    return this.commit();
  }

  async holidayOverride(
    day: string,
    value: { name: string; work: boolean } | null,
  ) {
    const overrides = (this.store.state.holidayOverrides ||= {});
    if (value) overrides[day] = value;
    else delete overrides[day];
    return this.commit();
  }

  async saveSpecialDate(input: SpecialDate) {
    validateSpecialDate(input);
    if (!nextSpecialDate(input))
      throw new Error("此农历日期在未来 30 年中没有对应日期，请检查闰月设置");
    const item = { ...input, id: input.id || randomUUID() };
    this.store.state.specialDates = [
      ...(this.store.state.specialDates || []).filter(
        (entry) => entry.id !== item.id,
      ),
      item,
    ];
    if (
      !this.store.state.calendars.some(
        (calendar) => calendar.id === "special-dates",
      )
    )
      this.store.state.calendars.push({
        id: "special-dates",
        name: "纪念日与倒数日",
        color: "#d77b9c",
        provider: "local",
        visible: true,
        writable: false,
      });
    return this.commit();
  }

  async deleteSpecialDate(id: string) {
    this.store.state.specialDates = (
      this.store.state.specialDates || []
    ).filter((item) => item.id !== id);
    return this.commit();
  }

  async reminderAction(id: string, action: "dismiss" | "snooze5" | "snooze15") {
    const entry = this.store.state.reminderEntries?.find(
      (item) => item.id === id,
    );
    if (!entry) throw new Error("提醒已不存在");
    entry.state = action === "dismiss" ? "dismissed" : "snoozed";
    entry.snoozedUntil =
      action === "dismiss"
        ? undefined
        : new Date(
            Date.now() + (action === "snooze5" ? 5 : 15) * 60_000,
          ).toISOString();
    return this.commit();
  }

  async checkReminders(now = Date.now()) {
    const previous = JSON.stringify(this.store.state.reminderEntries);
    const notifications = scanReminders(this.store.state, now);
    if (JSON.stringify(this.store.state.reminderEntries) !== previous) {
      await this.commit();
      this.reminderSavedAt = now;
    } else if (now - this.reminderSavedAt >= 300_000) {
      await this.store.save();
      this.reminderSavedAt = now;
    }
    return notifications;
  }

  async deleteTemplate(id: string) {
    this.store.state.templates = (this.store.state.templates || []).filter(
      (item) => item.id !== id,
    );
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
      target.provider === "local" ||
      !target.writable
    )
      throw new Error("请选择本地来源日历和可写入的云端目标日历");
    for (const event of this.store.state.events.filter(
      (item) => item.calendarId === id && !item.deleted,
    )) {
      if (event.exceptions?.length && target.provider !== "webdav")
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
    const startHour =
      patch.dayStartHour ?? this.store.state.settings.dayStartHour;
    const endHour = patch.dayEndHour ?? this.store.state.settings.dayEndHour;
    if (startHour >= endHour) throw new Error("显示结束时间必须晚于开始时间");
    if (
      patch.defaultCalendarId &&
      !this.calendar(patch.defaultCalendarId).writable
    )
      throw new Error("默认日历必须具有写入权限");
    Object.assign(this.store.state.settings, patch);
    return this.commit();
  }

  async saveConnection(input: Connection) {
    if (input.kind === "google" || input.kind === "microsoft") {
      const secret = await this.vault.read(input.id);
      if (!secret?.oauth || secret.kind !== input.kind)
        throw new Error("请使用账号授权入口添加此连接");
      return this.saveOAuthConnection({
        ...secret,
        name: input.name,
        enabled: input.enabled,
        readOnly: input.readOnly,
      });
    }
    checkedUrl(input.url);
    const connection = { ...input, id: input.id || randomUUID() };
    const previous = await this.vault.read(connection.id);
    connection.password ||= previous?.password;
    if (
      connection.kind !== "ics" &&
      (!connection.username || !connection.password)
    )
      throw new Error("请填写同步账号和应用密码");
    const existing = this.store.state.connections.find(
      (item) => item.id === connection.id,
    );
    if (
      existing &&
      (existing.kind !== connection.kind ||
        (connection.kind !== "ics" &&
          (previous?.url !== connection.url ||
            previous?.username !== connection.username)))
    ) {
      throw new Error(
        "更换服务器或账号请新增连接，已有日程和待同步修改会保留在原连接中",
      );
    }
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
      enabled: connection.enabled ?? true,
      readOnly: connection.readOnly ?? true,
      syncTeaching: connection.syncTeaching ?? false,
      teachingBase: existing?.teachingBase,
      teachingConflict: existing?.teachingConflict,
    });
    return this.commit();
  }

  async saveOAuthConnection(connection: Connection, reauthorizing = false) {
    const previous = await this.vault.read(connection.id);
    if (
      reauthorizing &&
      !this.store.state.connections.some((item) => item.id === connection.id)
    )
      throw new Error("原连接已移除，请新增账号连接");
    if (
      previous &&
      (previous.kind !== connection.kind ||
        previous.oauth?.accountId !== connection.oauth?.accountId)
    )
      throw new Error("重新授权的账号与原连接不同，请新增连接以保留原账号数据");
    const old = this.store.state.connections.find(
      (item) => item.id === connection.id,
    );
    connection.enabled =
      (reauthorizing ? old?.enabled : connection.enabled) ?? true;
    connection.readOnly =
      (reauthorizing ? old?.readOnly : connection.readOnly) ?? false;
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
      enabled: connection.enabled,
      readOnly: connection.readOnly,
      oauthClientId: connection.oauth!.clientId,
      oauthTenant: connection.oauth!.tenant,
      lastSync: old?.lastSync,
    });
    return this.commit();
  }

  async removeConnection(id: string) {
    const ids = this.store.state.calendars
      .filter((item) => item.connectionId === id)
      .map((item) => item.id);
    const eventIds = new Set(
      this.store.state.events
        .filter((item) => ids.includes(item.calendarId))
        .map((item) => item.id),
    );
    if (this.store.state.queue.some((item) => eventIds.has(item.eventId)))
      throw new Error("此连接有待同步修改，请先完成同步或处理冲突");
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
    if (ids.includes(this.store.state.settings.defaultCalendarId))
      this.store.state.settings.defaultCalendarId = "local";
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
    complete = false,
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
            taskId: old.taskId,
            courseId: old.courseId,
            courseWeek: old.courseWeek,
            completed:
              this.calendar(calendarId).provider === "webdav"
                ? event.completed
                : old.completed,
            reminder:
              this.calendar(calendarId).provider === "feishu"
                ? old.reminder
                : event.reminder,
          }
        : event;
    });
    const incomingIds = new Set(mapped.map((item) => item.id));
    this.store.state.events = this.store.state.events.filter(
      (item) =>
        item.calendarId !== calendarId ||
        protectedIds.has(item.id) ||
        (!complete &&
          !incomingIds.has(item.id) &&
          !overlaps(item.start, item.end, range)),
    );
    this.store.state.events.push(
      ...mapped.filter((item) => !protectedIds.has(item.id) && !item.deleted),
    );
  }

  private async pushQueue(
    client: RemoteCalendarClient,
    calendarIds: Set<string>,
  ) {
    for (const change of [...this.store.state.queue]) {
      if (change.status === "conflict") continue;
      const event = this.store.state.events.find(
        (item) => item.id === change.eventId,
      );
      if (!event) throw new Error("待同步记录丢失，请从本地备份恢复");
      const calendar = this.calendar(event.calendarId);
      if (!calendarIds.has(calendar.id)) continue;
      const fingerprint = (value: CalendarEvent) =>
        contentFingerprint(value, calendar.provider);
      try {
        let remote: CalendarEvent | undefined;
        if (change.action === "create") {
          if (!change.creation) {
            change.creation = { ...structuredClone(event), deleted: false };
            await this.commit();
          }
          remote = await client.create(calendar, change.creation, change.id);
          if (event.deleted) {
            if (client.deleteCreated)
              await client.deleteCreated(calendar, remote);
            else await client.delete(calendar, remote.remoteId!, remote);
          } else {
            const normalize = (value: CalendarEvent) =>
              ["caldav", "google", "microsoft"].includes(calendar.provider)
                ? { ...value, recurrence: "" }
                : value;
            if (fingerprint(remote) !== fingerprint(normalize(event))) {
              if (
                fingerprint(remote) !== fingerprint(normalize(change.creation))
              ) {
                event.remoteId = remote.remoteId;
                change.action = "update";
                change.status = "conflict";
                change.remote = remote;
                change.error = "新建日程已在另一设备修改，请选择保留的版本";
                event.syncState = "conflict";
                event.error = change.error;
                await this.commit();
                continue;
              }
              remote = await client.update(
                calendar,
                { ...event, remoteId: remote.remoteId },
                remote,
              );
            }
          }
        } else {
          remote = await client.get(calendar, event.remoteId!);
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
            change.error = "云端日程已变化，请选择保留的版本";
            event.syncState = "conflict";
            event.error = change.error;
            await this.commit();
            continue;
          } else if (change.action === "delete")
            await client.delete(calendar, event.remoteId!, remote);
          else remote = await client.update(calendar, event, remote);
        }
        if (event.deleted)
          this.store.state.events = this.store.state.events.filter(
            (item) => item.id !== event.id,
          );
        else
          Object.assign(event, {
            remoteId: remote!.remoteId,
            remoteFingerprint: remote!.remoteFingerprint,
            remoteEtag: remote!.remoteEtag,
            syncState: "synced",
            error: undefined,
            recurrence:
              calendar.provider === "webdav" ? remote!.recurrence : "",
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
        await this.pushQueue(
          this.feishu,
          new Set(calendars.map((item) => item.id)),
        );
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
      if (connection.enabled === false) continue;
      try {
        const secret = await this.vault.read(connection.id);
        if (!secret) throw new Error("本地连接凭据缺失，请重新填写");
        const details = {
          ...secret,
          ...connection,
          url: secret.url,
          username: secret.username,
          password: secret.password,
        };
        if (connection.kind === "ics") {
          const result = await fetchSubscription(details, range);
          for (const calendar of result.calendars) {
            this.mergeCalendar(calendar);
            this.mergeEvents(
              calendar.id,
              result.events.filter((item) => item.calendarId === calendar.id),
              range,
            );
          }
        } else {
          const client = this.makeClient(details);
          const calendars = await client.calendars();
          for (const calendar of calendars) this.mergeCalendar(calendar);
          await this.pushQueue(
            client,
            new Set(
              calendars.filter((item) => item.writable).map((item) => item.id),
            ),
          );
          for (const calendar of calendars) {
            this.mergeEvents(
              calendar.id,
              await client.events(calendar, range),
              range,
              connection.kind === "webdav",
            );
          }
          if (
            connection.kind === "webdav" &&
            connection.syncTeaching &&
            client instanceof WebDAVClient
          ) {
            const result = await client.syncTeaching(
              teachingSchema.parse(this.store.state.settings),
              connection.teachingBase,
            );
            connection.teachingConflict = result.conflict;
            if (!result.conflict) {
              Object.assign(this.store.state.settings, result.value);
              connection.teachingBase = result.value;
            }
          }
        }
        connection.lastSync = new Date().toISOString();
        connection.error = connection.teachingConflict
          ? "教学周配置存在冲突，请在同步记录中选择版本"
          : undefined;
        if (connection.error)
          errors.push(`${connection.name} · ${connection.error}`);
      } catch (error) {
        connection.error =
          (error as Error).message || "同步失败，请检查连接设置";
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

  async resolveTeachingConflict(id: string, choice: "remote" | "local") {
    const connection = this.store.state.connections.find(
      (item) => item.id === id,
    );
    const secret = await this.vault.read(id);
    if (!connection || connection.kind !== "webdav" || !secret)
      throw new Error("找不到 WebDAV 连接");
    const client = this.makeClient(secret);
    if (!(client instanceof WebDAVClient))
      throw new Error("此连接不支持教学周同步");
    const result = await client.syncTeaching(
      teachingSchema.parse(this.store.state.settings),
      connection.teachingBase,
      choice,
    );
    Object.assign(this.store.state.settings, result.value);
    connection.teachingBase = result.value;
    connection.teachingConflict = undefined;
    connection.error = undefined;
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
        change.creation = undefined;
      }
      event.syncState = "pending";
      event.error = undefined;
      change.remote = undefined;
    }
    return this.commit();
  }
}
