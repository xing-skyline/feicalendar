import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Notification,
  shell,
  Menu,
  Tray,
  globalShortcut,
  screen,
} from "electron";
import path from "node:path";
import { existsSync, watch } from "node:fs";
import { copyFile, mkdir, readFile, writeFile, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { z } from "zod";
import QRCode from "qrcode";
import { Store } from "./store";
import { FeishuClient } from "./feishu";
import { CredentialVault } from "./vault";
import { CalendarService } from "./service";
import { DesktopPanel } from "./desktop";
import { PortableUpdater } from "./updater";
import { Backups, encryptBackup, decryptBackup } from "./backups";
import { exportICS } from "./subscriptions";
import { expandLocalEvents } from "../src/shared/recurrence";
import type { CalendarEvent, Connection, DateRange } from "../src/shared/types";
import {
  text,
  id,
  date,
  eventSchema,
  rangeSchema,
  scopeSchema,
  settingsSchema,
} from "./validation";
import { specialEvents } from "../src/shared/almanac";
import { CalendarImports } from "./imports";
import { calendarPrintHtml } from "../src/shared/print";
import { OAuthAuthorization } from "./oauth";

app.setName("FeiCalendar");
app.setAppUserModelId("cn.xingskyline.feicalendar");
if (process.env.FEICALENDAR_DATA_DIR)
  app.setPath("userData", process.env.FEICALENDAR_DATA_DIR);
const hasLock = app.requestSingleInstanceLock();
if (!hasLock) app.quit();
let window: BrowserWindow | null = null;
let tray: Tray | null = null;
let quitting = false;
function showWindow() {
  if (window?.isMinimized()) window.restore();
  window?.show();
  window?.focus();
}
app.on("second-instance", showWindow);
app.on("before-quit", () => {
  quitting = true;
});
app.on("will-quit", () => {
  tray?.destroy();
  tray = null;
});

async function main() {
  const directory = app.getPath("userData");
  const store = new Store(directory);
  await store.load();
  const backups = new Backups(directory);
  const imports = new CalendarImports();
  const oauth = new OAuthAuthorization();
  app.once("will-quit", () => oauth.cancel());
  let capture: BrowserWindow | null = null;
  let captureCleanupTimer: ReturnType<typeof setTimeout> | undefined;
  const closeCapture = () => {
    capture?.hide();
    clearTimeout(captureCleanupTimer);
    captureCleanupTimer = setTimeout(() => {
      if (capture && !capture.isDestroyed() && !capture.isVisible())
        capture.destroy();
    }, 250);
  };
  const showCapture = async () => {
    clearTimeout(captureCleanupTimer);
    if (!capture || capture.isDestroyed()) {
      capture = new BrowserWindow({
        width: 660,
        height: 660,
        minWidth: 540,
        minHeight: 540,
        show: false,
        frame: false,
        alwaysOnTop: true,
        skipTaskbar: true,
        backgroundColor: "#f5f5f7",
        webPreferences: {
          preload: path.join(__dirname, "preload.cjs"),
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
          spellcheck: false,
        },
      });
      capture.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
      capture.webContents.on("will-navigate", (event) =>
        event.preventDefault(),
      );
      capture.on("close", (event) => {
        if (!quitting) {
          event.preventDefault();
          closeCapture();
        }
      });
      capture.on("closed", () => {
        capture = null;
      });
      if (
        !app.isPackaged &&
        process.env.FEICALENDAR_DEV_URL === "http://127.0.0.1:5179"
      )
        await capture.loadURL(`${process.env.FEICALENDAR_DEV_URL}#capture`);
      else
        await capture.loadFile(path.join(__dirname, "../dist/index.html"), {
          hash: "capture",
        });
    }
    capture.show();
    capture.focus();
  };
  let registeredShortcut = "";
  const configureShortcut = (shortcut: string) => {
    if (shortcut === registeredShortcut) return;
    if (
      shortcut &&
      !globalShortcut.register(shortcut, () => {
        void showCapture();
      })
    )
      throw new Error("快捷键被其他应用占用，请更换组合");
    if (registeredShortcut) globalShortcut.unregister(registeredShortcut);
    registeredShortcut = shortcut;
  };
  app.once("will-quit", () => {
    clearTimeout(captureCleanupTimer);
    globalShortcut.unregisterAll();
    capture?.destroy();
  });
  let refreshTray = () => {};
  let desktopRange: DateRange | undefined;
  const desktop = new DesktopPanel(directory, () => {
    if (!desktop.window) desktopRange = undefined;
    refreshTray();
  });
  const updater = new PortableUpdater({
    directory,
    version: app.getVersion(),
    executable: app.isPackaged
      ? process.env.PORTABLE_EXECUTABLE_FILE
      : undefined,
    changed: (status) => {
      window?.webContents.send("calendar:update", status);
      refreshTray();
    },
  });
  const broadcast = (channel: string, value: unknown) => {
    for (const target of [window, desktop.window, capture])
      if (target && !target.isDestroyed())
        target.webContents.send(channel, value);
  };
  const navigate = (target: {
    settings?: string;
    event?: CalendarEvent;
    date?: string;
  }) => {
    showWindow();
    window?.webContents.send("calendar:navigate", target);
  };
  app.once("will-quit", () => desktop.dispose());
  const binary = app.isPackaged
    ? path.join(process.resourcesPath, "lark-cli", "bin", "lark-cli.exe")
    : path.join(
        app.getAppPath(),
        "node_modules",
        "@larksuite",
        "cli",
        "bin",
        "lark-cli.exe",
      );
  const feishu = new FeishuClient(binary);
  const vault = new CredentialVault(directory);
  const service = new CalendarService(store, feishu, vault, (snapshot) => {
    broadcast("calendar:changed", snapshot);
    void desktop.apply(snapshot.settings).catch(() => {});
    refreshTray();
  });
  let range: DateRange = {
    start: new Date(Date.now() - 30 * 86400_000).toISOString(),
    end: new Date(Date.now() + 60 * 86400_000).toISOString(),
  };
  let syncing: Promise<unknown> | null = null;
  let installing = false;
  const sync = (requested: DateRange, remember = true) => {
    if (remember) range = requested;
    const task = service.exclusive(async () => {
      broadcast("calendar:syncing", true);
      try {
        return await service.sync(requested);
      } finally {
        broadcast("calendar:syncing", false);
      }
    });
    syncing = task;
    void task
      .finally(() => {
        if (syncing === task) syncing = null;
      })
      .catch(() => {});
    return task;
  };

  const handlers: Record<string, (...args: unknown[]) => unknown> = {
    "oauth-connect": async (value) => {
      const input = z
        .object({
          id: z.string().max(100),
          name: z.string().trim().min(1).max(100),
          kind: z.enum(["google", "microsoft"]),
          clientId: z.string().trim().min(1).max(500),
          clientSecret: z.string().max(1000),
          tenant: z.string().trim().min(1).max(200),
        })
        .parse(value);
      if (input.id) {
        const previous = await vault.read(input.id);
        if (previous?.kind !== input.kind || !previous.oauth)
          throw new Error("原连接已不存在，请新增账号连接");
        if (!input.clientSecret && previous.oauth.clientId === input.clientId)
          input.clientSecret = previous.oauth.clientSecret || "";
      }
      const connection = await oauth.connect(input, (url) =>
        shell.openExternal(url),
      );
      return service.exclusive(() =>
        service.saveOAuthConnection(connection, Boolean(input.id)),
      );
    },
    "oauth-cancel": () => oauth.cancel(),
    "save-semester": (value, activate) =>
      service.exclusive(() =>
        service.saveSemester(
          z
            .object({
              id: z.string().max(100),
              name: z.string().trim().min(1).max(100),
              startDate: z.iso.date(),
              weeks: z.number().int().min(1).max(60),
              weekStartsOn: z.union([z.literal(0), z.literal(1), z.literal(6)]),
              periods: z
                .array(
                  z.object({
                    id,
                    name: z.string().trim().min(1).max(30),
                    start: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
                    end: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
                  }),
                )
                .min(1)
                .max(30),
            })
            .parse(value),
          z.boolean().parse(activate),
        ),
      ),
    "delete-semester": (value) =>
      service.exclusive(() => service.deleteSemester(id.parse(value))),
    "save-course": (value) =>
      service.exclusive(() =>
        service.saveCourse(
          z
            .object({
              id: z.string().max(100),
              semesterId: id,
              title: z.string().trim().min(1).max(1000),
              calendarId: id,
              weekday: z.number().int().min(0).max(6),
              weeks: z.array(z.number().int().min(1).max(60)).min(1).max(60),
              firstPeriod: id,
              lastPeriod: id,
              location: z.string().max(2000),
              description: text,
              exceptions: z.record(
                z.string().regex(/^\d{1,2}$/),
                z.object({
                  cancelled: z.boolean().optional(),
                  start: date.optional(),
                  end: date.optional(),
                  title: z.string().min(1).max(1000).optional(),
                  location: z.string().max(2000).optional(),
                  description: text.optional(),
                }),
              ),
            })
            .parse(value),
        ),
      ),
    "delete-course": (value) =>
      service.exclusive(() => service.deleteCourse(id.parse(value))),
    "bulk-events": (input) =>
      service.exclusive(() =>
        service.bulkEvents(
          z
            .object({
              operationId: z.uuid(),
              ids: z.array(id).min(1).max(2000),
              action: z.enum([
                "copy",
                "move",
                "reminder",
                "complete",
                "delete",
              ]),
              calendarId: id,
              reminder: z.number().int().min(-1).max(20160),
            })
            .parse(input),
        ),
      ),
    "import-preview": async (value, requested) => {
      const calendarId = id.parse(value);
      const selectedRange = rangeSchema.parse(requested);
      const selection = await dialog.showOpenDialog(window!, {
        filters: [{ name: "iCalendar 日历", extensions: ["ics"] }],
        properties: ["openFile"],
      });
      const file = selection.filePaths[0];
      if (selection.canceled || !file) return null;
      if ((await stat(file)).size > 20_000_000)
        throw new Error("ICS 文件超过 20 MB");
      const content = await readFile(file, "utf8");
      return service.exclusive(() =>
        imports.preview(content, calendarId, selectedRange, store.state),
      );
    },
    "import-apply": (token, values) =>
      service.exclusive(() => {
        const events = imports.selected(
          id.parse(token),
          z.array(id).max(10000).parse(values),
          store.state,
        );
        return service.saveEvents(events.map((event) => ({ event })));
      }),
    print: async (input, pdf) => {
      const options = z
        .object({
          date: z.iso.date(),
          view: z.enum(["week", "month", "course"]),
          calendarIds: z.array(id).min(1).max(1000),
          details: z.boolean(),
        })
        .parse(input);
      const savePdf = z.boolean().parse(pdf);
      let destination: string | undefined;
      if (savePdf) {
        const result = await dialog.showSaveDialog(window!, {
          defaultPath: `飞历-${options.date}.pdf`,
          filters: [{ name: "PDF", extensions: ["pdf"] }],
        });
        if (result.canceled || !result.filePath) return null;
        destination = result.filePath;
      }
      const html = calendarPrintHtml(store.state, options);
      const printWindow = new BrowserWindow({
        show: false,
        webPreferences: {
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
          javascript: false,
        },
      });
      printWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
      try {
        await printWindow.loadURL(
          `data:text/html;charset=utf-8,${encodeURIComponent(html)}`,
        );
        if (destination) {
          await writeFile(
            destination,
            await printWindow.webContents.printToPDF({
              pageSize: "A4",
              landscape: true,
              printBackground: true,
              preferCSSPageSize: true,
            }),
          );
          return destination;
        }
        await new Promise<void>((resolve, reject) =>
          printWindow.webContents.print(
            {
              silent: false,
              printBackground: true,
              landscape: true,
              pageSize: "A4",
            },
            (success, reason) =>
              success ? resolve() : reject(new Error(reason || "打印已取消")),
          ),
        );
        return "已发送打印任务";
      } finally {
        printWindow.destroy();
      }
    },
    "save-task": (input) =>
      service.exclusive(() =>
        service.saveTask(
          z
            .object({
              id: z.string().max(100),
              title: z.string().trim().min(1).max(1000),
              description: text,
              deadline: z.union([z.literal(""), date]),
              estimateMinutes: z.number().int().min(1).max(10080),
              priority: z.number().int().min(0).max(3),
              completed: z.boolean(),
              subtasks: z
                .array(
                  z.object({
                    id: z.string().max(100),
                    title: z.string().trim().min(1).max(1000),
                    completed: z.boolean(),
                  }),
                )
                .max(200),
            })
            .parse(input),
        ),
      ),
    "delete-task": (value, removeScheduled) =>
      service.exclusive(() =>
        service.deleteTask(id.parse(value), z.boolean().parse(removeScheduled)),
      ),
    "schedule-task": (value, start, calendarId, blockId) =>
      service.exclusive(() =>
        service.scheduleTask(
          id.parse(value),
          date.parse(start),
          id.parse(calendarId),
          z.uuid().parse(blockId),
        ),
      ),
    "save-calendar-set": (input) =>
      service.exclusive(() =>
        service.saveCalendarSet(
          z
            .object({
              id: z.string().max(100),
              name: z.string().trim().min(1).max(100),
              calendarIds: z.array(id).max(1000),
            })
            .parse(input),
        ),
      ),
    "delete-calendar-set": (value) =>
      service.exclusive(() => service.deleteCalendarSet(id.parse(value))),
    "apply-calendar-set": (value, desktop) =>
      service.exclusive(() =>
        service.applyCalendarSet(id.parse(value), z.boolean().parse(desktop)),
      ),
    "save-events": (inputs) =>
      service.exclusive(() =>
        service.saveEvents(
          z
            .array(z.object({ event: eventSchema, scope: scopeSchema }))
            .min(1)
            .max(2000)
            .parse(inputs),
        ),
      ),
    "update-holidays": async () => {
      const response = await fetch(
        "https://raw.githubusercontent.com/xing-skyline/feicalendar/main/data/holidays.json",
        { signal: AbortSignal.timeout(20_000) },
      );
      if (!response.ok)
        throw new Error(`节假日数据请求失败（${response.status}）`);
      const content = await response.text();
      if (content.length > 500_000) throw new Error("节假日数据超出限制");
      const data = z
        .object({
          version: z.literal(1),
          years: z.record(
            z.string().regex(/^\d{4}$/),
            z.object({
              source: z
                .url()
                .refine(
                  (value) =>
                    new URL(value).protocol === "https:" &&
                    new URL(value).hostname.endsWith(".gov.cn"),
                ),
              publishedAt: z.iso.date(),
              holidays: z
                .array(
                  z.object({
                    name: z.string().max(50),
                    start: z.iso.date(),
                    end: z.iso.date(),
                  }),
                )
                .max(100),
              workdays: z.array(z.iso.date()).max(366),
            }),
          ),
        })
        .parse(JSON.parse(content));
      return service.exclusive(() => service.saveHolidayData(data));
    },
    "holiday-override": (day, value) =>
      service.exclusive(() =>
        service.holidayOverride(
          z.iso.date().parse(day),
          z
            .object({
              name: z.string().trim().min(1).max(100),
              work: z.boolean(),
            })
            .nullable()
            .parse(value),
        ),
      ),
    "save-special-date": (value) =>
      service.exclusive(() =>
        service.saveSpecialDate(
          z
            .object({
              id: z.string().max(100),
              title: z.string().trim().min(1).max(100),
              date: z
                .string()
                .regex(/^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/),
              lunar: z.boolean(),
              leapMonth: z.boolean(),
              yearly: z.boolean(),
              showDesktop: z.boolean(),
              remindDays: z.number().int().min(-1).max(14),
            })
            .parse(value),
        ),
      ),
    "delete-special-date": (value) =>
      service.exclusive(() => service.deleteSpecialDate(id.parse(value))),
    "backup-list": () => backups.list(),
    "backup-preview": (value, options) =>
      service.exclusive(() =>
        backups.preview(
          store.state,
          id.parse(value),
          z
            .object({ includeCloud: z.boolean(), deleteMissing: z.boolean() })
            .parse(options),
        ),
      ),
    "backup-restore": (token) =>
      service.exclusive(() =>
        service.restoreBackup(backups.take(id.parse(token), store.state)),
      ),
    "backup-export": async (input) => {
      const password = z.string().min(8).max(1024).parse(input);
      const destination = await dialog.showSaveDialog(window!, {
        defaultPath: "飞历加密备份.fcbackup",
        filters: [{ name: "飞历加密备份", extensions: ["fcbackup"] }],
      });
      if (!destination.filePath || destination.canceled) return null;
      const data = await service.exclusive(() =>
        encryptBackup(structuredClone(store.state), password),
      );
      await writeFile(destination.filePath, data, { mode: 0o600 });
      return destination.filePath;
    },
    "backup-import": async (input) => {
      const password = z.string().min(8).max(1024).parse(input);
      const selection = await dialog.showOpenDialog(window!, {
        filters: [{ name: "飞历加密备份", extensions: ["fcbackup"] }],
        properties: ["openFile"],
      });
      const file = selection.filePaths[0];
      if (selection.canceled || !file) return null;
      if ((await stat(file)).size > 50 * 1024 * 1024)
        throw new Error("备份文件超过 50 MB");
      return backups.import(
        await decryptBackup(await readFile(file, "utf8"), password),
      );
    },
    "undo-change": () => service.exclusive(() => service.undoChange()),
    "restore-trash": (value) =>
      service.exclusive(() => service.restoreTrash(id.parse(value))),
    displays: () =>
      screen.getAllDisplays().map((display, index) => ({
        id: String(display.id),
        label:
          display.label ||
          `显示器 ${index + 1}（${display.size.width}×${display.size.height}）`,
      })),
    "reminder-rule": (value, minutes) =>
      service.exclusive(() =>
        service.reminderRule(
          id.parse(value),
          z
            .array(z.number().int().min(0).max(20160))
            .max(12)
            .nullable()
            .parse(minutes),
        ),
      ),
    "reminder-action": (value, action) =>
      service.exclusive(() =>
        service.reminderAction(
          id.parse(value),
          z.enum(["dismiss", "snooze5", "snooze15"]).parse(action),
        ),
      ),
    "quick-capture": async (input) => {
      if (z.enum(["open", "close"]).parse(input) === "open")
        await showCapture();
      else closeCapture();
    },
    "save-template": (input) =>
      service.exclusive(() =>
        service.saveTemplate(
          z
            .object({
              id: z.string().max(100),
              name: z.string().trim().min(1).max(100),
              title: z.string().trim().min(1).max(1000),
              calendarId: id,
              durationMinutes: z.number().int().min(1).max(20_160),
              allDay: z.boolean(),
              location: z.string().max(2000),
              description: text,
              reminder: z.number().int().min(-1).max(20_160),
              recurrence: z.string().max(1000),
            })
            .parse(input),
        ),
      ),
    "delete-template": (value) =>
      service.exclusive(() => service.deleteTemplate(id.parse(value))),
    snapshot: () => service.exclusive(() => service.snapshot()),
    "save-event": (input) => {
      const parsed = z
        .object({
          event: eventSchema,
          scope: scopeSchema,
          localReminders: z
            .array(z.number().int().min(0).max(20160))
            .max(12)
            .optional(),
        })
        .parse(input);
      return service.exclusive(() => service.saveEvent(parsed));
    },
    "delete-event": (value, scope) =>
      service.exclusive(() =>
        service.deleteEvent(id.parse(value), scopeSchema.parse(scope)),
      ),
    "save-calendar": (input) =>
      service.exclusive(() =>
        service.saveCalendar(
          z
            .object({
              name: z.string().trim().min(1).max(100),
              color: z
                .string()
                .regex(/^#[0-9a-fA-F]{6}$/)
                .optional(),
            })
            .parse(input),
        ),
      ),
    "update-calendar": (value, patch) =>
      service.exclusive(() =>
        service.updateCalendar(
          id.parse(value),
          z
            .object({
              visible: z.boolean().optional(),
              name: z.string().trim().min(1).max(100).optional(),
              color: z
                .string()
                .regex(/^#[0-9a-fA-F]{6}$/)
                .optional(),
            })
            .parse(patch),
        ),
      ),
    "publish-calendar": (value, target) =>
      service.exclusive(() =>
        service.publishCalendar(id.parse(value), id.parse(target)),
      ),
    settings: (patch) =>
      service.exclusive(async () => {
        const parsed = settingsSchema.parse(patch);
        const oldShortcut = store.state.settings.captureShortcut;
        if (parsed.captureShortcut !== undefined)
          configureShortcut(parsed.captureShortcut);
        try {
          return await service.settings(parsed);
        } catch (error) {
          configureShortcut(oldShortcut);
          throw error;
        }
      }),
    "save-connection": (input) =>
      service.exclusive(() =>
        service.saveConnection(
          z
            .object({
              id: z.string().max(100),
              name: z.string().trim().min(1).max(100),
              kind: z.enum(["caldav", "webdav", "ics", "google", "microsoft"]),
              url: z.string().max(4000),
              username: z.string().max(1000),
              password: z.string().max(1000).optional(),
              enabled: z.boolean().optional(),
              readOnly: z.boolean().optional(),
              syncTeaching: z.boolean().optional(),
            })
            .parse(input) as Connection,
        ),
      ),
    "remove-connection": (value) =>
      service.exclusive(() => service.removeConnection(id.parse(value))),
    "resolve-teaching-conflict": (value, choice) =>
      service.exclusive(() =>
        service.resolveTeachingConflict(
          id.parse(value),
          z.enum(["local", "remote"]).parse(choice),
        ),
      ),
    "auth-status": () => feishu.authStatus(),
    "configure-app": (appId, appSecret) =>
      service.exclusive(async () => {
        await feishu.call(
          [
            "config",
            "init",
            "--app-id",
            z
              .string()
              .regex(/^cli_[a-zA-Z0-9]+$/)
              .parse(appId),
            "--app-secret-stdin",
            "--brand",
            "feishu",
          ],
          undefined,
          45_000,
          z.string().min(10).max(500).parse(appSecret) + "\n",
        );
        await service.settings({ feishuEnabled: false });
      }),
    "auth-start": async () => {
      const challenge = await feishu.call<{
        verification_url?: string;
        verification_uri_complete?: string;
        device_code: string;
      }>([
        "auth",
        "login",
        "--scope",
        "calendar:calendar:read calendar:calendar.event:read calendar:calendar.event:create calendar:calendar.event:update calendar:calendar.event:delete offline_access",
        "--no-wait",
      ]);
      const url =
        challenge.verification_url || challenge.verification_uri_complete;
      if (!url || !challenge.device_code)
        throw new Error("飞书授权响应缺少链接，请重试");
      return {
        url,
        deviceCode: challenge.device_code,
        qr: await QRCode.toDataURL(url, { width: 220, margin: 1 }),
      };
    },
    "auth-finish": async (code) => {
      await feishu.call(
        [
          "auth",
          "login",
          "--device-code",
          z.string().min(1).max(4000).parse(code),
        ],
        undefined,
        300_000,
      );
      return feishu.authStatus();
    },
    sync: (input) => sync(rangeSchema.parse(input)),
    "resolve-conflict": (value, choice) =>
      service.exclusive(() =>
        service.resolveConflict(
          id.parse(value),
          z.enum(["local", "remote"]).parse(choice),
        ),
      ),
    export: async () => {
      const destination = await dialog.showSaveDialog(window!, {
        defaultPath: "飞历日程.ics",
        filters: [{ name: "iCalendar", extensions: ["ics"] }],
      });
      if (!destination.filePath || destination.canceled) return null;
      await writeFile(
        destination.filePath,
        exportICS(store.state.events),
        "utf8",
      );
      return destination.filePath;
    },
    "open-external": async (input) => {
      const url = new URL(z.string().max(8000).parse(input));
      if (url.protocol !== "https:") throw new Error("仅支持打开 HTTPS 链接");
      await shell.openExternal(url.href);
    },
    "desktop-status": () => desktop.status,
    "desktop-range": async (input) => {
      desktopRange = rangeSchema.parse(input);
      if (
        store.state.settings.autoSync &&
        (store.state.settings.feishuEnabled ||
          store.state.connections.some((item) => item.enabled !== false))
      )
        await sync(desktopRange, false);
    },
    desktop: async (input) => {
      const action = z
        .enum(["show", "hide", "close", "reset", "move", "resize", "stop"])
        .parse(input);
      if (action === "show") {
        await service.exclusive(() =>
          service.settings({ desktopEnabled: true }),
        );
        await desktop.show();
      }
      if (action === "hide") desktop.hide();
      if (action === "close")
        await service.exclusive(() =>
          service.settings({ desktopEnabled: false }),
        );
      if (action === "reset") desktop.reset();
      if (action === "move" || action === "resize")
        desktop.move(action === "resize");
      if (action === "stop") desktop.stopMovement();
    },
    navigate: (input) => {
      const target = z
        .object({
          settings: z.enum(["desktop", "updates", "reminders"]).optional(),
          event: z.unknown().optional(),
          date: z.iso.date().optional(),
        })
        .parse(input);
      // The panel can open existing instances, including external RRULEs. It
      // cannot mutate them through navigation; the editor's normal validation applies.
      let event: CalendarEvent | undefined;
      if (target.event && typeof target.event === "object") {
        const reference = target.event as CalendarEvent;
        if (reference.id?.startsWith("special:")) {
          const start = date.parse(reference.start);
          event = specialEvents(store.state, {
            start,
            end: new Date(new Date(start).getTime() + 86400_000).toISOString(),
          }).find((item) => item.id === reference.id);
        }
        const original = store.state.events.find(
          (item) =>
            item.id === (reference.seriesId || reference.id) && !item.deleted,
        );
        if (original) {
          event = original;
          if (reference.occurrenceStart && original.recurrence) {
            const start = date.parse(reference.occurrenceStart);
            event = expandLocalEvents([original], {
              start,
              end: new Date(
                new Date(start).getTime() + 86400_000,
              ).toISOString(),
            }).find((item) => item.id === reference.id);
          }
        }
      }
      navigate({ settings: target.settings, event, date: target.date });
    },
    "update-action": async (input) => {
      const action = z
        .enum(["status", "check", "download", "install"])
        .parse(input);
      if (action === "check") return updater.check();
      if (action === "download") return updater.download();
      if (action === "install") {
        if (installing) throw new Error("正在准备升级");
        installing = true;
        try {
          const launch = await updater.prepareInstall();
          quitting = true;
          await service.exclusive(async () => {});
          await launch();
          app.quit();
        } catch (error) {
          quitting = false;
          installing = false;
          throw error;
        }
      }
      return updater.status;
    },
  };
  for (const [name, handler] of Object.entries(handlers)) {
    ipcMain.handle(`calendar:${name}`, async (event, ...args) => {
      if (quitting) throw new Error("飞历正在退出");
      const source = [window, desktop.window, capture].find(
        (target) => target?.webContents === event.sender,
      );
      const widgetAllowed = [
        "snapshot",
        "settings",
        "desktop",
        "desktop-status",
        "desktop-range",
        "navigate",
        "save-event",
        "delete-event",
        "save-template",
        "reminder-rule",
        "open-external",
      ];
      if (
        !source ||
        event.senderFrame !== source.webContents.mainFrame ||
        (source === desktop.window && !widgetAllowed.includes(name))
      )
        throw new Error("无效的调用来源");
      if (source === desktop.window && name === "settings") {
        args[0] = z
          .object({
            desktopView: z.enum(["month", "agenda", "grid"]).optional(),
          })
          .parse(args[0]);
      }
      try {
        return await handler(...args);
      } catch (error) {
        const message =
          error instanceof z.ZodError
            ? error.issues.map((issue) => issue.message).join("，")
            : (error as Error).message;
        throw new Error(message);
      }
    });
  }

  const iconSource = path.join(app.getAppPath(), "build", "icon.ico");
  // Windows shell cannot resolve icons inside app.asar or retain a portable
  // launcher's temporary extraction path after the application exits.
  const iconHash = createHash("sha256")
    .update(await readFile(iconSource))
    .digest("hex")
    .slice(0, 12);
  const shellIcon = path.join(directory, `app-icon-${iconHash}.ico`);
  await copyFile(iconSource, shellIcon);
  const executable = process.env.PORTABLE_EXECUTABLE_FILE || process.execPath;
  // Initialize Electron's Windows notification registration before correcting
  // its automatically generated shortcut to point at the portable launcher.
  const notificationsSupported =
    process.env.FEICALENDAR_DISABLE_NOTIFICATIONS !== "1" &&
    Notification.isSupported();

  window = new BrowserWindow({
    width: 1500,
    height: 950,
    minWidth: 1050,
    minHeight: 700,
    frame: false,
    show: false,
    backgroundColor: "#f8f9fc",
    title: "飞历 FeiCalendar",
    icon: path.join(app.getAppPath(), "build", "icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });
  if (process.platform === "win32" && app.isPackaged) {
    window.setAppDetails({
      appId: "cn.xingskyline.feicalendar",
      appIconPath: shellIcon,
      appIconIndex: 0,
      relaunchCommand: `"${executable}"`,
      relaunchDisplayName: "飞历 FeiCalendar",
    });
    if (!process.env.FEICALENDAR_DATA_DIR) {
      const shortcut = path.join(
        app.getPath("appData"),
        "Microsoft",
        "Windows",
        "Start Menu",
        "Programs",
        "FeiCalendar.lnk",
      );
      try {
        await mkdir(path.dirname(shortcut), { recursive: true });
        const details = {
          target: executable,
          args: "",
          cwd: path.dirname(executable),
          icon: shellIcon,
          iconIndex: 0,
          appUserModelId: "cn.xingskyline.feicalendar",
          description: "飞历 FeiCalendar 桌面日历",
        };
        const updateShortcut = () => {
          try {
            const present = existsSync(shortcut);
            const current = present ? shell.readShortcutLink(shortcut) : null;
            if (
              current &&
              Object.entries(details).every(
                ([key, value]) =>
                  current[key as keyof typeof current] === value,
              )
            )
              return;
            // Updating preserves Electron's ToastActivatorCLSID for notifications.
            if (
              !shell.writeShortcutLink(
                shortcut,
                present ? "update" : "create",
                details,
              )
            )
              console.warn("无法更新飞历开始菜单入口");
          } catch {
            console.warn("飞历开始菜单入口暂时不可写入");
          }
        };
        // Electron registers notifications on a worker thread and can replace
        // the shortcut after startup. Reconcile only our own link when it changes.
        let shortcutUpdate: ReturnType<typeof setTimeout> | undefined;
        const watcher = watch(path.dirname(shortcut), (_event, filename) => {
          if (
            filename &&
            filename.toString().toLowerCase() !== "feicalendar.lnk"
          )
            return;
          clearTimeout(shortcutUpdate);
          shortcutUpdate = setTimeout(updateShortcut, 100);
        });
        watcher.on("error", () => console.warn("无法监听飞历开始菜单入口"));
        app.once("will-quit", () => {
          clearTimeout(shortcutUpdate);
          watcher.close();
        });
        updateShortcut();
      } catch {
        console.warn("当前 Windows 用户无法写入飞历开始菜单入口");
      }
    }
  }
  window.on("close", (event) => {
    if (!quitting && store.state.settings.closeToTray && tray) {
      event.preventDefault();
      window?.hide();
    } else if (!quitting) {
      event.preventDefault();
      void exitApp();
    }
  });
  window.on("query-session-end", () => {
    quitting = true;
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event) => event.preventDefault());
  window.webContents.session.setPermissionRequestHandler(
    (_contents, _permission, callback) => callback(false),
  );
  ipcMain.on("calendar:window", (event, action) => {
    if (event.sender !== window?.webContents) return;
    if (action === "minimize") window.minimize();
    if (action === "maximize")
      window.isMaximized() ? window.unmaximize() : window.maximize();
    if (action === "close") window.close();
  });
  window.once("ready-to-show", () => window?.show());
  const devUrl = process.env.FEICALENDAR_DEV_URL;
  if (!app.isPackaged && devUrl === "http://127.0.0.1:5179")
    await window.loadURL(devUrl);
  else await window.loadFile(path.join(__dirname, "..", "dist", "index.html"));

  let elapsed = 0;
  let checkingReminders = false;
  const checkReminders = () => {
    if (checkingReminders || quitting) return;
    checkingReminders = true;
    void service
      .exclusive(() => service.checkReminders())
      .then((entries) => {
        if (
          !notificationsSupported ||
          process.env.FEICALENDAR_DISABLE_NOTIFICATIONS === "1"
        )
          return;
        for (const entry of entries.slice(-5)) {
          const notification = new Notification({
            title: entry.title,
            body: entry.location || "打开提醒中心，可稍后提醒或查看日程",
          });
          notification.on("click", () => navigate({ settings: "reminders" }));
          notification.show();
        }
      })
      .catch(() => {})
      .finally(() => {
        checkingReminders = false;
      });
  };
  const timer = setInterval(() => {
    if (quitting) return;
    elapsed += 15;
    if (
      store.state.settings.autoSync &&
      elapsed >= store.state.settings.syncMinutes * 60 &&
      !syncing
    ) {
      elapsed = 0;
      const ranges = [range];
      if (desktopRange) {
        const start = new Date(
          Math.min(
            new Date(range.start).getTime(),
            new Date(desktopRange.start).getTime(),
          ),
        ).toISOString();
        const end = new Date(
          Math.max(
            new Date(range.end).getTime(),
            new Date(desktopRange.end).getTime(),
          ),
        ).toISOString();
        if (
          new Date(end).getTime() - new Date(start).getTime() <=
          400 * 86400_000
        )
          ranges[0] = { start, end };
        else ranges.push(desktopRange);
      }
      void (async () => {
        for (const requested of ranges) {
          if (!quitting) await sync(requested, false);
        }
      })().catch(() => {});
    }
    checkReminders();
  }, 15_000);
  tray = new Tray(shellIcon);
  tray.setToolTip("飞历 FeiCalendar");
  const exitApp = async () => {
    if (quitting) return;
    quitting = true;
    clearInterval(timer);
    clearInterval(updateTimer);
    tray?.setToolTip("飞历正在退出…");
    window?.hide();
    desktop.hide();
    await service.exclusive(async () => {});
    app.quit();
  };
  refreshTray = () =>
    tray?.setContextMenu(
      Menu.buildFromTemplate([
        { label: "打开飞历", click: showWindow },
        {
          label: "快捷录入…",
          click: () => {
            void showCapture();
          },
        },
        {
          label: `提醒中心（${(store.state.reminderEntries || []).filter((entry) => entry.state === "unread").length}）`,
          click: () => navigate({ settings: "reminders" }),
        },
        { type: "separator" },
        {
          label: "开启桌面日历",
          type: "checkbox",
          checked: store.state.settings.desktopEnabled,
          click: (item) => {
            void service
              .exclusive(() =>
                service.settings({ desktopEnabled: item.checked }),
              )
              .catch(() => {});
          },
        },
        {
          label: desktop.status.visible ? "暂时隐藏桌面日历" : "显示桌面日历",
          enabled: store.state.settings.desktopEnabled,
          click: () => {
            if (desktop.status.visible) desktop.hide();
            else void desktop.show();
          },
        },
        {
          label: "桌面日历外观…",
          click: () => navigate({ settings: "desktop" }),
        },
        {
          label: "锁定桌面日历位置",
          type: "checkbox",
          checked: store.state.settings.desktopLocked,
          enabled: store.state.settings.desktopEnabled,
          click: (item) => {
            void service
              .exclusive(() =>
                service.settings({ desktopLocked: item.checked }),
              )
              .catch(() => {});
          },
        },
        {
          label: "重置桌面日历位置",
          enabled: store.state.settings.desktopEnabled,
          click: () => {
            desktop.reset();
            void desktop.show();
          },
        },
        {
          label: "关闭桌面日历",
          enabled: store.state.settings.desktopEnabled,
          click: () => {
            void service
              .exclusive(() => service.settings({ desktopEnabled: false }))
              .catch(() => {});
          },
        },
        { type: "separator" },
        {
          label:
            updater.status.phase === "ready"
              ? "新版已下载，查看升级…"
              : updater.status.phase === "available"
                ? `发现新版 ${updater.status.version}…`
                : "检查更新…",
          click: () => {
            navigate({ settings: "updates" });
            void updater.check();
          },
        },
        { type: "separator" },
        {
          label: "退出飞历",
          click: () => {
            void exitApp();
          },
        },
      ]),
    );
  refreshTray();
  try {
    configureShortcut(store.state.settings.captureShortcut);
  } catch (error) {
    store.state.syncError = (error as Error).message;
  }
  await desktop.apply(store.state.settings);
  await updater.restoreResult();
  let lastCheck = Date.now();
  const autoCheck = () => {
    if (app.isPackaged && store.state.settings.autoCheckUpdates)
      void updater.check();
  };
  const initialCheck = setTimeout(autoCheck, 15_000);
  const updateTimer = setInterval(() => {
    if (Date.now() - lastCheck >= 24 * 3600_000) {
      lastCheck = Date.now();
      autoCheck();
    }
  }, 60_000);
  app.once("will-quit", () => {
    clearTimeout(initialCheck);
    clearInterval(updateTimer);
    clearInterval(timer);
  });
  tray.on("click", showWindow);
  tray.on("double-click", showWindow);
  window.on("closed", () => {
    clearInterval(timer);
    window = null;
  });
  if (!existsSync(binary))
    store.state.syncError = "飞书连接组件缺失，请重新安装应用。";
}

if (hasLock)
  app
    .whenReady()
    .then(main)
    .catch((error) => {
      dialog.showErrorBox("飞历启动失败", String(error.message));
      app.quit();
    });
app.on("window-all-closed", () => app.quit());
