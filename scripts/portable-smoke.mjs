import { chromium, expect } from "@playwright/test";
import { spawn, execFile } from "node:child_process";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
} from "node:fs/promises";
import { createServer } from "node:net";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { checkCalendarViews } from "./check-views.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { version } = JSON.parse(
  await readFile(path.join(root, "package.json"), "utf8"),
);
const directory = await mkdtemp(
  path.join(os.tmpdir(), "feicalendar-portable-"),
);
const firstLocation = path.join(directory, "飞历 独立目录");
const secondLocation = path.join(directory, "移动后的 便携目录");
const dataDirectory = path.join(directory, "用户数据");
const screenshots = path.join(root, "test-results");
await mkdir(firstLocation);
await mkdir(secondLocation);
await mkdir(dataDirectory);
await mkdir(screenshots, { recursive: true });
let executable = path.join(firstLocation, "FeiCalendar.exe");
await copyFile(
  process.env.FEICALENDAR_PORTABLE ||
    path.join(root, "release", `FeiCalendar-${version}-win-x64.exe`),
  executable,
);
const env = { ...process.env, FEICALENDAR_DATA_DIR: dataDirectory };
for (const key of Object.keys(env)) {
  if (key.toLowerCase() === "path") delete env[key];
}
// The standalone application must find its bundled runtime and Feishu client.
env.PATH = [
  path.join(process.env.SystemRoot, "System32"),
  process.env.SystemRoot,
].join(path.delimiter);
delete env.ELECTRON_RUN_AS_NODE;
delete env.FEICALENDAR_DEV_URL;
const errors = [];
let child;
let browser;

async function launch() {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = server.address().port;
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  child = spawn(
    executable,
    [`--remote-debugging-port=${port}`, "--remote-debugging-address=127.0.0.1"],
    {
      cwd: path.dirname(executable),
      env,
      windowsHide: true,
      stdio: "ignore",
    },
  );
  let startupError;
  child.on("error", (error) => {
    startupError = error;
  });
  const deadline = Date.now() + 120_000;
  let endpoint;
  while (Date.now() < deadline) {
    if (startupError) throw startupError;
    if (child.exitCode !== null)
      throw new Error(
        `Portable exited during startup with code ${child.exitCode}`,
      );
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`, {
        signal: AbortSignal.timeout(1000),
      });
      endpoint = (await response.json()).webSocketDebuggerUrl;
      break;
    } catch {
      await delay(300);
    }
  }
  if (!endpoint) throw new Error("Portable startup exceeded 120 seconds");
  browser = await chromium.connectOverCDP(endpoint);
  const context = browser.contexts()[0];
  const page = context.pages()[0] || (await context.waitForEvent("page"));
  page.on("pageerror", (error) => errors.push(error.message));
  await expect(page.getByRole("heading", { name: "我的日历" })).toBeVisible({
    timeout: 20_000,
  });
  return page;
}

async function close() {
  if (browser?.isConnected()) {
    const page = browser.contexts()[0].pages()[0];
    await page
      ?.getByTitle("关闭应用", { exact: true })
      .click()
      .catch(() => {});
    await browser.close();
  }
  if (child && child.exitCode === null) {
    await Promise.race([once(child, "exit"), delay(15_000)]);
    if (child.exitCode === null) {
      await promisify(execFile)(
        "taskkill",
        ["/PID", String(child.pid), "/T", "/F"],
        { windowsHide: true },
      );
      throw new Error(
        "Portable wrapper failed to exit after closing the application",
      );
    }
  }
  browser = undefined;
  child = undefined;
}

try {
  let page = await launch();
  const auth = await page.evaluate(() => window.calendar.authStatus());
  expect(["已连接飞书账号", "飞书用户授权已过期或尚未登录"]).toContain(
    auth.message,
  );
  await page
    .getByRole("button", { name: "新建日程", exact: false })
    .first()
    .click();
  await page.getByLabel("日程标题", { exact: true }).fill("便携版独立运行验证");
  const date = (
    await page.getByLabel("开始时间", { exact: true }).inputValue()
  ).slice(0, 10);
  await page.getByLabel("开始时间", { exact: true }).fill(`${date}T09:00`);
  await page.getByLabel("结束时间", { exact: true }).fill(`${date}T10:00`);
  await page.getByLabel("地点", { exact: true }).fill("便携版测试");
  await page.getByRole("button", { name: "保存日程", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await checkCalendarViews(page, screenshots, "portable");
  await close();

  const relocated = path.join(secondLocation, "飞历.exe");
  await rename(executable, relocated);
  executable = relocated;
  page = await launch();
  await expect(page.locator(".fc-dayGridMonth-view")).toBeVisible();
  let state = await page.evaluate(() => window.calendar.snapshot());
  expect(state.settings.calendarView).toBe("dayGridMonth");
  expect(state.events).toHaveLength(1);
  expect(state.events[0].title).toBe("便携版独立运行验证");
  await page.getByLabel("搜索日程", { exact: true }).fill("便携版独立");
  await page.locator(".search-result").first().click();
  await page
    .getByLabel("日程标题", { exact: true })
    .fill("便携版移动后编辑成功");
  await page.getByRole("button", { name: "保存日程", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  state = await page.evaluate(() => window.calendar.snapshot());
  expect(state.events[0].title).toBe("便携版移动后编辑成功");
  await page.getByLabel("搜索日程", { exact: true }).fill("移动后编辑");
  await page.locator(".search-result").first().click();
  await page.getByTitle("删除日程", { exact: true }).click();
  await page.getByRole("button", { name: "确认删除", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  state = await page.evaluate(() => window.calendar.snapshot());
  expect(state.events).toHaveLength(0);
  expect(errors).toEqual([]);
  await close();
  const saved = JSON.parse(
    await readFile(path.join(dataDirectory, "calendar.json"), "utf8"),
  );
  expect(saved.events).toHaveLength(0);
  console.log(
    "PASS standalone portable EXE, bundled Feishu client, six rendered views, local CRUD, moved/renamed EXE, restart persistence, zero renderer errors",
  );
} finally {
  await close();
  // Only remove the isolated directory created by this test.
  await rm(directory, { recursive: true, force: true });
}
