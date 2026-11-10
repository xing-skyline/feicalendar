import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { emptyState, Store } from "../electron/store";
import {
  FeishuClient,
  fromFeishu,
  toFeishu,
  fingerprint,
} from "../electron/feishu";
import { CalendarService, type Vault } from "../electron/service";
import { exportICS, parseSubscription } from "../electron/subscriptions";
import { expandLocalEvents } from "../src/shared/recurrence";
import { teachingWeek } from "../src/shared/dates";
import type { CalendarEvent, Connection } from "../src/shared/types";

function event(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: "event-1",
    calendarId: "local",
    title: "日程，带标点",
    start: "2026-11-10T01:00:00.000Z",
    end: "2026-11-10T02:00:00.000Z",
    allDay: false,
    description: "第一行\n第二行",
    location: "会议室",
    reminder: 10,
    recurrence: "",
    completed: false,
    syncState: "local",
    ...overrides,
  };
}
const range = {
  start: "2026-11-01T00:00:00+08:00",
  end: "2026-12-01T00:00:00+08:00",
};
class MemoryVault implements Vault {
  values = new Map<string, Connection>();
  async read(id: string) {
    return this.values.get(id);
  }
  async write(connection: Connection) {
    this.values.set(connection.id, connection);
  }
  async remove(id: string) {
    this.values.delete(id);
  }
}

async function fixture(t: TestContext) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "feicalendar-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = new Store(directory);
  await store.load();
  let createCalls = 0;
  let failure = false;
  let remote = event({
    calendarId: "feishu:test",
    remoteId: "remote_0",
    syncState: "synced",
  });
  remote.remoteFingerprint = fingerprint(remote);
  const calendar = {
    id: "feishu:test",
    remoteId: "test",
    name: "飞书测试",
    color: "#5474ee",
    provider: "feishu" as const,
    writable: true,
    visible: true,
  };
  const client = {
    authStatus: async () => ({ available: true, message: "ready" }),
    calendars: async () => [calendar],
    events: async () => (remote.deleted ? [] : [remote]),
    get: async () => remote,
    create: async (_calendar: unknown, input: CalendarEvent, key: string) => {
      createCalls++;
      if (failure) throw new Error("network failed");
      remote = {
        ...input,
        id: "feishu:test/remote_0",
        calendarId: "feishu:test",
        remoteId: "remote_0",
        syncState: "synced",
      };
      remote.remoteFingerprint = fingerprint(remote);
      assert.match(key, /^[a-f0-9-]{36}$/);
      return remote;
    },
    update: async (_calendar: unknown, input: CalendarEvent) => {
      remote = { ...input, remoteFingerprint: fingerprint(input) };
      return remote;
    },
    delete: async () => {
      remote = { ...remote, deleted: true };
    },
  } as unknown as FeishuClient;
  store.state.calendars.push(calendar);
  store.state.settings.feishuEnabled = true;
  const service = new CalendarService(store, client, new MemoryVault());
  return {
    directory,
    store,
    service,
    calls: () => createCalls,
    fail: (value: boolean) => {
      failure = value;
    },
    setRemote: (value: CalendarEvent) => {
      remote = { ...value, remoteFingerprint: fingerprint(value) };
    },
  };
}

test("Feishu inclusive all-day dates round-trip to exclusive local dates", () => {
  const local = event({ start: "2026-11-10", end: "2026-11-11", allDay: true });
  const payload = toFeishu(local, true);
  assert.deepEqual(payload.start_time, { date: "2026-11-10" });
  assert.deepEqual(payload.end_time, { date: "2026-11-10" });
  const mapped = fromFeishu({ event_id: "test_0", ...payload }, "feishu:test");
  assert.equal(mapped.start, local.start);
  assert.equal(mapped.end, local.end);
});

test("timed event conversion preserves the exact instant and description", () => {
  const original = event();
  const payload = toFeishu(original, true);
  const mapped = fromFeishu({ event_id: "test_0", ...payload }, "feishu:test");
  assert.equal(mapped.start, original.start);
  assert.equal(mapped.description, original.description);
  assert.equal(
    (payload.start_time as { timezone: string }).timezone,
    "Asia/Shanghai",
  );
  assert.equal(
    fingerprint(original),
    fingerprint({
      ...original,
      start: "2026-11-10T09:00:00+08:00",
      end: "2026-11-10T10:00:00+08:00",
    }),
  );
});

test("create omits empty optional fields rejected by the live Feishu API", () => {
  const payload = toFeishu(event({ location: "", recurrence: "" }), true);
  assert.equal("location" in payload, false);
  assert.equal("recurrence" in payload, false);
});

