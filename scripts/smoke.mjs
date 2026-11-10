import { _electron as electron, expect } from "@playwright/test";
import { mkdtemp, mkdir, rm, readFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const directory = await mkdtemp(path.join(os.tmpdir(), "feicalendar-desktop-"));
const env = { ...process.env, FEICALENDAR_DATA_DIR: directory };
delete env.ELECTRON_RUN_AS_NODE;
const errors = [];
const launchOptions = process.env.FEICALENDAR_EXECUTABLE
  ? {
      executablePath: process.env.FEICALENDAR_EXECUTABLE,
      args: [],
      cwd: root,
      env,
    }
  : { args: [root], cwd: root, env };
await mkdir(path.join(root, "test-results"), { recursive: true });
let application;
try {
  application = await electron.launch(launchOptions);
  const page = await application.firstWindow();
  page.on("pageerror", (error) => errors.push(error.message));
  await expect(page.getByRole("heading", { name: "我的日历" })).toBeVisible();
  await page
    .getByRole("button", { name: "新建日程", exact: false })
    .first()
    .click();
  await page.getByLabel("日程标题", { exact: true }).fill("桌面验证日程");
  await page.getByLabel("地点", { exact: true }).fill("会议室 201");
  await page
    .getByLabel("日程描述", { exact: true })
    .fill("本地创建、持久化和编辑验证");
  await page.getByRole("button", { name: "保存日程", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  let state = await page.evaluate(() => window.calendar.snapshot());
  expect(state.events).toHaveLength(1);
  expect(state.events[0].location).toBe("会议室 201");
  await page.getByLabel("搜索日程", { exact: true }).fill("桌面验证");
  await page.locator(".search-result").first().click();
  await page.getByLabel("日程标题", { exact: true }).fill("编辑后的日程");
  await page.getByRole("button", { name: "保存日程", exact: true }).click();
  await page.getByLabel("搜索日程", { exact: true }).fill("编辑后");
  await expect(page.locator(".search-result")).toHaveCount(1);
  await page.getByLabel("关闭搜索", { exact: true }).click();
  for (const name of ["日", "三日", "月", "年", "日程", "周"]) {
    await page.getByRole("tab", { name, exact: true }).click();
    await expect(page.getByRole("tab", { name, exact: true })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  }
  await page.getByTitle("添加日历", { exact: true }).click();
  await page.getByLabel("日历名称", { exact: true }).fill("生活安排");
  await page.getByRole("button", { name: "保存日历", exact: true }).click();
  state = await page.evaluate(() => window.calendar.snapshot());
  expect(state.calendars).toHaveLength(2);
  await page.getByTitle("设置", { exact: true }).click();
  await page.getByLabel("外观", { exact: true }).selectOption("dark");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.getByLabel("外观", { exact: true }).selectOption("light");
  await page.getByLabel("关闭设置", { exact: true }).click();
  await page
    .getByRole("button", { name: "新建日程", exact: false })
    .first()
    .click();
  await page.getByLabel("日程标题", { exact: true }).fill("每周规划");
  await page
    .getByLabel("重复规则", { exact: true })
    .selectOption("FREQ=WEEKLY");
  await page.getByRole("button", { name: "保存日程", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.evaluate(async () => {
    await window.calendar.saveConnection({
      id: "encryption-test",
      kind: "caldav",
      name: "加密验证",
      url: "https://caldav.feishu.cn",
      username: "fixture-user",
      password: "fixture-secret",
    });
  });
  const disk = await readFile(path.join(directory, "calendar.json"), "utf8");
  expect(disk).not.toContain("fixture-secret");
  expect(disk).not.toContain("fixture-user");
  const encrypted = await readFile(
    path.join(directory, "connections.encrypted"),
  );
  expect(encrypted.toString()).not.toContain("fixture-secret");
  state = await page.evaluate(() => window.calendar.snapshot());
  expect(state.connections[0].hasPassword).toBe(true);
  expect(state.connections[0].password).toBeUndefined();
  await page.evaluate(() =>
    window.calendar.removeConnection("encryption-test"),
  );
  await page.screenshot({
    path: path.join(root, "test-results", "desktop-week.png"),
  });
  await page.getByLabel("搜索日程", { exact: true }).fill("编辑后");
  await page.locator(".search-result").first().click();
  await page.getByTitle("删除日程", { exact: true }).click();
  await page.getByRole("button", { name: "确认删除", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  state = await page.evaluate(() => window.calendar.snapshot());
  expect(state.events).toHaveLength(1);
  await application.close();
  application = await electron.launch(launchOptions);
  const reopened = await application.firstWindow();
  await expect(
    reopened.getByRole("heading", { name: "我的日历" }),
  ).toBeVisible();
  state = await reopened.evaluate(() => window.calendar.snapshot());
  expect(state.events[0].title).toBe("每周规划");
  expect(state.calendars).toHaveLength(2);
  expect(errors).toEqual([]);
  console.log(
    "PASS desktop CRUD, search, six views, calendar creation, themes, recurrence, credential encryption, restart persistence",
  );
} finally {
  await application?.close();
  // This directory is created by mkdtemp above and contains only this test's state.
  await rm(directory, { recursive: true, force: true });
}
