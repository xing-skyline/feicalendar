import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { PortableUpdater, RELEASE_API } from "../../electron/updater";

const [directory, target, source] = process.argv.slice(2);
const payload = await readFile(source);
const updater = new PortableUpdater({
  directory,
  executable: target,
  version: "0.4.1",
  changed: () => {},
  fetch: async (url) =>
    String(url) === RELEASE_API
      ? Response.json({
          tag_name: "v0.5.0",
          assets: [
            {
              name: "FeiCalendar-0.5.0-win-x64.exe",
              size: payload.length,
              browser_download_url:
                "https://github.com/xing-skyline/feicalendar/releases/download/v0.5.0/FeiCalendar-0.5.0-win-x64.exe",
              digest: `sha256:${createHash("sha256").update(payload).digest("hex")}`,
            },
          ],
        })
      : new Response(payload),
});
await updater.check();
await updater.download();
const launch = await updater.prepareInstall();
await launch();
// Match Electron's normal app.quit() after the helper has acknowledged startup.
process.exit(0);
