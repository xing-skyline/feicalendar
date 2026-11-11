import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Store, emptyState } from "../electron/store";
import { CalendarService } from "../electron/service";
import { FeishuClient } from "../electron/feishu";
import { CalendarImports } from "../electron/imports";
import { eventDraft } from "../src/shared/capture";
import { calendarPrintHtml } from "../src/shared/print";
import { courseEvents } from "../src/shared/courses";

test("Task scheduling preserves deadlines and undo restores the task with its blocks", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "feicalendar-task-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = new Store(directory);
  await store.load();
  const service = new CalendarService(store, new FeishuClient("unused"), {
    read: async () => undefined,
    write: async () => {},
    remove: async () => {},
  });
  await service.saveTask({
    id: "task",
    title: "报告",
    deadline: "2026-11-15T17:00:00+08:00",
    estimateMinutes: 45,
    priority: 3,
    completed: false,
    description: "",
    subtasks: [],
  });
  await service.scheduleTask(
    "task",
    "2026-11-12T09:00:00+08:00",
    "local",
    randomUUID(),
  );
  assert.equal(store.state.events[0].taskId, "task");
  assert.equal(
    new Date(store.state.events[0].end).getTime() -
      new Date(store.state.events[0].start).getTime(),
    45 * 60_000,
  );
  await service.saveTask({ ...store.state.tasks![0], completed: true });
  assert.equal(store.state.events[0].completed, true);
  await service.undoChange();
  assert.equal(store.state.tasks![0].completed, false);
  assert.equal(store.state.events[0].completed, false);
  await service.deleteTask("task", true);
  assert.equal(store.state.events.length, 0);
  await service.undoChange();
  assert.equal(store.state.tasks![0].deadline, "2026-11-15T17:00:00+08:00");
  assert.equal(store.state.events[0].taskId, "task");
  await service.saveCalendar({ name: "测试目标" });
  const target = store.state.calendars.at(-1)!.id;
  await service.bulkEvents({
    operationId: randomUUID(),
    ids: [store.state.events[0].id],
    action: "move",
    calendarId: target,
    reminder: 15,
  });
  assert.equal(store.state.events[0].calendarId, target);
  await service.undoChange();
  assert.equal(store.state.events[0].calendarId, "local");
  await service.saveCalendarSet({
    id: "set",
    name: "工作",
    calendarIds: [target],
  });
  await service.applyCalendarSet("set", true);
  assert.deepEqual(store.state.settings.desktopCalendarIds, [target]);
});

test("ICS imports deduplicate, retain recurrence exceptions, and print escapes source text", async () => {
  const state = emptyState();
  const imports = new CalendarImports();
  const text =
    "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:test\r\nDTSTART:20261110T010000Z\r\nDTEND:20261110T020000Z\r\nRRULE:FREQ=DAILY;COUNT=3\r\nEXDATE:20261111T010000Z\r\nSUMMARY:Test\r\nEND:VEVENT\r\nEND:VCALENDAR";
  const preview = await imports.preview(
    text,
    "local",
    { start: "2026-11-01", end: "2026-12-01" },
    state,
  );
  assert.equal(preview.events.length, 2);
  const events = imports.selected(
    preview.token,
    preview.events.map((item) => item.event.id),
    state,
  );
  state.events = events;
  assert.equal(
    imports.selected(
      preview.token,
      events.map((event) => event.id),
      state,
    ).length,
    0,
  );
  assert.ok(
    (
      await imports.preview(
        text,
        "local",
        { start: "2026-11-01", end: "2026-12-01" },
        state,
      )
    ).events.every((item) => item.duplicate),
  );
  state.events.push({
    ...eventDraft(state, "2026-11-11"),
    title: "<script>alert('x')</script>",
    description: "<img src=x>",
    id: "html",
  });
  const html = calendarPrintHtml(state, {
    date: "2026-11-11",
    view: "month",
    calendarIds: ["local"],
    details: true,
  });
  assert.ok(html.includes("&lt;script&gt;"));
  assert.ok(!html.includes("<script>"));
});

test("Courses honor week selection, direct rescheduling, cancellation, semester changes and restart undo", async (t) => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "feicalendar-course-"),
  );
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = new Store(directory);
  await store.load();
  const vault = {
    read: async () => undefined,
    write: async () => {},
    remove: async () => {},
  };
  let service = new CalendarService(store, new FeishuClient("unused"), vault);
  await service.saveSemester(
    {
      id: "fall",
      name: "秋季",
      startDate: "2026-09-02",
      weeks: 20,
      weekStartsOn: 1,
      periods: [
        { id: "one", name: "一", start: "09:00", end: "09:45" },
        { id: "two", name: "二", start: "10:00", end: "10:45" },
      ],
    },
    true,
  );
  await service.saveCourse({
    id: "research",
    semesterId: "fall",
    title: "研究方法",
    calendarId: "local",
    weekday: 1,
    weeks: [1, 3, 5],
    firstPeriod: "one",
    lastPeriod: "two",
    location: "教室",
    description: "",
    exceptions: {},
  });
  assert.equal(store.state.events.length, 3);
  assert.equal(store.state.events[0].start, "2026-08-31T09:00:00+08:00");
  const event = store.state.events[0];
  await service.saveEvent({
    event: {
      ...event,
      start: "2026-09-01T14:00:00+08:00",
      end: "2026-09-01T15:00:00+08:00",
    },
  });
  await service.deleteEvent(
    store.state.events.find((item) => item.courseWeek === 3)!.id,
  );
  assert.equal(store.state.courses![0].exceptions["3"].cancelled, true);
  await service.saveSemester(
    { ...store.state.semesters![0], startDate: "2026-09-09" },
    true,
  );
  assert.equal(
    store.state.events.find((item) => item.courseWeek === 1)!.start,
    "2026-09-01T14:00:00+08:00",
  );
  assert.equal(store.state.events.length, 2);
  assert.equal(courseEvents(store.state, store.state.courses![0]).length, 2);
  await store.load();
  service = new CalendarService(store, new FeishuClient("unused"), vault);
  await service.undoChange();
  assert.equal(store.state.semesters![0].startDate, "2026-09-02");
  assert.equal(store.state.events.length, 2);
  await service.deleteCourse("research");
  await service.restoreTrash(store.state.trash!.at(-1)!.id);
  assert.equal(store.state.courses!.length, 0);
  assert.equal(store.state.events.length, 1);
  assert.equal(store.state.events[0].courseId, undefined);
});
