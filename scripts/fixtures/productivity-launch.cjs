const path = require("node:path");
const { app, BrowserWindow } = require("electron");
const root = path.resolve(__dirname, "../..");
require("./observe-tray.cjs");
// Exercise real renderer/IPC/storage while keeping test windows out of the user's workspace.
BrowserWindow.prototype.show = function () {};
BrowserWindow.prototype.showInactive = function () {};
BrowserWindow.prototype.focus = function () {};
app.setAppPath(root);
require(path.join(root, "dist-electron/main.cjs"));
