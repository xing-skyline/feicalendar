import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { OAuthAuthorization } from "../electron/oauth";
import {
  OAuthCalendarClient,
  googleEvent,
  graphEvent,
  graphBody,
} from "../electron/oauth-calendar";
import type { CalendarSource, Connection } from "../src/shared/types";
import { emptyState } from "../electron/store";
import { eventDraft } from "../src/shared/capture";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Store } from "../electron/store";
import { CalendarService } from "../electron/service";
import { FeishuClient } from "../electron/feishu";

function connection(kind: "google" | "microsoft"): Connection {
  return {
    id: "test",
    kind,
    name: kind,
    url: "",
    username: "",
    readOnly: false,
    oauth: {
      clientId: "fixture-client",
      clientSecret: "fixture-secret",
      tenant: "common",
      accessToken: "fixture-token",
      refreshToken: "fixture-refresh",
      expiresAt: Date.now() + 3600_000,
      accountId: "account",
    },
  };
}
const calendar: CalendarSource = {
  id: "test-calendar",
  remoteId: "remote",
  connectionId: "test",
  provider: "google",
  name: "fixture",
  color: "#5474ee",
  writable: true,
  visible: true,
};
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });

test("Desktop OAuth checks state and exchanges the verified PKCE code, with cancellation", async () => {
  let challenge = "";
  const flow = new OAuthAuthorization(async (url, init) => {
    if (String(url).includes("/token")) {
      const values = new URLSearchParams(String(init!.body));
      assert.equal(
        createHash("sha256")
          .update(values.get("code_verifier")!)
          .digest("base64url"),
        challenge,
      );
      assert.equal(values.get("code"), "fixture-code");
      return json({
        access_token: "fixture-token",
        refresh_token: "fixture-refresh",
        expires_in: 3600,
      });
    }
    return json({ sub: "fixture-account", email: "fixture@example.test" });
  });
  const input = {
    id: "",
    name: "Google fixture",
    kind: "google" as const,
    clientId: "fixture-client",
    clientSecret: "fixture-secret",
    tenant: "common",
  };
  const result = await flow.connect(input, async (address) => {
    const url = new URL(address);
    challenge = url.searchParams.get("code_challenge")!;
    assert.equal(url.searchParams.get("code_challenge_method"), "S256");
    const callback = new URL(url.searchParams.get("redirect_uri")!);
    callback.search = new URLSearchParams({
      state: "invalid",
      code: "fixture-code",
    }).toString();
    assert.equal((await fetch(callback)).status, 400);
    callback.searchParams.set("state", url.searchParams.get("state")!);
    assert.equal((await fetch(callback)).status, 200);
  });
  assert.equal(result.oauth!.accountId, "fixture-account");
  assert.equal(result.username, "fixture@example.test");
  await assert.rejects(
    flow.connect(input, async () => flow.cancel()),
    /取消/,
  );
});

test("Google requests refresh credentials and retry creates by stable ID without duplicates", async () => {
  const details = connection("google");
  details.oauth!.expiresAt = 0;
  const records = new Map<string, Record<string, unknown>>();
  let creates = 0;
  let persisted = 0;
  const client = new OAuthCalendarClient(
    details,
    async (updated) => {
      persisted++;
      assert.equal(updated.oauth!.accessToken, "new-fixture-token");
    },
    async (address, init) => {
      const url = new URL(String(address));
      if (url.hostname === "oauth2.googleapis.com")
        return json({ access_token: "new-fixture-token", expires_in: 3600 });
      assert.equal(
        new Headers(init!.headers).get("Authorization"),
        "Bearer new-fixture-token",
      );
      const id = url.pathname.split("/").at(-1)!;
      if (init?.method === "POST") {
        creates++;
        const body = JSON.parse(String(init.body));
        const record = { ...body, etag: '"v1"' };
        records.set(body.id, record);
        return json(record);
      }
      if (init?.method === "PATCH") {
        assert.equal(new Headers(init.headers).get("If-Match"), '"v1"');
        const body = JSON.parse(String(init.body));
        assert.deepEqual(Object.keys(body), ["summary"]);
        const record = { ...records.get(id), ...body };
        records.set(id, record);
        return json(record);
      }
      if (init?.method === "DELETE") {
        records.delete(id);
        return new Response(null, { status: 204 });
      }
      return records.has(id) ? json(records.get(id)) : json({}, 404);
    },
  );
  const event = {
    ...eventDraft(emptyState(), "2026-11-11T09:00:00+08:00"),
    title: "fixture",
  };
  const first = await client.create(calendar, event, "fixture-key");
  assert.equal(
    (await client.create(calendar, event, "fixture-key")).remoteId,
    first.remoteId,
  );
  assert.equal(creates, 1);
  assert.equal(persisted, 1);
  const updated = await client.update(
    calendar,
    { ...first, title: "changed" },
    first,
  );
  assert.equal(updated.title, "changed");
  await client.delete(calendar, first.remoteId!, updated);
  assert.equal((await client.get(calendar, first.remoteId!)).deleted, true);
});

