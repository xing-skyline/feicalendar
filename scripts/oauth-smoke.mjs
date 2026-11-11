import { _electron as electron, expect } from "@playwright/test";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const root = process.cwd();
const directory = await mkdtemp(
  path.join(os.tmpdir(), "feicalendar-oauth-ui-"),
);
const env = {
  ...process.env,
  FEICALENDAR_DATA_DIR: directory,
  FEICALENDAR_DISABLE_NOTIFICATIONS: "1",
};
delete env.ELECTRON_RUN_AS_NODE;
let application;
try {
  application = await electron.launch({
    args: [path.join(root, "scripts/fixtures/oauth-launch.cjs")],
    cwd: root,
    env,
  });
  const page = await application.firstWindow();
  page.setDefaultTimeout(20_000);
  await expect(page.getByRole("heading", { name: "我的日历" })).toBeVisible();
  await page.evaluate(() =>
    window.calendar.settings({ autoSync: false, feishuEnabled: false }),
  );
  await page.getByTitle("设置", { exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "日历连接", exact: true })
    .click();
  for (const provider of ["Google", "Microsoft"]) {
    await page
      .getByRole("button", { name: `添加 ${provider} 账号`, exact: true })
      .click();
    await page
      .getByLabel("Client ID", { exact: true })
      .fill(`fixture-${provider}-client`);
    if (provider === "Google")
      await page
        .getByLabel("Client Secret", { exact: true })
        .fill("fixture-secret");
    await page
      .getByRole("button", { name: "打开浏览器授权", exact: true })
      .click();
    await expect(
      page.getByRole("heading", {
        name: `${provider} 桌面应用授权`,
        exact: true,
      }),
    ).toHaveCount(0, { timeout: 20_000 });
  }
  let state = await page.evaluate(() => window.calendar.snapshot());
  expect(state.connections).toHaveLength(2);
  expect(
    state.calendars.filter((item) =>
      ["google", "microsoft"].includes(item.provider),
    ),
  ).toHaveLength(2);
  expect(JSON.stringify(state)).not.toMatch(
    /fixture-(?:secret|google-token|google-refresh|microsoft-token|microsoft-refresh)/,
  );
  const googleCard = page
    .locator("article.reminder-card")
    .filter({ has: page.getByText("Google Calendar", { exact: true }) });
  await googleCard.getByLabel("启用", { exact: true }).click();
  await expect
    .poll(
      async () =>
        (
          await page.evaluate(() => window.calendar.snapshot())
        ).connections.find((item) => item.kind === "google").enabled,
    )
    .toBe(false);
  await googleCard.getByLabel("启用", { exact: true }).click();
  await expect
    .poll(
      async () =>
        (
          await page.evaluate(() => window.calendar.snapshot())
        ).connections.find((item) => item.kind === "google").enabled,
    )
    .toBe(true);
  const range = { start: "2026-11-01", end: "2026-12-01" };
  await page.evaluate(async (range) => {
    const state = await window.calendar.snapshot();
    for (const calendar of state.calendars.filter((item) =>
      ["google", "microsoft"].includes(item.provider),
    )) {
      await window.calendar.saveEvent({
        event: {
          id: "",
          calendarId: calendar.id,
          title: `${calendar.provider} fixture`,
          start: "2026-11-12T09:00:00+08:00",
          end: "2026-11-12T10:00:00+08:00",
          allDay: false,
          description: "",
          location: "",
          reminder: 15,
          recurrence: "",
          completed: false,
          syncState: "local",
        },
      });
    }
    await window.calendar.sync(range);
  }, range);
  state = await page.evaluate(() => window.calendar.snapshot());
  expect(state.queue).toHaveLength(0);
  expect(state.events).toHaveLength(2);
  await page.evaluate(async (range) => {
    for (const event of (await window.calendar.snapshot()).events)
      await window.calendar.saveEvent({
        event: { ...event, title: `${event.title} changed` },
      });
    await window.calendar.sync(range);
  }, range);
  expect(
    await application.evaluate(() =>
      Object.values(globalThis.oauthFixtureRecords).every((records) =>
        [...records.values()].every((event) =>
          (event.summary || event.subject).endsWith("changed"),
        ),
      ),
    ),
  ).toBe(true);
  // A remote edit after the local edit must be presented as a conflict.
  await page.evaluate(async () => {
    const event = (await window.calendar.snapshot()).events.find((item) =>
      item.title.startsWith("google"),
    );
    await window.calendar.saveEvent({
      event: { ...event, title: "local conflict" },
    });
  });
  await application.evaluate(() => {
    for (const event of globalThis.oauthFixtureRecords.google.values())
      event.summary = "remote conflict";
  });
  await page.evaluate((range) => window.calendar.sync(range), range);
  state = await page.evaluate(() => window.calendar.snapshot());
  expect(state.queue[0].status).toBe("conflict");
  await page.evaluate(
    (id) => window.calendar.resolveConflict(id, "remote"),
    state.queue[0].id,
  );
  expect(
    (await page.evaluate(() => window.calendar.snapshot())).events.some(
      (item) => item.title === "remote conflict",
    ),
  ).toBe(true);
  await page.evaluate(async (range) => {
    for (const event of (await window.calendar.snapshot()).events)
      await window.calendar.deleteEvent(event.id);
    await window.calendar.sync(range);
  }, range);
  expect(
    (await page.evaluate(() => window.calendar.snapshot())).queue,
  ).toHaveLength(0);
  expect(
    await application.evaluate(() =>
      Object.values(globalThis.oauthFixtureRecords).every(
        (records) => records.size === 0,
      ),
    ),
  ).toBe(true);
  const database = await readFile(
    path.join(directory, "calendar.json"),
    "utf8",
  );
  const encrypted = await readFile(
    path.join(directory, "connections.encrypted"),
  );
  for (const secret of [
    "fixture-secret",
    "fixture-google-token",
    "fixture-google-refresh",
    "fixture-microsoft-token",
    "fixture-microsoft-refresh",
  ]) {
    expect(database).not.toContain(secret);
    expect(encrypted.includes(Buffer.from(secret))).toBe(false);
  }
  console.log(
    "PASS Google/Microsoft mocked browser OAuth, real IPC/vault, multiple accounts, pause/resume, create/update/delete and conflict resolution",
  );
} finally {
  await application?.close();
  await rm(directory, { recursive: true, force: true });
}
