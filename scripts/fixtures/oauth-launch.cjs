const { shell } = require("electron");

const originalFetch = globalThis.fetch;
const records = { google: new Map(), microsoft: new Map() };
globalThis.oauthFixtureRecords = records;
const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status });
globalThis.fetch = async (address, init = {}) => {
  const url = new URL(String(address));
  const kind = url.hostname.includes("google") ? "google" : "microsoft";
  if (url.pathname.endsWith("/token"))
    return json({
      access_token: `fixture-${kind}-token`,
      refresh_token: `fixture-${kind}-refresh`,
      expires_in: 3600,
    });
  if (url.pathname.endsWith("/userinfo"))
    return json({ sub: "google-account", email: "google@example.test" });
  if (url.pathname.endsWith("/me"))
    return json({
      id: "microsoft-account",
      userPrincipalName: "microsoft@example.test",
    });
  if (url.pathname.endsWith("/calendarList"))
    return json({
      items: [
        { id: "primary", summary: "Google 测试日历", accessRole: "owner" },
      ],
    });
  if (url.pathname.endsWith("/me/calendars"))
    return json({
      value: [{ id: "primary", name: "Outlook 测试日历", canEdit: true }],
    });
  const collection = records[kind];
  const id = url.pathname.split("/").at(-1);
  if (init.method === "POST") {
    const body = JSON.parse(init.body);
    const key = body.id || body.transactionId;
    const record = {
      ...body,
      id: key,
      etag: '"v1"',
      "@odata.etag": '"v1"',
      type: "singleInstance",
    };
    collection.set(key, record);
    return json(record);
  }
  if (init.method === "PATCH") {
    const record = {
      ...collection.get(id),
      ...JSON.parse(init.body),
      etag: '"v2"',
      "@odata.etag": '"v2"',
    };
    collection.set(id, record);
    return json(record);
  }
  if (init.method === "DELETE") {
    collection.delete(id);
    return new Response(null, { status: 204 });
  }
  if (id === "events" || id === "calendarView") {
    let values = [...collection.values()];
    if (url.searchParams.has("$filter"))
      values = values.filter((item) =>
        url.searchParams.get("$filter").includes(item.transactionId),
      );
    return json({ [kind === "google" ? "items" : "value"]: values });
  }
  if (collection.has(id)) return json(collection.get(id));
  if (url.pathname.includes("/events/")) return json({}, 404);
  throw new Error("Unexpected fixture endpoint");
};
shell.openExternal = async (address) => {
  const authorization = new URL(address);
  const callback = new URL(authorization.searchParams.get("redirect_uri"));
  callback.search = new URLSearchParams({
    state: authorization.searchParams.get("state"),
    code: "fixture-code",
  }).toString();
  const response = await originalFetch(callback);
  if (!response.ok) throw new Error("Fixture authorization callback failed");
};

require("./productivity-launch.cjs");
