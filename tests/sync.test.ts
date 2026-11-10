import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Store } from "../electron/store";
import { CalendarService, type Vault } from "../electron/service";
import { WebDAVClient } from "../electron/webdav";
import { CalDAVClient, updateCalendarData } from "../electron/caldav";
import { FeishuClient, fingerprint } from "../electron/feishu";
import { exportICS, parseSubscription } from "../electron/subscriptions";
import type {
  CalendarEvent,
  CalendarSource,
  Connection,
} from "../src/shared/types";

const range = { start: "2026-11-01T00:00:00Z", end: "2026-12-01T00:00:00Z" };
function event(calendarId: string, title = "多端日程"): CalendarEvent {
  return {
    id: "",
    calendarId,
    title,
    start: "2026-11-10T01:00:00Z",
    end: "2026-11-10T02:00:00Z",
    allDay: false,
    description: "验证日程",
    location: "",
    reminder: 15,
    recurrence: "",
    completed: false,
    syncState: "local",
  };
}
class MemoryVault implements Vault {
  values = new Map<string, Connection>();
  async read(id: string) {
    return this.values.get(id);
  }
  async write(value: Connection) {
    this.values.set(value.id, structuredClone(value));
  }
  async remove(id: string) {
    this.values.delete(id);
  }
}

class DAVServer {
  files = new Map<string, { data: string; etag: string }>();
  requests: { url: string; method: string; body: string }[] = [];
  offline = new Set<string>();
  dropNextWrite = false;
  revision = 0;
  readonly fetch: typeof fetch = async (input, init = {}) => {
    const url = String(input);
    const method = init.method || "GET";
    const body = String(init.body || "");
    this.requests.push({ url, method, body });
    if (this.offline.has(new URL(url).hostname))
      throw new Error("fixture offline");
    const current = this.files.get(url);
    const headers = new Headers(init.headers);
    const xml = (responses: string) =>
      new Response(
        `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">${responses}</d:multistatus>`,
        { status: 207, headers: { "Content-Type": "application/xml" } },
      );
    const prop = (href: string, properties: string) =>
      `<d:response><d:href>${href}</d:href><d:propstat><d:prop>${properties}</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`;
    if (method === "PROPFIND") {
      if (url.includes(".well-known"))
        return new Response(null, { status: 404 });
      if (body.includes("current-user-principal"))
        return xml(
          prop(
            "/",
            "<d:current-user-principal><d:href>/principal/</d:href></d:current-user-principal>",
          ),
        );
      if (body.includes("calendar-home-set"))
        return xml(
          prop(
            "/principal/",
            "<c:calendar-home-set><d:href>/calendars/</d:href></c:calendar-home-set>",
          ),
        );
      if (body.includes("supported-report-set"))
        return xml(prop("/calendar/", "<d:supported-report-set/>"));
      return xml(
        prop(
          "/calendar/",
          '<d:displayname>CalDAV 验证</d:displayname><d:resourcetype><d:collection/><c:calendar/></d:resourcetype><c:supported-calendar-component-set><c:comp name="VEVENT"/></c:supported-calendar-component-set><d:current-user-privilege-set><d:privilege><d:write/></d:privilege></d:current-user-privilege-set>',
        ),
      );
    }
    if (method === "REPORT")
      return xml(
        [...this.files.entries()]
          .filter(([key]) => key.startsWith(url))
          .map(([key, file]) =>
            prop(
              new URL(key).pathname,
              `<d:getetag>${file.etag}</d:getetag><c:calendar-data><![CDATA[${file.data}]]></c:calendar-data>`,
            ),
          )
          .join(""),
      );
    if (method === "GET")
      return current
        ? new Response(current.data, { headers: { ETag: current.etag } })
        : new Response(null, { status: 404 });
    if (method === "MKCOL") return new Response(null, { status: 201 });
    if (method === "PUT" || method === "DELETE") {
      if (
        (headers.get("If-None-Match") === "*" && current) ||
        (headers.has("If-Match") && headers.get("If-Match") !== current?.etag)
      )
        return new Response(null, { status: 412 });
      if (method === "DELETE") this.files.delete(url);
      else this.files.set(url, { data: body, etag: `"${++this.revision}"` });
      if (this.dropNextWrite) {
        this.dropNextWrite = false;
        throw new Error("fixture response lost");
      }
      return new Response(null, { status: 201 });
    }
    throw new Error(`Unexpected fixture method ${method}`);
  };
}

