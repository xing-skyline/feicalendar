import { _electron as electron, expect } from "@playwright/test";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import koffi from "koffi";

function detectShellDesktop() {
  if (process.platform !== "win32") return false;
  try {
    const lib = koffi.load("user32.dll");
    const proc = koffi.proto(
      "int __stdcall FeiEnumWindow(uintptr_t hwnd, intptr_t param)",
    );
    const enumWindows = lib.func("EnumWindows", "int", [
      koffi.pointer(proc),
      "intptr_t",
    ]);
    const findChild = lib.func(
      "uintptr_t __stdcall FindWindowExW(uintptr_t parent, uintptr_t after, str16 className, str16 title)",
    );
    let found = false;
    enumWindows((hwnd) => {
      if (findChild(hwnd, 0, "SHELLDLL_DefView", null)) {
        found = true;
        return 0;
      }
      return 1;
    }, 0);
    return found;
  } catch {
    return false;
  }
}

const expectedEmbedded = detectShellDesktop() ? "embedded" : "floating";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const directory = await mkdtemp(path.join(os.tmpdir(), "feicalendar-widget-"));
const env = {
  ...process.env,
  FEICALENDAR_DATA_DIR: directory,
  FEICALENDAR_DISABLE_NOTIFICATIONS: "1",
};
delete env.ELECTRON_RUN_AS_NODE;
const errors = [];
let application;
try {
  application = await electron.launch({
    args: [path.join(root, "scripts/fixtures/widget-launch.cjs")],
    cwd: root,
    env,
  });
  const page = await application.firstWindow();
  page.on("pageerror", (error) => errors.push(error.message));
  await expect(page.getByRole("heading", { name: "我的日历" })).toBeVisible();
  await page.getByTitle("设置", { exact: true }).click();
  await page.getByRole("button", { name: "桌面日历", exact: true }).click();
  await page.getByLabel("开启桌面日历", { exact: true }).click();
  await expect(page.getByLabel("开启桌面日历", { exact: true })).toBeChecked();
  await expect
    .poll(() => page.evaluate(() => window.calendar.desktopStatus()))
    .toEqual({ mode: expectedEmbedded, visible: true });
  let panel =
    application.windows().find((item) => item.url().endsWith("#desktop")) ||
    (await application.waitForEvent("window"));
  panel.on("pageerror", (error) => errors.push(error.message));
  await expect(panel.locator(".desktop-panel")).toBeVisible();
  await expect(panel.locator(".desktop-week")).toHaveCount(6);
  for (const mode of ["floating", "topmost", "embedded"]) {
    await page.getByLabel("桌面窗口模式").selectOption(mode);
    await expect
      .poll(() => page.evaluate(() => window.calendar.desktopStatus()))
      .toEqual({
        mode: mode === "embedded" ? expectedEmbedded : "floating",
        visible: true,
      });
    await expect
      .poll(() =>
        application.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows()
            .find((win) => win.webContents.getURL().endsWith("#desktop"))
            ?.isAlwaysOnTop(),
        ),
      )
      .toBe(mode === "topmost");
  }
  panel = application.windows().find((item) => item.url().endsWith("#desktop"));
  // Model cursor movement without moving the user's system pointer. The real
  // renderer pointer capture, IPC and native SetWindowPos path still execute.
  await application.evaluate(({ screen }) => {
    globalThis.originalCursorPosition = screen.getCursorScreenPoint;
    globalThis.fixtureCursorPosition = { x: 500, y: 200 };
    screen.getCursorScreenPoint = () => globalThis.fixtureCursorPosition;
  });
  const bounds = () =>
    application.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .find((win) => win.webContents.getURL().endsWith("#desktop"))
        .getBounds(),
    );
  const beforeMove = await bounds();
  await panel.mouse.move(130, 22);
  await panel.mouse.down();
  await application.evaluate(() => {
    globalThis.fixtureCursorPosition = { x: 380, y: 260 };
  });
  await expect.poll(async () => (await bounds()).x).toBe(beforeMove.x - 120);
  await expect.poll(async () => (await bounds()).y).toBe(beforeMove.y + 60);
  await panel.mouse.up();
  await expect
    .poll(
      async () =>
        JSON.parse(
          await readFile(path.join(directory, "desktop-panel.json"), "utf8"),
        ).x,
    )
    .toBe(beforeMove.x - 120);
  const beforeResize = await bounds();
  await panel.mouse.move(beforeResize.width - 10, beforeResize.height - 10);
  await panel.mouse.down();
  await application.evaluate(() => {
    globalThis.fixtureCursorPosition = { x: 440, y: 300 };
  });
  await expect
    .poll(async () => (await bounds()).width)
    .toBe(beforeResize.width + 60);
  await panel.mouse.up();
  await application.evaluate(({ screen }) => {
    screen.getCursorScreenPoint = globalThis.originalCursorPosition;
  });
  await page.evaluate(() => window.calendar.desktop("reset"));
  const trayItem = async (label) =>
    application.evaluate((_electron, name) => {
      const item = globalThis.observedTrayMenu.items.find(
        (entry) => entry.label === name,
      );
      if (!item) throw new Error(`Tray menu missing ${name}`);
      item.click(item);
    }, label);
  await trayItem("暂时隐藏桌面日历");
  await expect
    .poll(() => page.evaluate(() => window.calendar.desktopStatus()))
    .toEqual({ mode: expectedEmbedded, visible: false });
  await trayItem("显示桌面日历");
  await expect
    .poll(() => page.evaluate(() => window.calendar.desktopStatus()))
    .toEqual({ mode: expectedEmbedded, visible: true });
  await trayItem("关闭桌面日历");
  await expect(
    page.getByLabel("开启桌面日历", { exact: true }),
  ).not.toBeChecked();
  await application.evaluate(() => {
    const item = globalThis.observedTrayMenu.items.find(
      (entry) => entry.label === "开启桌面日历",
    );
    item.click({ checked: true });
  });
  await expect(page.getByLabel("开启桌面日历", { exact: true })).toBeChecked();
  await expect
    .poll(() => page.evaluate(() => window.calendar.desktopStatus()))
    .toEqual({ mode: expectedEmbedded, visible: true });
  panel = application.windows().find((item) => item.url().endsWith("#desktop"));
  panel.on("pageerror", (error) => errors.push(error.message));
  await page.getByLabel("桌面深浅主题").selectOption("dark");
  await expect(panel.locator(".desktop-panel")).toHaveClass(/dark/);
  await page.getByRole("button", { name: "颜色 #218c78", exact: true }).click();
  await expect(panel.locator(".desktop-panel")).toHaveCSS(
    "--panel-accent",
    "#218c78",
  );
  const slider = page.getByLabel("桌面背景不透明度");
  await slider.press("Home");
  await expect
    .poll(() =>
      page.evaluate(
        async () => (await window.calendar.snapshot()).settings.desktopOpacity,
      ),
    )
    .toBe(0);
  await expect(panel.locator(".desktop-panel")).toHaveCSS(
    "--panel-opacity",
    "0",
  );
  await slider.press("End");
  await expect
    .poll(() =>
      page.evaluate(
        async () => (await window.calendar.snapshot()).settings.desktopOpacity,
      ),
    )
    .toBe(100);
  await page.getByLabel("关闭设置").click();
  await panel.getByLabel("新建日程", { exact: true }).click();
  await panel.getByLabel("日程标题", { exact: true }).fill("桌面面板同步验证");
  await panel.getByRole("button", { name: "保存日程", exact: true }).click();
  await expect(
    panel.getByRole("button", { name: /桌面面板同步验证/ }),
  ).toBeVisible();
  await panel.getByRole("button", { name: /桌面面板同步验证/ }).click();
  await expect(panel.getByLabel("日程标题", { exact: true })).toHaveValue(
    "桌面面板同步验证",
  );
  await panel.getByLabel("日程标题", { exact: true }).fill("桌面修改已刷新");
  await panel.getByRole("button", { name: "保存日程", exact: true }).click();
  await expect(
    panel.getByRole("button", { name: /桌面修改已刷新/ }),
  ).toBeVisible();
  await page.evaluate(() =>
    window.calendar.settings({ desktopCalendarIds: [] }),
  );
  await expect(
    panel.getByRole("button", { name: /桌面修改已刷新/ }),
  ).toHaveCount(0);
  await page.evaluate(() =>
    window.calendar.settings({ desktopCalendarIds: null }),
  );
  await expect(
    panel.getByRole("button", { name: /桌面修改已刷新/ }),
  ).toBeVisible();
  await panel.getByRole("button", { name: "日程清单", exact: true }).click();
  await expect(panel.locator(".desktop-month")).toHaveCount(0);
  await expect(panel.getByText("未来两周", { exact: true })).toBeVisible();
  await panel.getByLabel("桌面外观设置").click();
  await expect(page.getByLabel("开启桌面日历", { exact: true })).toBeChecked();
  await page.getByRole("button", { name: "软件更新", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "检查更新", exact: true }),
  ).toBeVisible();
  await page.getByLabel("自动检查更新", { exact: true }).click();
  await expect(
    page.getByLabel("自动检查更新", { exact: true }),
  ).not.toBeChecked();
  await page.getByLabel("关闭设置").click();
  await page.getByTitle("最小化到托盘", { exact: true }).click();
  await expect
    .poll(() =>
      application.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()
          .find((win) => !win.webContents.getURL().endsWith("#desktop"))
          .isVisible(),
      ),
    )
    .toBe(false);
  await expect
    .poll(() => page.evaluate(() => window.calendar.desktopStatus()))
    .toEqual({ mode: expectedEmbedded, visible: true });
  await page.evaluate(() => window.calendar.desktop("hide"));
  await expect
    .poll(() => page.evaluate(() => window.calendar.desktopStatus()))
    .toEqual({ mode: expectedEmbedded, visible: false });
  await page.evaluate(() => window.calendar.desktop("show"));
  await expect
    .poll(() => page.evaluate(() => window.calendar.desktopStatus()))
    .toEqual({ mode: expectedEmbedded, visible: true });
  await mkdir(path.join(root, "test-results"), { recursive: true });
  await panel.screenshot({
    path: path.join(root, "test-results", "desktop-widget-dark.png"),
    omitBackground: true,
  });
  await panel.getByRole("button", { name: "月历", exact: true }).click();
  await page.evaluate(() =>
    window.calendar.settings({
      desktopTheme: "light",
      desktopOpacity: 92,
      teachingStartDate: new Date().toISOString().slice(0, 10),
      teachingWeeks: 20,
    }),
  );
  await expect(panel.locator(".desktop-week-number")).toHaveCount(6);
  await expect(panel.getByLabel("桌面外观设置")).toHaveCSS(
    "color",
    "rgb(39, 49, 74)",
  );
  await panel.screenshot({
    path: path.join(root, "test-results", "desktop-widget-light.png"),
    omitBackground: true,
  });
  await application.close();
  application = await electron.launch({
    args: [path.join(root, "scripts/fixtures/widget-launch.cjs")],
    cwd: root,
    env,
  });
  const main = await application.firstWindow();
  await expect.poll(async () => application.windows().length).toBe(2);
  const restarted = application
    .windows()
    .find((item) => item.url().endsWith("#desktop"));
  await expect(restarted.locator(".desktop-panel")).toHaveClass(/light/);
  await expect(
    restarted.getByRole("button", { name: /桌面修改已刷新/ }),
  ).toBeVisible();
  await expect
    .poll(() => main.evaluate(() => window.calendar.desktopStatus()))
    .toEqual({ mode: expectedEmbedded, visible: true });
  await restarted.getByLabel("关闭桌面日历", { exact: true }).click();
  await expect
    .poll(() =>
      main.evaluate(
        async () => (await window.calendar.snapshot()).settings.desktopEnabled,
      ),
    )
    .toBe(false);
  expect(errors).toEqual([]);
  const saved = JSON.parse(
    await readFile(path.join(directory, "calendar.json"), "utf8"),
  );
  expect(saved.events).toHaveLength(1);
  expect(saved.settings.autoCheckUpdates).toBe(false);
  console.log(
    "PASS native desktop embedding, month/agenda, color/theme/opacity, shared CRUD, tray hide/show, teaching weeks and restart persistence",
  );
} finally {
  await application?.close();
  if (
    path.dirname(directory) !== path.resolve(os.tmpdir()) ||
    !path.basename(directory).startsWith("feicalendar-widget-")
  )
    throw new Error("Unexpected test directory");
  await rm(directory, { recursive: true, force: true });
}
