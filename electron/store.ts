import {
  mkdir,
  readFile,
  writeFile,
  rename,
  copyFile,
  readdir,
  unlink,
} from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import type { AppSnapshot } from "../src/shared/types";
import { CALENDAR_VIEWS } from "../src/shared/types";

export function emptyState(): AppSnapshot {
  return {
    version: 1,
    calendars: [
      {
        id: "local",
        name: "我的日历",
        provider: "local",
        color: "#5474ee",
        visible: true,
        writable: true,
      },
    ],
    events: [],
    connections: [],
    queue: [],
    settings: {
      defaultCalendarId: "local",
      autoSync: true,
      syncMinutes: 5,
      feishuEnabled: false,
      reminders: true,
      weekends: true,
      theme: "light",
      calendarView: "timeGridWeek",
      closeToTray: true,
      desktopEnabled: false,
      desktopView: "month",
      desktopMode: "embedded",
      desktopDisplay: "",
      desktopCalendarIds: null,
      desktopFontSize: 13,
      desktopRowGap: 8,
      desktopMaxEvents: 4,
      desktopTheme: "system",
      desktopColor: "#5474ee",
      desktopOpacity: 88,
      desktopLocked: false,
      autoCheckUpdates: true,
      captureShortcut: "CommandOrControl+Alt+N",
      allDayReminderTime: "09:00",
      mutedReminderCalendars: [],
      showLunar: true,
      showSolarTerms: true,
      showHolidays: true,
      weekStartsOn: 1,
      hour12: false,
      dayStartHour: 0,
      dayEndHour: 24,
      defaultDurationMinutes: 60,
      defaultReminder: 10,
      bufferBeforeMinutes: 0,
      bufferAfterMinutes: 0,
      teachingStartDate: "",
      teachingWeeks: 20,
    },
  };
}

export class Store {
  state = emptyState();
  private file: string;
  constructor(private directory: string) {
    this.file = path.join(directory, "calendar.json");
  }

  async load() {
    await mkdir(this.directory, { recursive: true });
    try {
      this.state = this.parse(await readFile(this.file, "utf8"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      // Preserve the damaged file for recovery, then try the last committed snapshot.
      await copyFile(this.file, `${this.file}.damaged-${Date.now()}`);
      this.state = this.parse(await readFile(`${this.file}.backup`, "utf8"));
      this.state.syncError = "已从上一次备份恢复本地数据，请检查最近一次修改。";
    }
  }

  private parse(text: string): AppSnapshot {
    const state = JSON.parse(text) as AppSnapshot;
    if (
      state.version !== 1 ||
      !Array.isArray(state.events) ||
      !Array.isArray(state.calendars) ||
      !Array.isArray(state.queue) ||
      !Array.isArray(state.connections)
    ) {
      throw new Error("本地数据格式无法识别");
    }
    state.settings = { ...emptyState().settings, ...state.settings };
    if (!CALENDAR_VIEWS.includes(state.settings.calendarView)) {
      state.settings.calendarView = "timeGridWeek";
    }
    return state;
  }

  async save() {
    const temporary = `${this.file}.tmp`;
    await writeFile(temporary, JSON.stringify(this.state, null, 2), {
      encoding: "utf8",
      mode: 0o600,
    });
    try {
      await copyFile(this.file, `${this.file}.backup`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    await rename(temporary, this.file);
    try {
      const folder = path.join(this.directory, "backups");
      await mkdir(folder, { recursive: true });
      const day = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Shanghai",
      }).format(new Date());
      try {
        await copyFile(
          this.file,
          path.join(folder, `${day}.json`),
          constants.COPYFILE_EXCL,
        );
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      }
      const files = (await readdir(folder))
        .filter((name) => /^\d{4}-\d{2}-\d{2}\.json$/.test(name))
        .sort();
      for (const name of files.slice(0, -30))
        await unlink(path.join(folder, name));
      this.state.backupError = undefined;
    } catch {
      this.state.backupError = "自动备份未完成，请检查数据目录空间和写入权限";
    }
  }
}