async function device(t: TestContext, server: DAVServer) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "feicalendar-sync-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = new Store(directory);
  await store.load();
  const vault = new MemoryVault();
  const feishuEvents: CalendarEvent[] = [];
  const feishuCalendar: CalendarSource = {
    id: "feishu:fixture",
    remoteId: "fixture",
    name: "飞书验证",
    provider: "feishu",
    visible: true,
    writable: true,
    color: "#5474ee",
  };
  const feishu = {
    authStatus: async () => ({ available: true }),
    calendars: async () => [feishuCalendar],
    events: async () => structuredClone(feishuEvents),
    create: async (
      _calendar: CalendarSource,
      value: CalendarEvent,
      key: string,
    ) => {
      const saved = {
        ...value,
        remoteId: key,
        remoteFingerprint: fingerprint(value),
        syncState: "synced" as const,
      };
      feishuEvents.push(saved);
      return saved;
    },
  } as unknown as FeishuClient;
  const service = new CalendarService(
    store,
    feishu,
    vault,
    undefined,
    (connection) =>
      connection.kind === "webdav"
        ? new WebDAVClient(connection, server.fetch)
        : new CalDAVClient(connection, server.fetch),
  );
  return { directory, store, service, vault, feishuEvents };
}

async function connect(
  service: CalendarService,
  id: string,
  hostname = "cloud.example",
  syncTeaching = false,
) {
  await service.saveConnection({
    id,
    kind: "webdav",
    name: id,
    url: `https://${hostname}/dav/`,
    username: "fixture-user",
    password: "fixture-password",
    enabled: true,
    syncTeaching,
  });
  await service.sync(range);
  return `webdav:${id}`;
}

test("multiple WebDAV accounts and Feishu run together with source-isolated data and independent pause", async (t) => {
  const server = new DAVServer();
  const a = await device(t, server);
  const first = await connect(a.service, "first");
  const second = await connect(a.service, "second", "second.example");
  await a.service.settings({ feishuEnabled: true });
  await a.service.sync(range);
  await a.service.saveEvent({ event: event(first, "第一网盘日程") });
  await a.service.saveEvent({ event: event(second, "第二网盘日程") });
  await a.service.saveEvent({
    event: event("feishu:fixture", "PRIVATE_FEISHU_TITLE"),
  });
  server.offline.add("cloud.example");
  await a.service.sync(range);
  assert.equal(a.feishuEvents.length, 1);
  assert.match(
    server.files.get("https://second.example/dav/FeiCalendar/calendar-v1.json")!
      .data,
    /第二网盘日程/,
  );
  assert.equal(a.store.state.queue.length, 1);
  server.offline.clear();
  const connection = (await a.service.snapshot()).connections.find(
    (item) => item.id === "first",
  )!;
  await a.service.saveConnection({ ...connection, enabled: false });
  const calls = server.requests.length;
  await a.service.sync(range);
  assert.ok(
    server.requests
      .slice(calls)
      .every((call) => !call.url.includes("cloud.example")),
  );
  await a.service.saveConnection({ ...connection, enabled: true });
  await a.service.sync(range);
  assert.equal(a.store.state.queue.length, 0);
  const cloud = [...server.files.values()].map((file) => file.data).join("\n");
  assert.doesNotMatch(
    cloud,
    /PRIVATE_FEISHU_TITLE|fixture-password|fixture-user|access_token|app_secret|connections/,
  );
  assert.doesNotMatch(
    await readFile(path.join(a.directory, "calendar.json"), "utf8"),
    /fixture-password|fixture-user/,
  );
});

