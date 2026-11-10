import { app, BrowserWindow, dialog, ipcMain, Notification, shell } from 'electron';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { z } from 'zod';
import QRCode from 'qrcode';
import { Store } from './store';
import { FeishuClient } from './feishu';
import { CredentialVault } from './vault';
import { CalendarService } from './service';
import { exportICS } from './subscriptions';
import { expandLocalEvents } from '../src/shared/recurrence';
import type { CalendarEvent, Connection, DateRange } from '../src/shared/types';

app.setName('FeiCalendar');
app.setAppUserModelId('cn.xingskyline.feicalendar');
if (process.env.FEICALENDAR_DATA_DIR) app.setPath('userData', process.env.FEICALENDAR_DATA_DIR);
const hasLock = app.requestSingleInstanceLock();
if (!hasLock) app.quit();
let window: BrowserWindow | null = null;
app.on('second-instance', () => { window?.show(); window?.focus(); });

const text = z.string().max(20_000);
const id = z.string().min(1).max(3000);
const date = z.string().max(40).refine(value => Number.isFinite(new Date(value).getTime()), '时间格式无效');
const eventSchema = z.object({
  id: z.string().max(3000), calendarId: id, title: z.string().trim().min(1).max(1000),
  start: date, end: date, allDay: z.boolean(), description: text, location: z.string().max(2000),
  reminder: z.number().int().min(-1).max(20160),
  recurrence: z.enum(['', 'FREQ=DAILY', 'FREQ=WEEKLY', 'FREQ=MONTHLY', 'FREQ=YEARLY', 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR']),
  completed: z.boolean(), syncState: z.enum(['local', 'synced', 'pending', 'error', 'conflict']),
  remoteId: id.optional(), remoteFingerprint: text.optional(), recurring: z.boolean().optional(),
  seriesId: id.optional(), occurrenceStart: date.optional(), exceptions: z.array(date).max(5000).optional(), url: text.optional(),
}).refine(event => new Date(event.end) > new Date(event.start), '结束时间必须晚于开始时间');
const rangeSchema = z.object({ start: date, end: date }).refine(value => {
  const duration = new Date(value.end).getTime() - new Date(value.start).getTime();
  return duration > 0 && duration <= 400 * 86400_000;
}, '同步范围应在 400 天以内');
const scopeSchema = z.enum(['single', 'all']).optional();

async function main() {
  const directory = app.getPath('userData');
  const store = new Store(directory);
  await store.load();
  const binary = app.isPackaged ? path.join(process.resourcesPath, 'lark-cli', 'bin', 'lark-cli.exe')
    : path.join(app.getAppPath(), 'node_modules', '@larksuite', 'cli', 'bin', 'lark-cli.exe');
  const feishu = new FeishuClient(binary);
  const service = new CalendarService(store, feishu, new CredentialVault(directory), snapshot => {
    window?.webContents.send('calendar:changed', snapshot);
  });
  let range: DateRange = { start: new Date(Date.now() - 30 * 86400_000).toISOString(), end: new Date(Date.now() + 60 * 86400_000).toISOString() };
  let syncing: Promise<unknown> | null = null;
  const sync = (requested: DateRange) => {
    range = requested;
    const task = service.exclusive(async () => {
      window?.webContents.send('calendar:syncing', true);
      try { return await service.sync(requested); }
      finally { window?.webContents.send('calendar:syncing', false); }
    });
    syncing = task;
    void task.finally(() => { if (syncing === task) syncing = null; }).catch(() => {});
    return task;
  };

  const handlers: Record<string, (...args: unknown[]) => unknown> = {
    snapshot: () => service.exclusive(() => service.snapshot()),
    'save-event': input => {
      const parsed = z.object({ event: eventSchema, scope: scopeSchema }).parse(input);
      return service.exclusive(() => service.saveEvent(parsed));
    },
    'delete-event': (value, scope) => service.exclusive(() => service.deleteEvent(id.parse(value), scopeSchema.parse(scope))),
    'save-calendar': input => service.exclusive(() => service.saveCalendar(z.object({ name: z.string().trim().min(1).max(100), color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional() }).parse(input))),
    'update-calendar': (value, patch) => service.exclusive(() => service.updateCalendar(id.parse(value), z.object({ visible: z.boolean().optional(), name: z.string().trim().min(1).max(100).optional(), color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional() }).parse(patch))),
    'publish-calendar': (value, target) => service.exclusive(() => service.publishCalendar(id.parse(value), id.parse(target))),
    settings: patch => service.exclusive(() => service.settings(z.object({
      defaultCalendarId: id.optional(), autoSync: z.boolean().optional(), syncMinutes: z.number().int().min(1).max(60).optional(),
      feishuEnabled: z.boolean().optional(), reminders: z.boolean().optional(), weekends: z.boolean().optional(), theme: z.enum(['light', 'dark', 'system']).optional(),
    }).parse(patch))),
    'save-connection': input => service.exclusive(() => service.saveConnection(z.object({
      id: z.string().max(100), name: z.string().trim().min(1).max(100), kind: z.enum(['caldav', 'ics']),
      url: z.string().max(4000), username: z.string().max(1000), password: z.string().max(1000).optional(),
    }).parse(input) as Connection)),
    'remove-connection': value => service.exclusive(() => service.removeConnection(id.parse(value))),
    'auth-status': () => feishu.authStatus(),
    'configure-app': (appId, appSecret) => service.exclusive(async () => {
      await feishu.call(['config', 'init', '--app-id', z.string().regex(/^cli_[a-zA-Z0-9]+$/).parse(appId), '--app-secret-stdin', '--brand', 'feishu'],
        undefined, 45_000, z.string().min(10).max(500).parse(appSecret) + '\n');
      await service.settings({ feishuEnabled: false });
    }),
    'auth-start': async () => {
      const challenge = await feishu.call<{ verification_url?: string; verification_uri_complete?: string; device_code: string }>([
        'auth', 'login', '--scope', 'calendar:calendar:read calendar:calendar.event:read calendar:calendar.event:create calendar:calendar.event:update calendar:calendar.event:delete offline_access', '--no-wait',
      ]);
      const url = challenge.verification_url || challenge.verification_uri_complete;
      if (!url || !challenge.device_code) throw new Error('飞书授权响应缺少链接，请重试');
      return { url, deviceCode: challenge.device_code, qr: await QRCode.toDataURL(url, { width: 220, margin: 1 }) };
    },
    'auth-finish': async code => {
      await feishu.call(['auth', 'login', '--device-code', z.string().min(1).max(4000).parse(code)], undefined, 300_000);
      return feishu.authStatus();
    },
    sync: input => sync(rangeSchema.parse(input)),
    'resolve-conflict': (value, choice) => service.exclusive(() => service.resolveConflict(id.parse(value), z.enum(['local', 'remote']).parse(choice))),
    export: async () => {
      const destination = await dialog.showSaveDialog(window!, { defaultPath: '飞历日程.ics', filters: [{ name: 'iCalendar', extensions: ['ics'] }] });
      if (!destination.filePath || destination.canceled) return null;
      await writeFile(destination.filePath, exportICS(store.state.events), 'utf8');
      return destination.filePath;
    },
    'open-external': async input => {
      const url = new URL(z.string().max(8000).parse(input));
      if (url.protocol !== 'https:') throw new Error('仅支持打开 HTTPS 链接');
      await shell.openExternal(url.href);
    },
  };
  for (const [name, handler] of Object.entries(handlers)) {
    ipcMain.handle(`calendar:${name}`, async (event, ...args) => {
      if (event.sender !== window?.webContents || event.senderFrame !== window.webContents.mainFrame) throw new Error('无效的调用来源');
      try { return await handler(...args); }
      catch (error) {
        const message = error instanceof z.ZodError ? error.issues.map(issue => issue.message).join('，') : (error as Error).message;
        throw new Error(message);
      }
    });
  }

  window = new BrowserWindow({
    width: 1500, height: 950, minWidth: 1050, minHeight: 700, frame: false, show: false,
    backgroundColor: '#f8f9fc', title: '飞历 FeiCalendar',
    icon: path.join(app.getAppPath(), 'build', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  ipcMain.on('calendar:window', (event, action) => {
    if (event.sender !== window?.webContents) return;
    if (action === 'minimize') window.minimize();
    if (action === 'maximize') window.isMaximized() ? window.unmaximize() : window.maximize();
    if (action === 'close') window.close();
  });
  window.once('ready-to-show', () => window?.show());
  const devUrl = process.env.FEICALENDAR_DEV_URL;
  if (!app.isPackaged && devUrl === 'http://127.0.0.1:5179') await window.loadURL(devUrl);
  else await window.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));

  let elapsed = 0;
  const notified = new Set<string>();
  const timer = setInterval(() => {
    elapsed += 15;
    if (store.state.settings.autoSync && elapsed >= store.state.settings.syncMinutes * 60 && !syncing) {
      elapsed = 0;
      void sync(range).catch(() => {});
    }
    if (!store.state.settings.reminders || !Notification.isSupported()) return;
    const now = Date.now();
    const upcoming = expandLocalEvents(store.state.events, { start: new Date(now - 60_000).toISOString(), end: new Date(now + 15 * 86400_000).toISOString() });
    for (const event of upcoming) {
      if (event.allDay || event.reminder < 0 || event.completed) continue;
      const at = new Date(event.start).getTime() - event.reminder * 60_000;
      const key = `${event.id}/${at}`;
      if (now >= at && now - at < 30_000 && !notified.has(key)) {
        notified.add(key);
        const notification = new Notification({ title: event.title, body: event.location || '日程即将开始' });
        notification.on('click', () => { window?.show(); window?.focus(); });
        notification.show();
      }
    }
  }, 15_000);
  window.on('closed', () => { clearInterval(timer); window = null; });
  if (!existsSync(binary)) store.state.syncError = '飞书连接组件缺失，请重新安装应用。';
}

if (hasLock) app.whenReady().then(main).catch(error => {
  dialog.showErrorBox('飞历启动失败', String(error.message));
  app.quit();
});
app.on('window-all-closed', () => app.quit());
