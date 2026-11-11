import { BrowserWindow, screen, app, type Rectangle } from "electron";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Settings } from "../src/shared/types";
import { DesktopHost } from "./desktop-native";

export class DesktopPanel {
  window: BrowserWindow | null = null;
  private host?: DesktopHost;
  private movement?: ReturnType<typeof setInterval>;
  private recovery?: ReturnType<typeof setInterval>;
  private bounds?: Rectangle;
  private opening?: Promise<void>;
  private settings!: Settings;
  private stopped = false;
  private hidden = false;
  constructor(
    private directory: string,
    private changed: () => void,
  ) {}
  get status() {
    return {
      mode: this.window
        ? this.host?.embedded
          ? ("embedded" as const)
          : ("floating" as const)
        : ("off" as const),
      visible: Boolean(this.window?.isVisible()),
    };
  }
  async apply(settings: Settings) {
    if (this.opening) await this.opening.catch(() => {});
    const modeChanged =
      this.settings && this.settings.desktopMode !== settings.desktopMode;
    const displayChanged =
      this.settings && this.settings.desktopDisplay !== settings.desktopDisplay;
    const layoutChanged =
      this.settings &&
      this.settings.desktopView !== settings.desktopView &&
      settings.desktopView === "grid";
    this.settings = { ...settings };
    if (modeChanged) this.close();
    if (displayChanged || layoutChanged) this.reset();
    if (!settings.desktopEnabled) {
      this.close();
      return;
    }
    if (this.window || this.stopped) return;
    if (this.opening) return this.opening;
    this.opening = this.create().finally(() => {
      this.opening = undefined;
    });
    return this.opening;
  }
  private defaultBounds(): Rectangle {
    const display =
      screen
        .getAllDisplays()
        .find((item) => String(item.id) === this.settings.desktopDisplay) ||
      screen.getPrimaryDisplay();
    const area = display.workArea;
    const width =
      this.settings.desktopView === "grid"
        ? Math.min(1100, area.width - 48)
        : 380;
    return {
      x: area.x + area.width - width - 24,
      y: area.y + 28,
      width,
      height: Math.min(650, area.height - 56),
    };
  }
  private clamp(bounds: Rectangle) {
    const area = screen.getDisplayMatching(bounds).workArea;
    const width = Math.min(Math.max(320, bounds.width), area.width);
    const height = Math.min(Math.max(360, bounds.height), area.height);
    return {
      x: Math.round(
        Math.min(Math.max(bounds.x, area.x), area.x + area.width - width),
      ),
      y: Math.round(
        Math.min(Math.max(bounds.y, area.y), area.y + area.height - height),
      ),
      width,
      height,
    };
  }
  private async create() {
    if (!this.bounds) {
      try {
        const saved = JSON.parse(
          await readFile(
            path.join(this.directory, "desktop-panel.json"),
            "utf8",
          ),
        );
        if (
          [saved.x, saved.y, saved.width, saved.height].every(Number.isFinite)
        )
          this.bounds = saved;
      } catch {
        /* Position is optional; recover on the primary display. */
      }
    }
    if (this.stopped || !this.settings.desktopEnabled) return;
    this.bounds = this.clamp(this.bounds || this.defaultBounds());
    const panel = new BrowserWindow({
      ...this.bounds,
      frame: false,
      transparent: true,
      backgroundColor: "#00000000",
      show: false,
      skipTaskbar: true,
      resizable: false,
      maximizable: false,
      minimizable: false,
      hasShadow: false,
      title: "飞历桌面日历",
      icon: path.join(app.getAppPath(), "build/icon.png"),
      webPreferences: {
        preload: path.join(__dirname, "preload.cjs"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        spellcheck: false,
      },
    });
    this.window = panel;
    this.host = new DesktopHost(panel);
    panel.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    panel.webContents.on("will-navigate", (event) => event.preventDefault());
    panel.on("closed", () => {
      this.stopMovement();
      this.window = null;
      this.host = undefined;
      this.changed();
    });
    const devUrl = process.env.FEICALENDAR_DEV_URL;
    if (!app.isPackaged && devUrl === "http://127.0.0.1:5179")
      await panel.loadURL(`${devUrl}/#desktop`);
    else
      await panel.loadFile(path.join(__dirname, "..", "dist", "index.html"), {
        hash: "desktop",
      });
    if (panel.isDestroyed()) return;
    if (this.settings.desktopMode === "embedded") this.host?.attach();
    panel.setAlwaysOnTop(this.settings.desktopMode === "topmost");
    this.host?.place(this.bounds);
    if (!this.hidden) panel.showInactive();
    this.changed();
    this.recovery ||= setInterval(() => {
      if (!this.settings.desktopEnabled || this.stopped) return;
      if (!this.window || this.window.isDestroyed()) {
        void this.apply(this.settings).catch(() => {});
        return;
      }
      if (this.settings.desktopMode === "embedded" && !this.host?.embedded)
        this.host?.attach();
    }, 10_000);
  }
  async show() {
    this.hidden = false;
    await this.apply(this.settings);
    this.window?.showInactive();
    this.changed();
  }
  hide() {
    this.hidden = true;
    this.window?.hide();
    this.changed();
  }
  reset() {
    this.bounds = this.defaultBounds();
    this.host?.place(this.bounds);
    void this.saveBounds();
  }
  move(resize = false) {
    this.stopMovement();
    if (!this.window || !this.host || this.settings.desktopLocked) return;
    const origin = screen.getCursorScreenPoint();
    const bounds = this.host.bounds();
    this.movement = setInterval(() => {
      if (!this.host) return;
      const cursor = screen.getCursorScreenPoint();
      const dx = cursor.x - origin.x,
        dy = cursor.y - origin.y;
      const next = resize
        ? { ...bounds, width: bounds.width + dx, height: bounds.height + dy }
        : { ...bounds, x: bounds.x + dx, y: bounds.y + dy };
      this.bounds = this.clamp(next);
      this.host.place(this.bounds);
    }, 16);
  }
  stopMovement() {
    clearInterval(this.movement);
    this.movement = undefined;
    void this.saveBounds();
  }
  private async saveBounds() {
    if (this.bounds)
      await writeFile(
        path.join(this.directory, "desktop-panel.json"),
        JSON.stringify(this.bounds),
      ).catch(() => {});
  }
  close() {
    this.stopMovement();
    clearInterval(this.recovery);
    this.recovery = undefined;
    this.window?.destroy();
    this.window = null;
    this.hidden = false;
    this.changed();
  }
  dispose() {
    this.stopped = true;
    this.close();
  }
}