test("Microsoft retries by stored creation key, preserves all-day dates and rejects foreign pagination", async () => {
  const details = connection("microsoft");
  const source = { ...calendar, provider: "microsoft" as const };
  const records: Record<string, unknown>[] = [];
  let creates = 0;
  const client = new OAuthCalendarClient(
    details,
    async () => {},
    async (address, init) => {
      const url = new URL(String(address));
      if (init?.method === "POST") {
        creates++;
        const body = JSON.parse(String(init.body));
        const record = {
          ...body,
          id: "graph-event",
          type: "singleInstance",
          "@odata.etag": '"v1"',
        };
        records.push(record);
        return json(record);
      }
      if (url.searchParams.has("$filter")) {
        assert.match(
          url.searchParams.get("$filter")!,
          /singleValueExtendedProperties/,
        );
        return json({ value: records });
      }
      return json(records[0]);
    },
  );
  const event = {
    ...eventDraft(emptyState(), "2026-11-11", "2026-11-12", true),
    title: "all day",
  };
  const created = await client.create(source, event, "fixture-key");
  assert.equal(created.start, "2026-11-11");
  assert.equal(created.end, "2026-11-12");
  await client.create(source, event, "fixture-key");
  assert.equal(creates, 1);
  assert.equal(graphBody(event).start.timeZone, "China Standard Time");
  let count = 0;
  const bad = new OAuthCalendarClient(
    details,
    async () => {},
    async () => {
      count++;
      return json({
        value: [],
        "@odata.nextLink": "https://other.example.test/",
      });
    },
  );
  await assert.rejects(bad.calendars(), /分页地址/);
  assert.equal(count, 1);
  assert.equal(
    googleEvent(calendar, { id: "cancelled", status: "cancelled" }).deleted,
    true,
  );
  assert.equal(
    graphEvent(source, { id: "cancelled", isCancelled: true }).deleted,
    true,
  );
});

test("OAuth connections retain account identity, coexist, pause independently and keep tokens out of snapshots", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "feicalendar-oauth-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = new Store(directory);
  await store.load();
  const secrets = new Map<string, Connection>();
  const service = new CalendarService(store, new FeishuClient("unused"), {
    read: async (id) => structuredClone(secrets.get(id)),
    write: async (value) => {
      secrets.set(value.id, structuredClone(value));
    },
    remove: async (id) => {
      secrets.delete(id);
    },
  });
  const google = { ...connection("google"), id: "google" };
  const microsoft = { ...connection("microsoft"), id: "microsoft" };
  await service.saveOAuthConnection(google);
  await service.saveOAuthConnection(microsoft);
  const publicConnection = (await service.snapshot()).connections[0];
  await service.saveConnection({ ...publicConnection, enabled: false });
  assert.equal(
    store.state.connections.find((item) => item.id === "google")!.enabled,
    false,
  );
  assert.equal(
    store.state.connections.find((item) => item.id === "microsoft")!.enabled,
    true,
  );
  await service.saveOAuthConnection(google, true);
  assert.equal(
    store.state.connections.find((item) => item.id === "google")!.enabled,
    false,
  );
  await assert.rejects(
    service.saveOAuthConnection(
      { ...google, oauth: { ...google.oauth!, accountId: "different" } },
      true,
    ),
    /账号与原连接不同/,
  );
  assert.equal(secrets.get("google")!.oauth!.accountId, "account");
  for (const value of [
    JSON.stringify(await service.snapshot()),
    await readFile(path.join(directory, "calendar.json"), "utf8"),
  ]) {
    assert.ok(!value.includes("fixture-token"));
    assert.ok(!value.includes("fixture-refresh"));
    assert.ok(!value.includes("fixture-secret"));
  }
  await service.removeConnection("google");
  assert.equal(secrets.has("google"), false);
  assert.equal(store.state.connections.length, 1);
  await assert.rejects(service.saveOAuthConnection(google, true), /已移除/);
});

