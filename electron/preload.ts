import { contextBridge, ipcRenderer } from "electron";
import type { DesktopAPI } from "../src/shared/types";

const api: DesktopAPI = {
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
