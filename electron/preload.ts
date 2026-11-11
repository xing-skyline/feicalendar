import { contextBridge, ipcRenderer } from "electron";
import type { DesktopAPI } from "../src/shared/types";

const api: DesktopAPI = {
  oauthConnect: (input) => ipcRenderer.invoke("calendar:oauth-connect", input),
  oauthCancel: () => ipcRenderer.invoke("calendar:oauth-cancel"),
  saveSemester: (value, activate) =>
    ipcRenderer.invoke("calendar:save-semester", value, activate),
  deleteSemester: (id) => ipcRenderer.invoke("calendar:delete-semester", id),
  saveCourse: (value) => ipcRenderer.invoke("calendar:save-course", value),
  deleteCourse: (id) => ipcRenderer.invoke("calendar:delete-course", id),
  bulkEvents: (input) => ipcRenderer.invoke("calendar:bulk-events", input),
  importPreview: (calendarId, range) =>
    ipcRenderer.invoke("calendar:import-preview", calendarId, range),
  importApply: (token, ids) =>
    ipcRenderer.invoke("calendar:import-apply", token, ids),
  printCalendar: (input, pdf) =>
    ipcRenderer.invoke("calendar:print", input, pdf),
  saveTask: (task) => ipcRenderer.invoke("calendar:save-task", task),
  deleteTask: (id, removeScheduled) =>
    ipcRenderer.invoke("calendar:delete-task", id, removeScheduled),
  scheduleTask: (id, start, calendarId, blockId) =>
    ipcRenderer.invoke(
      "calendar:schedule-task",
      id,
      start,
      calendarId,
      blockId,
    ),
  saveCalendarSet: (set) =>
    ipcRenderer.invoke("calendar:save-calendar-set", set),
  deleteCalendarSet: (id) =>
    ipcRenderer.invoke("calendar:delete-calendar-set", id),
  applyCalendarSet: (id, desktop) =>
    ipcRenderer.invoke("calendar:apply-calendar-set", id, desktop),
  updateHolidays: () => ipcRenderer.invoke("calendar:update-holidays"),
  holidayOverride: (date, value) =>
    ipcRenderer.invoke("calendar:holiday-override", date, value),
  saveSpecialDate: (value) =>
    ipcRenderer.invoke("calendar:save-special-date", value),
  deleteSpecialDate: (id) =>
    ipcRenderer.invoke("calendar:delete-special-date", id),
  backupList: () => ipcRenderer.invoke("calendar:backup-list"),
  backupExport: (password) =>
    ipcRenderer.invoke("calendar:backup-export", password),
  backupImport: (password) =>
    ipcRenderer.invoke("calendar:backup-import", password),
  backupPreview: (id, options) =>
    ipcRenderer.invoke("calendar:backup-preview", id, options),
  backupRestore: (token) =>
    ipcRenderer.invoke("calendar:backup-restore", token),
  undoChange: () => ipcRenderer.invoke("calendar:undo-change"),
  restoreTrash: (id) => ipcRenderer.invoke("calendar:restore-trash", id),
  displays: () => ipcRenderer.invoke("calendar:displays"),
  reminderRule: (id, minutes) =>
    ipcRenderer.invoke("calendar:reminder-rule", id, minutes),
  reminderAction: (id, action) =>
    ipcRenderer.invoke("calendar:reminder-action", id, action),
  quickCapture: (action) =>
    ipcRenderer.invoke("calendar:quick-capture", action),
  saveTemplate: (template) =>
    ipcRenderer.invoke("calendar:save-template", template),
  deleteTemplate: (id) => ipcRenderer.invoke("calendar:delete-template", id),
  desktopRange: (range) => ipcRenderer.invoke("calendar:desktop-range", range),
  desktop: (action) => ipcRenderer.invoke("calendar:desktop", action),
  desktopStatus: () => ipcRenderer.invoke("calendar:desktop-status"),
  navigate: (target) => ipcRenderer.invoke("calendar:navigate", target),
  onNavigate: (callback) => {
    const listener = (_: unknown, target: Parameters<typeof callback>[0]) =>
      callback(target);
    ipcRenderer.on("calendar:navigate", listener);
    return () => ipcRenderer.removeListener("calendar:navigate", listener);
  },
  updateAction: (action) =>
    ipcRenderer.invoke("calendar:update-action", action),
  onUpdate: (callback) => {
    const listener = (_: unknown, status: Parameters<typeof callback>[0]) =>
      callback(status);
    ipcRenderer.on("calendar:update", listener);
    return () => ipcRenderer.removeListener("calendar:update", listener);
  },
  snapshot: () => ipcRenderer.invoke("calendar:snapshot"),
  saveEvent: (input) => ipcRenderer.invoke("calendar:save-event", input),
  saveEvents: (inputs) => ipcRenderer.invoke("calendar:save-events", inputs),
  deleteEvent: (id, scope) =>
    ipcRenderer.invoke("calendar:delete-event", id, scope),
  saveCalendar: (input) => ipcRenderer.invoke("calendar:save-calendar", input),
  updateCalendar: (id, patch) =>
    ipcRenderer.invoke("calendar:update-calendar", id, patch),
  publishCalendar: (id, target) =>
    ipcRenderer.invoke("calendar:publish-calendar", id, target),
  settings: (patch) => ipcRenderer.invoke("calendar:settings", patch),
  saveConnection: (connection) =>
    ipcRenderer.invoke("calendar:save-connection", connection),
  removeConnection: (id) =>
    ipcRenderer.invoke("calendar:remove-connection", id),
  resolveTeachingConflict: (id, choice) =>
    ipcRenderer.invoke("calendar:resolve-teaching-conflict", id, choice),
  authStatus: () => ipcRenderer.invoke("calendar:auth-status"),
  configureApp: (appId, appSecret) =>
    ipcRenderer.invoke("calendar:configure-app", appId, appSecret),
  authStart: () => ipcRenderer.invoke("calendar:auth-start"),
  authFinish: (code) => ipcRenderer.invoke("calendar:auth-finish", code),
  sync: (range) => ipcRenderer.invoke("calendar:sync", range),
  resolveConflict: (id, choice) =>
    ipcRenderer.invoke("calendar:resolve-conflict", id, choice),
  exportCalendar: () => ipcRenderer.invoke("calendar:export"),
  openExternal: (url) => ipcRenderer.invoke("calendar:open-external", url),
  window: (action) => ipcRenderer.send("calendar:window", action),
  onChanged: (callback) => {
    const listener = (_: unknown, snapshot: Parameters<typeof callback>[0]) =>
      callback(snapshot);
    ipcRenderer.on("calendar:changed", listener);
    return () => ipcRenderer.removeListener("calendar:changed", listener);
  },
  onSync: (callback) => {
    const listener = (_: unknown, busy: boolean) => callback(busy);
    ipcRenderer.on("calendar:syncing", listener);
    return () => ipcRenderer.removeListener("calendar:syncing", listener);
  },
};
contextBridge.exposeInMainWorld("calendar", api);