test("two devices merge concurrent creates, surface edits as conflicts, and propagate deletions", async (t) => {
  const server = new DAVServer();
  const a = await device(t, server);
  const b = await device(t, server);
  const ca = await connect(a.service, "a");
  const cb = await connect(b.service, "b");
  await a.service.saveEvent({ event: event(ca, "A 新建") });
  await b.service.saveEvent({ event: event(cb, "B 新建") });
  await Promise.all([a.service.sync(range), b.service.sync(range)]);
  await a.service.sync(range);
  await b.service.sync(range);
  assert.equal(a.store.state.events.length, 2);
  assert.equal(b.store.state.events.length, 2);
  const ea = a.store.state.events.find((item) => item.title === "A 新建")!;
  const eb = b.store.state.events.find(
    (item) => item.remoteId === ea.remoteId,
  )!;
  await a.service.saveEvent({ event: { ...ea, title: "A 修改" } });
  await b.service.saveEvent({ event: { ...eb, title: "B 修改" } });
  await a.service.sync(range);
  await b.service.sync(range);
  assert.equal(b.store.state.queue[0].status, "conflict");
  assert.equal(b.store.state.queue[0].remote?.title, "A 修改");
  await b.service.resolveConflict(b.store.state.queue[0].id, "local");
  await b.service.sync(range);
  await a.service.sync(range);
  assert.equal(
    a.store.state.events.find((item) => item.remoteId === ea.remoteId)!.title,
    "B 修改",
  );
  await a.service.deleteEvent(ea.id);
  await a.service.sync(range);
  await b.service.sync(range);
  assert.equal(b.store.state.events.length, 1);
  await b.service.sync(range);
  assert.equal(b.store.state.events.length, 1);
});

test("WebDAV retries a lost create response with one resource and preserves a queued delete", async (t) => {
  const server = new DAVServer();
  const a = await device(t, server);
  const calendarId = await connect(a.service, "a");
  await a.service.saveEvent({ event: event(calendarId) });
  server.dropNextWrite = true;
  await a.service.sync(range);
  assert.equal(a.store.state.queue[0].status, "error");
  await a.service.deleteEvent(a.store.state.events[0].id);
  await a.service.sync(range);
  assert.equal(a.store.state.queue.length, 0);
  assert.equal(a.store.state.events.length, 0);
  const document = JSON.parse([...server.files.values()][0].data);
  assert.equal(Object.keys(document.events).length, 1);
  assert.equal(
    Object.values(document.events)[0] &&
      (Object.values(document.events)[0] as { deleted: boolean }).deleted,
    true,
  );
});

test("teaching preferences sync across devices and conflicting changes require a selection", async (t) => {
  const server = new DAVServer();
  const a = await device(t, server);
  const b = await device(t, server);
  await a.service.settings({
    teachingStartDate: "2026-09-01",
    teachingWeeks: 18,
  });
  await connect(a.service, "a", "cloud.example", true);
  await connect(b.service, "b", "cloud.example", true);
  assert.equal(b.store.state.settings.teachingStartDate, "2026-09-01");
  await a.service.settings({ teachingWeeks: 20 });
  await b.service.settings({ teachingWeeks: 22 });
  await a.service.sync(range);
  await b.service.sync(range);
  assert.equal(
    b.store.state.connections[0].teachingConflict?.teachingWeeks,
    20,
  );
  assert.equal(b.store.state.settings.teachingWeeks, 22);
  await b.service.resolveTeachingConflict("b", "remote");
  assert.equal(b.store.state.settings.teachingWeeks, 20);
  assert.equal(b.store.state.connections[0].teachingConflict, undefined);
});

test("editing an uncertain create preserves the initial retry payload and pushes the newest local edit", async (t) => {
  const server = new DAVServer();
  const a = await device(t, server);
  const calendarId = await connect(a.service, "a");
  await a.service.saveEvent({ event: event(calendarId, "初始版本") });
  server.dropNextWrite = true;
  await a.service.sync(range);
  await a.service.saveEvent({
    event: { ...a.store.state.events[0], title: "断线后的新版本" },
  });
  await a.service.sync(range);
  assert.equal(a.store.state.queue.length, 0);
  assert.equal(a.store.state.events[0].title, "断线后的新版本");
  const document = JSON.parse([...server.files.values()][0].data);
  assert.equal(Object.keys(document.events).length, 1);
  assert.equal(
    (Object.values(document.events)[0] as { title: string }).title,
    "断线后的新版本",
  );
});

