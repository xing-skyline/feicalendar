import { createServer } from "vite";
import { spawn } from "node:child_process";
import electron from "electron";
import "./build-main.mjs";

const server = await createServer();
await server.listen();
const env = { ...process.env, FEICALENDAR_DEV_URL: "http://127.0.0.1:5179" };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(electron, ["."], { stdio: "inherit", env });
child.on("exit", async (code) => {
  await server.close();
  process.exit(code ?? 0);
});