test("patch sends changed fields and uses an empty object to clear the location", async () => {
  let sent: unknown;
  const client = new FeishuClient("unused");
  client.call = async <T>(_args: string[], payload?: unknown) => {
    sent = payload;
    return {
      event: {
        event_id: "test_0",
        summary: "修改后的日程",
        start_time: { timestamp: "1794272400" },
        end_time: { timestamp: "1794276000" },
      },
    } as T;
  };
  const calendar = emptyState().calendars[0];
  const before = event({ remoteId: "test_0" });
  await client.update(calendar, { ...before, title: "修改后的日程" }, before);
  assert.deepEqual(sent, { summary: "修改后的日程" });
  await client.update(calendar, { ...before, location: "" }, before);
  assert.deepEqual(sent, { location: {} });
});

test("ICS round trip preserves Chinese text, dates, and escaped separators", async () => {
  const original = event();
  const parsed = await parseSubscription(
    exportICS([original]),
    "ics:test",
    range,
  );
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].title, original.title);
  assert.equal(parsed[0].description, original.description);
  assert.equal(parsed[0].start, original.start);
});

test("ICS recurrence excludes EXDATE and applies an override", async () => {
  const content = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "BEGIN:VEVENT",
    "UID:repeat",
    "SUMMARY:原始日程",
    "DTSTART;TZID=Asia/Shanghai:20261110T090000",
    "DTEND;TZID=Asia/Shanghai:20261110T100000",
    "RRULE:FREQ=DAILY;COUNT=3",
    "EXDATE;TZID=Asia/Shanghai:20261111T090000",
    "END:VEVENT",
    "BEGIN:VEVENT",
    "UID:repeat",
    "RECURRENCE-ID;TZID=Asia/Shanghai:20261112T090000",
    "SUMMARY:调整后日程",
    "DTSTART;TZID=Asia/Shanghai:20261112T140000",
    "DTEND;TZID=Asia/Shanghai:20261112T150000",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
  const parsed = await parseSubscription(content, "ics:test", range);
  assert.equal(parsed.length, 2);
  assert.equal(parsed[1].title, "调整后日程");
  assert.equal(parsed[1].start, "2026-11-12T06:00:00.000Z");
});

test("local recurring events retain Beijing wall time and exclude a removed occurrence", () => {
  const source = event({
    recurrence: "FREQ=DAILY",
    exceptions: ["2026-11-11T01:00:00.000Z"],
  });
  const result = expandLocalEvents([source], {
    start: "2026-11-10T00:00:00+08:00",
    end: "2026-11-13T00:00:00+08:00",
  });
  assert.equal(result.length, 2);
  assert.equal(result[1].start, "2026-11-12T01:00:00.000Z");
});

test("exported weekday recurrence preserves early-morning Beijing dates", async () => {
  const source = event({
    start: "2026-11-08T17:00:00.000Z",
    end: "2026-11-08T18:00:00.000Z",
    recurrence: "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR",
  });
  const smallRange = {
    start: "2026-11-09T00:00:00+08:00",
    end: "2026-11-11T00:00:00+08:00",
  };
  const local = expandLocalEvents([source], smallRange);
  const parsed = await parseSubscription(
    exportICS([source]),
    "ics:test",
    smallRange,
  );
  assert.deepEqual(
    parsed.map((item) => item.start),
    local.map((item) => item.start),
  );
  assert.equal(parsed.length, 2);
});

test("queue and create key survive restart and failed sync, then reconcile without duplication", async (t) => {
  const f = await fixture(t);
  await f.service.saveEvent({ event: event({ calendarId: "feishu:test" }) });
  const key = f.store.state.queue[0].id;
  f.fail(true);
  await f.service.sync(range);
  assert.equal(f.store.state.queue[0].id, key);
  assert.equal(f.store.state.events[0].syncState, "error");
  const reopened = new Store(f.directory);
  await reopened.load();
  assert.equal(reopened.state.queue[0].id, key);
  f.fail(false);
  await f.service.sync(range);
  assert.equal(f.store.state.queue.length, 0);
  assert.equal(f.store.state.events.length, 1);
  assert.equal(f.store.state.events[0].remoteId, "remote_0");
  await f.service.sync(range);
  assert.equal(f.calls(), 2);
});

test("remote change creates a conflict and accepting remote preserves its data", async (t) => {
  const f = await fixture(t);
  await f.service.sync(range);
  const local = f.store.state.events[0];
  await f.service.saveEvent({ event: { ...local, title: "本地改动" } });
  f.setRemote({ ...local, title: "飞书改动" });
  await f.service.sync(range);
  assert.equal(f.store.state.queue[0].status, "conflict");
  assert.equal(f.store.state.events[0].title, "本地改动");
  await f.service.resolveConflict(f.store.state.queue[0].id, "remote");
  assert.equal(f.store.state.events[0].title, "飞书改动");
  assert.equal(f.store.state.queue.length, 0);
});