test("CalDAV CRUD uses conditional writes, retains external fields, and rejects stale ETags", async () => {
  const server = new DAVServer();
  const client = new CalDAVClient(
    {
      id: "c",
      name: "CalDAV",
      kind: "caldav",
      url: "https://dav.example/",
      username: "fixture",
      password: "fixture",
      readOnly: false,
    },
    server.fetch,
  );
  const calendar: CalendarSource = {
    id: "c",
    remoteId: "https://dav.example/calendar/",
    name: "CalDAV",
    provider: "caldav",
    visible: true,
    writable: true,
    color: "#5474ee",
  };
  const saved = await client.create(calendar, event("c"), "stable-key");
  assert.equal(saved.reminder, 15);
  const resource = server.files.get(saved.remoteId!)!;
  resource.data = resource.data.replace(
    "END:VEVENT",
    "X-OTHER-CLIENT:preserve-me\r\nEND:VEVENT",
  );
  const updated = await client.update(
    calendar,
    { ...saved, title: "新标题" },
    saved,
  );
  assert.equal(updated.title, "新标题");
  assert.match(
    server.files.get(saved.remoteId!)!.data,
    /X-OTHER-CLIENT:preserve-me/,
  );
  await assert.rejects(
    client.update(calendar, { ...saved, title: "旧版本" }, saved),
    /已变化/,
  );
  await client.delete(calendar, saved.remoteId!, updated);
  assert.equal((await client.get(calendar, saved.remoteId!)).deleted, true);
});

test("CalDAV discovery, queued writes and recurrence cleanup work through the normal service entry points", async (t) => {
  const server = new DAVServer();
  const a = await device(t, server);
  await a.service.saveConnection({
    id: "caldav",
    kind: "caldav",
    name: "CalDAV",
    url: "https://dav.example/",
    username: "fixture",
    password: "fixture",
    readOnly: false,
  });
  await a.service.sync(range);
  assert.equal(a.store.state.syncError, undefined);
  const calendar = a.store.state.calendars.find(
    (item) => item.provider === "caldav",
  )!;
  assert.equal(calendar.writable, true);
  await a.service.saveEvent({ event: event(calendar.id) });
  await a.service.sync(range);
  assert.equal(a.store.state.queue.length, 0);
  assert.equal(a.store.state.events[0].syncState, "synced");
  await a.service.saveEvent({
    event: { ...event(calendar.id, "取消的新系列"), recurrence: "FREQ=WEEKLY" },
  });
  server.dropNextWrite = true;
  await a.service.sync(range);
  const pending = a.store.state.events.find(
    (item) => item.title === "取消的新系列",
  )!;
  await a.service.deleteEvent(pending.id, "all");
  await a.service.sync(range);
  assert.equal(a.store.state.queue.length, 0);
  assert.equal(server.files.size, 1);
  assert.equal(a.store.state.events.length, 1);
});

test("CalDAV recurring exceptions retain the series, can move outside the original week, and cancel one instance", async () => {
  const server = new DAVServer();
  const client = new CalDAVClient(
    {
      id: "c",
      name: "CalDAV",
      kind: "caldav",
      url: "https://dav.example/",
      username: "fixture",
      password: "fixture",
      readOnly: false,
    },
    server.fetch,
  );
  const calendar: CalendarSource = {
    id: "c",
    remoteId: "https://dav.example/calendar/",
    name: "CalDAV",
    provider: "caldav",
    visible: true,
    writable: true,
    color: "#5474ee",
  };
  const saved = await client.create(
    calendar,
    { ...event("c"), recurrence: "FREQ=WEEKLY" },
    "recurring-key",
  );
  assert.equal(saved.recurring, true);
  const moved = await client.update(
    calendar,
    {
      ...saved,
      title: "单次调整",
      start: "2026-12-20T01:00:00Z",
      end: "2026-12-20T02:00:00Z",
    },
    saved,
  );
  assert.equal(moved.title, "单次调整");
  assert.equal(moved.start, "2026-12-20T01:00:00.000Z");
  const resource = [...server.files.values()][0].data;
  assert.match(resource, /RRULE:FREQ=WEEKLY/);
  const remaining = await parseSubscription(resource, "c", range);
  assert.ok(remaining.some((item) => item.start.startsWith("2026-11-17")));
  await client.delete(calendar, moved.remoteId!, moved);
  assert.equal((await client.get(calendar, moved.remoteId!)).deleted, true);
});

test("CalDAV all-day events retain exclusive end dates and original resource UID", async () => {
  const initial = {
    ...event("c"),
    id: "original",
    allDay: true,
    start: "2026-11-10",
    end: "2026-11-13",
  };
  const data = updateCalendarData(exportICS([initial]), {
    ...initial,
    title: "跨日活动",
  });
  const [parsed] = await parseSubscription(data, "c", range);
  assert.equal(parsed.start, "2026-11-10");
  assert.equal(parsed.end, "2026-11-13");
  assert.match(data, /UID:original@feicalendar/);
});
