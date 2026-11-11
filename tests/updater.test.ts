import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdtemp,
  readFile,
  writeFile,
  copyFile,
  rm,
  readdir,
} from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import os from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import {
  compareVersions,
  parseRelease,
  trustedDownload,
  checksumFromText,
  PortableUpdater,
  fileHash,
  installScript,
  RELEASE_API,
} from "../electron/updater";

const bytes = Buffer.from("fixture portable download");
const digest = createHash("sha256").update(bytes).digest("hex");
function release() {
  return {
    tag_name: "v0.5.0",
    draft: false,
    prerelease: false,
    body: "New release",
    assets: [
      {
        name: "FeiCalendar-0.5.0-win-x64.exe",
        size: bytes.length,
        browser_download_url:
          "https://github.com/xing-skyline/feicalendar/releases/download/v0.5.0/FeiCalendar-0.5.0-win-x64.exe",
        digest: `sha256:${digest}`,
      },
    ],
  };
}
async function temporary(t: TestContext) {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "feicalendar-update-"),
  );
  t.after(async () => {
    assert.equal(path.dirname(directory), path.resolve(os.tmpdir()));
    assert.ok(path.basename(directory).startsWith("feicalendar-update-"));
    await rm(directory, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 200,
    });
  });
  return directory;
}

test("updates compare numeric stable versions and reject unsupported release channels", () => {
  assert.equal(compareVersions("v0.10.0", "0.9.9"), 1);
  assert.equal(compareVersions("0.5.0", "0.5.0"), 0);
  assert.equal(compareVersions("0.4.10", "0.5.0"), -1);
  assert.throws(() => compareVersions("0.5.0-beta", "0.4.1"));
  assert.throws(() => parseRelease({ ...release(), prerelease: true }));
  assert.throws(() => parseRelease({ ...release(), assets: [] }));
  const unsafe = release();
  unsafe.assets[0].browser_download_url =
    "https://github.com/other/project/releases/download/a/app.exe";
  assert.throws(() => parseRelease(unsafe));
  for (const url of [
    "http://github.com/xing-skyline/feicalendar/releases/download/v1/file",
    "https://github.com.evil.test/x",
    "https://127.0.0.1/file",
    "https://user:pass@release-assets.githubusercontent.com/file",
  ])
    assert.throws(() => trustedDownload(url));
  assert.equal(
    checksumFromText(
      `${digest} *FeiCalendar-0.5.0-win-x64.exe\r\n`,
      "FeiCalendar-0.5.0-win-x64.exe",
    ),
    digest,
  );
  assert.throws(() =>
    checksumFromText(`${digest} other.exe`, "FeiCalendar-0.5.0-win-x64.exe"),
  );
});

test("download follows trusted redirects, verifies the whole payload and coalesces requests", async (t) => {
  const directory = await temporary(t);
  const requests: string[] = [];
  const updater = new PortableUpdater({
    directory,
    version: "0.4.1",
    executable: path.join(directory, "app.exe"),
    changed: () => {},
    fetch: async (input) => {
      const url = String(input);
      requests.push(url);
      if (url === RELEASE_API) return Response.json(release());
      if (url.includes("github.com/"))
        return new Response(null, {
          status: 302,
          headers: {
            location: "https://release-assets.githubusercontent.com/fixture",
          },
        });
      return new Response(bytes);
    },
  });
  assert.equal((await updater.check()).phase, "available");
  const [first, second] = await Promise.all([
    updater.download(),
    updater.download(),
  ]);
  assert.equal(first.phase, "ready");
  assert.equal(second.phase, "ready");
  assert.equal(requests.length, 3);
  assert.equal(
    await fileHash(
      path.join(directory, "updates", "FeiCalendar-0.5.0-win-x64.exe"),
    ),
    digest,
  );
  await writeFile(
    path.join(directory, "updates", "FeiCalendar-0.5.0-win-x64.exe"),
    "changed after download",
  );
  await assert.rejects(updater.prepareInstall(), /文件已变化/);
});

test("corrupt download and untrusted redirects leave no installable partial file; retries work", async (t) => {
  const directory = await temporary(t);
  let mode = "corrupt";
  const updater = new PortableUpdater({
    directory,
    version: "0.4.1",
    changed: () => {},
    fetch: async (input) => {
      if (String(input) === RELEASE_API) return Response.json(release());
      if (mode === "redirect")
        return new Response(null, {
          status: 302,
          headers: { location: "https://example.com/app.exe" },
        });
      return new Response(
        mode === "corrupt" ? Buffer.alloc(bytes.length) : bytes,
      );
    },
  });
  await updater.check();
  assert.equal((await updater.download()).phase, "error");
  assert.deepEqual(await readdir(path.join(directory, "updates")), []);
  mode = "redirect";
  assert.equal((await updater.download()).phase, "error");
  assert.match(updater.status.error!, /不可信/);
  mode = "valid";
  assert.equal((await updater.download()).phase, "ready");
});

