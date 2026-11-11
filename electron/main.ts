import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Notification,
  shell,
  Menu,
  Tray,
} from "electron";
import path from "node:path";
import { existsSync, watch } from "node:fs";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { z } from "zod";
import QRCode from "qrcode";
import { Store } from "./store";
import { FeishuClient } from "./feishu";
import { CredentialVault } from "./vault";
import { CalendarService } from "./service";
import { DesktopPanel } from "./desktop";
import { PortableUpdater } from "./updater";
import { exportICS } from "./subscriptions";
import { expandLocalEvents } from "../src/shared/recurrence";
import type { CalendarEvent, Connection, DateRange } from "../src/shared/types";
import { CALENDAR_VIEWS } from "../src/shared/types";

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

const text = z.string().max(20_000);
const id = z.string().min(1).max(3000);
const date = z
  .string()
  .max(40)
  .refine(
    (value) => Number.isFinite(new Date(value).getTime()),
    "时间格式无效",
  );
const eventSchema = z
  .object({
    id: z.string().max(3000),
    calendarId: id,
    title: z.string().trim().min(1).max(1000),
    start: date,
    end: date,
    allDay: z.boolean(),
    description: text,
    location: z.string().max(2000),
    reminder: z.number().int().min(-1).max(20160),
    recurrence: z.enum([
      "",
      "FREQ=DAILY",
      "FREQ=WEEKLY",
      "FREQ=MONTHLY",
      "FREQ=YEARLY",
      "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR",
    ]),
    completed: z.boolean(),
    syncState: z.enum(["local", "synced", "pending", "error", "conflict"]),
    remoteId: id.optional(),
    remoteFingerprint: text.optional(),
    remoteEtag: text.optional(),
    recurring: z.boolean().optional(),
    seriesId: id.optional(),
    occurrenceStart: date.optional(),
    exceptions: z.array(date).max(5000).optional(),
    url: text.optional(),
  })
  .refine(
    (event) => new Date(event.end) > new Date(event.start),
    "结束时间必须晚于开始时间",
  );
const rangeSchema = z.object({ start: date, end: date }).refine((value) => {
  const duration =
    new Date(value.end).getTime() - new Date(value.start).getTime();
  return duration > 0 && duration <= 400 * 86400_000;
}, "同步范围应在 400 天以内");
const scopeSchema = z.enum(["single", "all"]).optional();

async function main() {
  const directory = app.getPath("userData");
  const store = new Store(directory);
  await store.load();
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
    for (const target of [window, desktop.window])
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
  const service = new CalendarService(
    store,
    feishu,
    new CredentialVault(directory),
    (snapshot) => {
      broadcast("calendar:changed", snapshot);
      void desktop.apply(snapshot.settings).catch(() => {});
      refreshTray();
    },
  );
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
    snapshot: () => service.exclusive(() => service.snapshot()),
    "save-event": (input) => {
      const parsed = z
        .object({ event: eventSchema, scope: scopeSchema })
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
      service.exclusive(() =>
        service.settings(
          z
            .object({
              defaultCalendarId: id.optional(),
              autoSync: z.boolean().optional(),
              syncMinutes: z.number().int().min(1).max(60).optional(),
              feishuEnabled: z.boolean().optional(),
              reminders: z.boolean().optional(),
              weekends: z.boolean().optional(),
              theme: z.enum(["light", "dark", "system"]).optional(),
              calendarView: z.enum(CALENDAR_VIEWS).optional(),
              closeToTray: z.boolean().optional(),
              desktopEnabled: z.boolean().optional(),
              desktopView: z.enum(["month", "agenda"]).optional(),
              desktopTheme: z.enum(["light", "dark", "system"]).optional(),
              desktopColor: z
                .string()
                .regex(/^#[0-9a-fA-F]{6}$/)
                .optional(),
              desktopOpacity: z.number().int().min(0).max(100).optional(),
              desktopLocked: z.boolean().optional(),
              autoCheckUpdates: z.boolean().optional(),
              weekStartsOn: z
                .union([z.literal(0), z.literal(1), z.literal(6)])
                .optional(),
              hour12: z.boolean().optional(),
              dayStartHour: z.number().int().min(0).max(23).optional(),
              dayEndHour: z.number().int().min(1).max(24).optional(),
              defaultDurationMinutes: z
                .number()
                .int()
                .min(15)
                .max(240)
                .optional(),
              defaultReminder: z.number().int().min(-1).max(20160).optional(),
              teachingStartDate: z
                .union([z.literal(""), z.iso.date()])
                .optional(),
              teachingWeeks: z.number().int().min(1).max(104).optional(),
            })
            .parse(patch),
        ),
      ),
    "save-connection": (input) =>
      service.exclusive(() =>
        service.saveConnection(
          z
            .object({
              id: z.string().max(100),
              name: z.string().trim().min(1).max(100),
              kind: z.enum(["caldav", "webdav", "ics"]),
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
          settings: z.enum(["desktop", "updates"]).optional(),
          event: z.unknown().optional(),
          date: z.iso.date().optional(),
        })
        .parse(input);
      // The panel can open existing instances, including external RRULEs. It
      // cannot mutate them through navigation; the editor's normal validation applies.
      let event: CalendarEvent | undefined;
      if (target.event && typeof target.event === "object") {
        const reference = target.event as CalendarEvent;
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
      const source = [window, desktop.window].find(
        (target) => target?.webContents === event.sender,
      );
      const widgetAllowed = [
        "snapshot",
        "settings",
        "desktop",
        "desktop-status",
        "desktop-range",
        "navigate",
      ];
      if (
        !source ||
        event.senderFrame !== source.webContents.mainFrame ||
        (source === desktop.window && !widgetAllowed.includes(name))
      )
        throw new Error("无效的调用来源");
      if (source === desktop.window && name === "settings") {
        args[0] = z
          .object({ desktopView: z.enum(["month", "agenda"]).optional() })
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
  const notified = new Set<string>();
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
    if (!store.state.settings.reminders || !notificationsSupported) return;
    const now = Date.now();
    const upcoming = expandLocalEvents(store.state.events, {
      start: new Date(now - 60_000).toISOString(),
      end: new Date(now + 15 * 86400_000).toISOString(),
    });
    for (const event of upcoming) {
      if (event.allDay || event.reminder < 0 || event.completed) continue;
      const at = new Date(event.start).getTime() - event.reminder * 60_000;
      const key = `${event.id}/${at}`;
      if (now >= at && now - at < 30_000 && !notified.has(key)) {
        notified.add(key);
        const notification = new Notification({
          title: event.title,
          body: event.location || "日程即将开始",
        });
        notification.on("click", showWindow);
        notification.show();
      }
    }
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
