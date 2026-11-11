const path = require("node:path");
const { app } = require("electron");
const root = path.resolve(__dirname, "../..");
require("./observe-tray.cjs");
app.setAppPath(root);
require(path.join(root, "dist-electron/main.cjs"));