test("uncertain create followed by local delete is reconciled with the same key", async (t) => {
  const f = await fixture(t);
  await f.service.saveEvent({ event: event({ calendarId: "feishu:test" }) });
  const key = f.store.state.queue[0].id;
  await f.service.deleteEvent("event-1");
  assert.equal(f.store.state.queue[0].id, key);
  await f.service.sync(range);
  assert.equal(f.store.state.events.length, 0);
  assert.equal(f.store.state.queue.length, 0);
});

test("concurrent local operations are serialized and survive a reload", async (t) => {
  const f = await fixture(t);
  await Promise.all(
    Array.from({ length: 15 }, (_, index) =>
      f.service.exclusive(() =>
        f.service.saveEvent({ event: event({ id: `local-${index}` }) }),
      ),
    ),
  );
  const saved = JSON.parse(
    await readFile(path.join(f.directory, "calendar.json"), "utf8"),
  );
  assert.equal(saved.events.length, 15);
  assert.equal(saved.queue.length, 0);
});

test("local recurrence single edit leaves other instances and whole-series dates intact", async (t) => {
  const f = await fixture(t);
  const master = event({ recurrence: "FREQ=DAILY" });
  await f.service.saveEvent({ event: master });
  const occurrence = expandLocalEvents([master], range)[1];
  await f.service.saveEvent({
    event: { ...occurrence, title: "单次修改" },
    scope: "single",
  });
  const expanded = expandLocalEvents(f.store.state.events, range);
  assert.equal(expanded.filter((item) => item.title === "单次修改").length, 1);
  assert.equal(expanded.length, 21);
});

test("existing profiles without a valid saved view retain their data and open the week view", async (t) => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "feicalendar-migration-"),
  );
  t.after(() => rm(directory, { recursive: true, force: true }));
  const state = emptyState();
  state.events = [event()];
  const {
    calendarView,
    closeToTray,
    weekStartsOn,
    hour12,
    dayStartHour,
    dayEndHour,
    defaultDurationMinutes,
    defaultReminder,
    teachingStartDate,
    teachingWeeks,
    ...previousSettings
  } = state.settings;
  const oldProfile = { ...state, settings: previousSettings };
  await writeFile(
    path.join(directory, "calendar.json"),
    JSON.stringify(oldProfile),
  );
  const restored = new Store(directory);
  await restored.load();
  assert.equal(restored.state.settings.calendarView, "timeGridWeek");
  assert.equal(restored.state.settings.closeToTray, true);
  assert.equal(restored.state.settings.teachingStartDate, "");
  assert.equal(restored.state.settings.teachingWeeks, 20);
  assert.deepEqual(restored.state.events, state.events);
  await writeFile(
    path.join(directory, "calendar.json"),
    JSON.stringify({
      ...state,
      settings: { ...state.settings, calendarView: "removedView" },
    }),
  );
  await restored.load();
  assert.equal(restored.state.settings.calendarView, "timeGridWeek");
  assert.deepEqual(restored.state.events, state.events);
});

test("teaching weeks follow the configured week boundary and stop at the term boundaries", () => {
  assert.equal(teachingWeek("2026-08-30", "2026-09-02", 20, 1), null);
  assert.equal(teachingWeek("2026-08-31", "2026-09-02", 20, 1), 1);
  assert.equal(teachingWeek("2026-09-06", "2026-09-02", 20, 1), 1);
  assert.equal(teachingWeek("2026-09-07", "2026-09-02", 20, 1), 2);
  assert.equal(teachingWeek("2027-01-17", "2026-09-02", 20, 1), 20);
  assert.equal(teachingWeek("2027-01-18", "2026-09-02", 20, 1), null);
  assert.equal(teachingWeek("2026-08-30", "2026-09-02", 20, 0), 1);
  assert.equal(teachingWeek("2026-09-06", "2026-09-02", 20, 0), 2);
  assert.equal(teachingWeek("2024-03-02", "2024-02-29", 2, 6), 2);
  assert.equal(teachingWeek("2026-11-10", "", 20, 1), null);
});

test("display hours are validated before committing settings", async (t) => {
  const f = await fixture(t);
  await f.service.settings({ dayStartHour: 8, dayEndHour: 18 });
  await assert.rejects(
    f.service.settings({ dayStartHour: 19 }),
    /结束时间必须晚于开始时间/,
  );
  assert.equal(f.store.state.settings.dayStartHour, 8);
  await f.service.settings({
    closeToTray: false,
    teachingStartDate: "2026-09-02",
    teachingWeeks: 18,
  });
  const reopened = new Store(f.directory);
  await reopened.load();
  assert.equal(reopened.state.settings.closeToTray, false);
  assert.equal(reopened.state.settings.teachingStartDate, "2026-09-02");
  assert.equal(reopened.state.settings.teachingWeeks, 18);
});