test("a lower public release never offers downgrade and a missing digest uses the exact checksum entry", async (t) => {
  const directory = await temporary(t);
  const latest = new PortableUpdater({
    directory,
    version: "0.6.0",
    changed: () => {},
    fetch: async () => Response.json(release()),
  });
  assert.equal((await latest.check()).phase, "latest");
  assert.equal((await latest.download()).phase, "error");
  const value = release();
  value.assets[0].digest = "";
  value.assets.push({
    name: "SHA256SUMS.txt",
    size: 110,
    browser_download_url:
      "https://github.com/xing-skyline/feicalendar/releases/download/v0.5.0/SHA256SUMS.txt",
    digest: "",
  });
  const updater = new PortableUpdater({
    directory,
    version: "0.4.1",
    changed: () => {},
    fetch: async (input) =>
      String(input) === RELEASE_API
        ? Response.json(value)
        : String(input).endsWith("SHA256SUMS.txt")
          ? new Response(`${digest}  FeiCalendar-0.5.0-win-x64.exe`)
          : new Response(bytes),
  });
  await updater.check();
  assert.equal((await updater.download()).phase, "ready");
});

test(
  "Windows helper replaces a portable executable in a Unicode path and rolls back failed launch",
  { skip: process.platform !== "win32" },
  async (t) => {
    const directory = await temporary(t);
    const target = path.join(directory, "飞历 便携版.exe");
    const source = path.join(directory, "new.exe");
    const result = path.join(directory, "result.json");
    const manifest = path.join(directory, "install.json");
    const system = path.join(
      process.env.SystemRoot || "C:\\Windows",
      "System32",
    );
    await copyFile(path.join(system, "where.exe"), target);
    await copyFile(path.join(system, "whoami.exe"), source);
    const oldHash = await fileHash(target);
    const run = async () => {
      await writeFile(
        manifest,
        JSON.stringify({
          pid: 0,
          processPath: "fixture",
          source,
          target,
          sha256: await fileHash(source),
          version: "0.5.0",
          result,
        }),
      );
      await promisify(execFile)(
        path.join(system, "WindowsPowerShell", "v1.0", "powershell.exe"),
        [
          "-NoProfile",
          "-NonInteractive",
          "-EncodedCommand",
          Buffer.from(installScript(manifest), "utf16le").toString("base64"),
        ],
        { windowsHide: true, timeout: 20_000 },
      );
      return JSON.parse(
        (await readFile(result, "utf8")).replace(/^\uFEFF/, ""),
      );
    };
    const first = await run();
    assert.equal(first.ok, true, JSON.stringify(first));
    assert.equal(await fileHash(target), await fileHash(source));
    assert.equal(await fileHash(`${target}.previous`), oldHash);
    const installedHash = await fileHash(target);
    await writeFile(source, "fixture invalid executable");
    assert.equal((await run()).ok, false);
    assert.equal(await fileHash(target), installedHash);
  },
);

test(
  "the production helper starts hidden and survives its parent exiting",
  { skip: process.platform !== "win32" },
  async (t) => {
    const directory = await temporary(t);
    const system = path.join(
      process.env.SystemRoot || "C:\\Windows",
      "System32",
    );
    const target = path.join(directory, "飞历 升级.exe");
    const source = path.join(system, "whoami.exe");
    await copyFile(path.join(system, "where.exe"), target);
    await promisify(execFile)(
      process.execPath,
      [
        "--import",
        "tsx",
        "scripts/fixtures/update-launcher.ts",
        directory,
        target,
        source,
      ],
      { windowsHide: true, timeout: 20_000 },
    );
    const expected = await fileHash(source);
    let result: { ok: boolean } | undefined;
    for (let attempt = 0; attempt < 100; attempt++) {
      try {
        result = JSON.parse(
          (
            await readFile(path.join(directory, "updates/result.json"), "utf8")
          ).replace(/^\uFEFF/, ""),
        );
      } catch {
        /* The helper is still writing its completion result. */
      }
      if (result) break;
      await delay(100);
    }
    assert.equal(await fileHash(target), expected);
    assert.equal(
      await readFile(path.join(directory, "updates/installer.ready"), "utf8"),
      "ready",
    );
    assert.equal(result?.ok, true);
  },
);