test("Google paginates calendar instances and refreshes once after a rejected token", async () => {
  const details = connection("google");
  let requests = 0;
  let refreshes = 0;
  let persisted = 0;
  const client = new OAuthCalendarClient(
    details,
    async () => {
      persisted++;
    },
    async (address, init) => {
      const url = new URL(String(address));
      if (url.hostname === "oauth2.googleapis.com") {
        refreshes++;
        return json({
          access_token: "rotated-token",
          refresh_token: "rotated-refresh",
          expires_in: 3600,
        });
      }
      requests++;
      if (requests === 1) return json({}, 401);
      assert.equal(
        new Headers(init!.headers).get("Authorization"),
        "Bearer rotated-token",
      );
      assert.equal(url.searchParams.get("singleEvents"), "true");
      const second = url.searchParams.get("pageToken") === "second";
      return json({
        items: [
          {
            id: second ? "two" : "one",
            start: { date: "2026-11-11" },
            end: { date: "2026-11-12" },
          },
        ],
        ...(second ? {} : { nextPageToken: "second" }),
      });
    },
  );
  assert.equal(
    (await client.events(calendar, { start: "2026-11-01", end: "2026-12-01" }))
      .length,
    2,
  );
  assert.equal(refreshes, 1);
  assert.equal(persisted, 1);
  assert.equal(details.oauth!.refreshToken, "rotated-refresh");
});

test("Microsoft converts all-day original timezone and preserves conditional updates", async () => {
  const source = { ...calendar, provider: "microsoft" as const };
  const record = {
    id: "day",
    subject: "all day",
    isAllDay: true,
    originalStartTimeZone: "China Standard Time",
    start: { dateTime: "2026-11-10T16:00:00.0000000", timeZone: "UTC" },
    end: { dateTime: "2026-11-11T16:00:00.0000000", timeZone: "UTC" },
    "@odata.etag": '"v1"',
  };
  let converted = 0;
  const client = new OAuthCalendarClient(
    connection("microsoft"),
    async () => {},
    async (address, init) => {
      const headers = new Headers(init!.headers);
      if (init!.method === "PATCH") {
        assert.equal(headers.get("If-Match"), '"v1"');
        assert.deepEqual(JSON.parse(String(init!.body)), {
          subject: "changed",
        });
        return json({}, 412);
      }
      if (headers.get("Prefer")!.includes('timezone="China Standard Time"')) {
        converted++;
        return json({
          ...record,
          start: {
            dateTime: "2026-11-11T00:00:00.0000000",
            timeZone: "China Standard Time",
          },
          end: {
            dateTime: "2026-11-12T00:00:00.0000000",
            timeZone: "China Standard Time",
          },
        });
      }
      return json(record);
    },
  );
  const event = await client.get(source, "day");
  assert.equal(event.start, "2026-11-11");
  assert.equal(event.end, "2026-11-12");
  assert.equal(converted, 1);
  await assert.rejects(
    client.update(source, { ...event, title: "changed" }, event),
    /412/,
  );
});
