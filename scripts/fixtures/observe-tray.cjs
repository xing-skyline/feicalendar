const { Tray } = require("electron");
const original = Tray.prototype.setContextMenu;
Tray.prototype.setContextMenu = function (menu) {
  globalThis.observedTrayMenu = menu;
  return original.call(this, menu);
};
