import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, open, rename, rm, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import type { UpdateStatus } from "../src/shared/types";

export const RELEASE_API =
  "https://api.github.com/repos/xing-skyline/feicalendar/releases/latest";
const RELEASE_PREFIX = "https://github.com/xing-skyline/feicalendar/releases/";
const MAX_DOWNLOAD = 500 * 1024 * 1024;
type Asset = {
  name: string;
  size: number;
  browser_download_url: string;
  digest?: string;
};
export type Release = {
  version: string;
  notes: string;
  url: string;
  asset: Asset;
  checksum?: Asset;
};

export function compareVersions(left: string, right: string) {
  const parse = (value: string) => {
    if (!/^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value))
      throw new Error("版本号格式无效");
    return value.replace(/^v/, "").split(".").map(Number);
  };
  const a = parse(left),
    b = parse(right);
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] > b[i] ? 1 : -1;
  }
  return 0;
}

export function trustedDownload(input: string) {
  const url = new URL(input);
  if (url.protocol !== "https:" || url.username || url.password || url.port)
    throw new Error("更新下载地址不可信");
  if (
    url.hostname === "github.com" &&
    url.pathname.startsWith("/xing-skyline/feicalendar/releases/download/")
  )
    return url.href;
  if (
    [
      "release-assets.githubusercontent.com",
      "objects.githubusercontent.com",
    ].includes(url.hostname)
  )
    return url.href;
  throw new Error("更新下载地址不可信");
}

export function parseRelease(value: unknown): Release {
  const data = value as Record<string, unknown>;
  if (
    !data ||
    data.draft ||
    data.prerelease ||
    typeof data.tag_name !== "string"
  )
    throw new Error("没有可用的正式版本");
  compareVersions(data.tag_name, "0.0.0");
  const version = data.tag_name.replace(/^v/, "");
  if (!Array.isArray(data.assets)) throw new Error("此版本尚未上传便携版文件");
  const asset = data.assets.find(
    (item) => item?.name === `FeiCalendar-${version}-win-x64.exe`,
  ) as Asset | undefined;
  if (
    !asset ||
    !Number.isSafeInteger(asset.size) ||
    asset.size <= 0 ||
    asset.size > MAX_DOWNLOAD
  )
    throw new Error("此版本缺少有效的 Windows x64 便携版");
  trustedDownload(asset.browser_download_url);
  // The first hop must belong to this project's release, not just a GitHub CDN.
  if (!asset.browser_download_url.startsWith(`${RELEASE_PREFIX}download/`))
    throw new Error("更新文件不属于本项目");
  const checksum = data.assets.find(
    (item) => item?.name === "SHA256SUMS.txt",
  ) as Asset | undefined;
  if (checksum) {
    trustedDownload(checksum.browser_download_url);
    if (
      !checksum.browser_download_url.startsWith(`${RELEASE_PREFIX}download/`) ||
      checksum.size > 65536
    )
      throw new Error("校验文件无效");
  }
  if (!/^sha256:[a-f\d]{64}$/i.test(asset.digest || "") && !checksum)
    throw new Error("此版本缺少 SHA-256 校验信息");
  return {
    version,
    notes: typeof data.body === "string" ? data.body.slice(0, 20_000) : "",
    url: `${RELEASE_PREFIX}tag/${encodeURIComponent(data.tag_name)}`,
    asset,
    checksum,
  };
}

export function checksumFromText(text: string, filename: string) {
  for (const line of text.split(/\r?\n/)) {
    const match = /^([a-f\d]{64})\s+\*?(.+?)\s*$/i.exec(line);
    if (match?.[2] === filename) return match[1].toLowerCase();
  }
  throw new Error("SHA256SUMS.txt 缺少此更新文件的校验值");
}

export async function fileHash(file: string) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

// The helper runs outside the portable extraction directory so that NSIS can
// release its launcher lock. Literal paths are passed through a JSON manifest.
export function installScript(manifestPath: string) {
  const literal = manifestPath.replace(/'/g, "''");
  return `$ErrorActionPreference = 'Stop'
function Get-UpdateHash([string]$file) {
  $stream = [IO.File]::OpenRead($file)
  $hash = [Security.Cryptography.SHA256]::Create()
  try { return [BitConverter]::ToString($hash.ComputeHash($stream)).Replace('-', '').ToLowerInvariant() }
  finally { $stream.Dispose(); $hash.Dispose() }
}
$m = Get-Content -LiteralPath '${literal}' -Raw -Encoding UTF8 | ConvertFrom-Json
$staged = $m.target + '.update-new'
$backup = $m.target + '.previous'
$moved = $false
$installed = $false
try {
  $p = Get-Process -Id $m.pid -ErrorAction SilentlyContinue
  if ($p -and $p.Path -eq $m.processPath) { if (-not $p.WaitForExit(120000)) { throw '等待应用退出超时' } }
  if ((Get-UpdateHash $m.source) -ne $m.sha256) { throw '更新文件校验失败' }
  Copy-Item -LiteralPath $m.source -Destination $staged -Force
  if ((Get-UpdateHash $staged) -ne $m.sha256) { throw '写入更新文件失败' }
  for ($attempt = 0; $attempt -lt 120; $attempt++) {
    try {
      if (Test-Path -LiteralPath $backup) { Remove-Item -LiteralPath $backup -Force }
      Move-Item -LiteralPath $m.target -Destination $backup
      $moved = $true
      break
    } catch { Start-Sleep -Milliseconds 500 }
  }
  if (-not $moved) { throw '原程序仍被占用，未替换程序' }
  Move-Item -LiteralPath $staged -Destination $m.target
  $installed = $true
  @{ ok = $true; version = $m.version } | ConvertTo-Json | Set-Content -LiteralPath $m.result -Encoding UTF8
  Start-Process -FilePath $m.target -WorkingDirectory ([IO.Path]::GetDirectoryName($m.target)) -WindowStyle Hidden
} catch {
  $message = $_.Exception.Message
  if ($moved) {
    if ($installed -and (Test-Path -LiteralPath $m.target)) { Remove-Item -LiteralPath $m.target -Force }
    if (Test-Path -LiteralPath $backup) { Move-Item -LiteralPath $backup -Destination $m.target -Force }
  }
  @{ ok = $false; error = $message } | ConvertTo-Json | Set-Content -LiteralPath $m.result -Encoding UTF8
  if (Test-Path -LiteralPath $m.target) { Start-Process -FilePath $m.target -WorkingDirectory ([IO.Path]::GetDirectoryName($m.target)) -WindowStyle Hidden }
} finally {
  if (Test-Path -LiteralPath $staged) { Remove-Item -LiteralPath $staged -Force }
}`;
}

export class PortableUpdater {
  status: UpdateStatus;
  private release?: Release;
  private downloaded?: { file: string; hash: string };
  private working?: Promise<UpdateStatus>;
  private directory: string;
  constructor(
    private options: {
      directory: string;
      version: string;
      executable?: string;
      changed: (state: UpdateStatus) => void;
      fetch?: typeof fetch;
    },
  ) {
    this.directory = path.join(options.directory, "updates");
    this.status = {
      phase: "idle",
      currentVersion: options.version,
      canInstall: Boolean(options.executable && process.platform === "win32"),
    };
  }
  private set(patch: Partial<UpdateStatus>) {
    this.status = { ...this.status, ...patch };
    this.options.changed(this.status);
    return this.status;
  }
  private request(url: string, signal: AbortSignal) {
    return (this.options.fetch || fetch)(url, {
      signal,
      redirect: "manual",
      headers: {
        "User-Agent": `FeiCalendar/${this.options.version}`,
        Accept: "application/vnd.github+json",
      },
    });
  }
  private async response(
    url: string,
    signal: AbortSignal,
    api = false,
  ): Promise<Response> {
    let next = url;
    for (let hop = 0; hop < 6; hop++) {
      if (!api || hop > 0) trustedDownload(next);
      const result = await this.request(next, signal);
      if ([301, 302, 303, 307, 308].includes(result.status)) {
        const redirect = result.headers.get("location");
        await result.body?.cancel();
        if (!redirect) throw new Error("更新服务器跳转无效");
        next = new URL(redirect, next).href;
        continue;
      }
      if (!result.ok) {
        await result.body?.cancel();
        throw new Error(
          result.status === 403 || result.status === 429
            ? "GitHub 暂时限制了检查频率，请稍后再试"
            : `更新服务器返回 ${result.status}`,
        );
      }
      return result;
    }
    throw new Error("更新下载跳转次数过多");
  }
  private async small(url: string, limit: number, api = false) {
    const response = await this.response(url, AbortSignal.timeout(30_000), api);
    const reader = response.body?.getReader();
    if (!reader) throw new Error("更新服务器没有返回内容");
    let length = 0;
    const chunks: Uint8Array[] = [];
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        length += value.length;
        if (length > limit) throw new Error("更新服务器响应过大");
        chunks.push(value);
      }
    } finally {
      await reader.cancel().catch(() => {});
    }
    return Buffer.concat(chunks).toString("utf8");
  }
  private run(task: () => Promise<UpdateStatus>) {
    if (this.working) return this.working;
    this.working = task()
      .catch((error) =>
        this.set({
          phase: "error",
          error: error instanceof Error ? error.message : "更新失败，请重试",
        }),
      )
      .finally(() => {
        this.working = undefined;
      });
    return this.working;
  }
  async restoreResult() {
    try {
      const result = JSON.parse(
        (
          await readFile(path.join(this.directory, "result.json"), "utf8")
        ).replace(/^\uFEFF/, ""),
      );
      if (!result.ok)
        this.set({
          phase: "error",
          error: `上次升级未完成，已保留原程序：${String(result.error).slice(0, 500)}`,
        });
      await rm(path.join(this.directory, "result.json"));
    } catch {
      /* No previous installation. */
    }
  }
  check() {
    if (this.status.phase === "ready" || this.status.phase === "installing")
      return Promise.resolve(this.status);
    return this.run(async () => {
      this.set({ phase: "checking", error: undefined, progress: undefined });
      const release = parseRelease(
        JSON.parse(await this.small(RELEASE_API, 1024 * 1024, true)),
      );
      this.release = release;
      const newer = compareVersions(release.version, this.options.version) > 0;
      return this.set({
        phase: newer ? "available" : "latest",
        version: release.version,
        notes: release.notes,
        url: release.url,
        checkedAt: new Date().toISOString(),
      });
    });
  }
  download() {
    if (this.status.phase === "ready" || this.status.phase === "installing")
      return Promise.resolve(this.status);
    return this.run(async () => {
      const release = this.release;
      if (
        !release ||
        compareVersions(release.version, this.options.version) <= 0
      )
        throw new Error("请先检查可用的新版本");
      this.set({ phase: "downloading", progress: 0, error: undefined });
      await mkdir(this.directory, { recursive: true });
      const file = path.join(this.directory, release.asset.name);
      const partial = `${file}.partial`;
      const expected = /^sha256:[a-f\d]{64}$/i.test(release.asset.digest || "")
        ? release.asset.digest!.slice(7).toLowerCase()
        : checksumFromText(
            await this.small(release.checksum!.browser_download_url, 65536),
            release.asset.name,
          );
      const response = await this.response(
        release.asset.browser_download_url,
        AbortSignal.timeout(15 * 60_000),
      );
      const reader = response.body?.getReader();
      if (!reader) throw new Error("下载内容为空");
      const output = await open(partial, "w");
      let count = 0,
        lastProgress = -1;
      const hash = createHash("sha256");
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          count += value.length;
          if (count > release.asset.size || count > MAX_DOWNLOAD)
            throw new Error("更新文件大小与发布信息不符");
          hash.update(value);
          let offset = 0;
          while (offset < value.length) {
            const { bytesWritten } = await output.write(
              value,
              offset,
              value.length - offset,
            );
            offset += bytesWritten;
          }
          const progress = Math.floor((count * 100) / release.asset.size);
          if (progress !== lastProgress) {
            lastProgress = progress;
            this.set({ progress });
          }
        }
        await output.sync();
        if (count !== release.asset.size || hash.digest("hex") !== expected)
          throw new Error("更新文件 SHA-256 校验失败，请重新下载");
      } catch (error) {
        await output.close();
        await rm(partial, { force: true });
        throw error;
      } finally {
        await reader.cancel().catch(() => {});
      }
      await output.close();
      await rename(partial, file);
      this.downloaded = { file, hash: expected };
      return this.set({ phase: "ready", progress: 100 });
    });
  }
  async prepareInstall() {
    const target = this.options.executable;
    if (
      !this.status.canInstall ||
      !target ||
      !path.isAbsolute(target) ||
      path.extname(target).toLowerCase() !== ".exe"
    )
      throw new Error("请使用 Windows 便携版进行升级");
    if (this.status.phase !== "ready" || !this.downloaded || !this.release)
      throw new Error("请先下载并校验新版本");
    if ((await fileHash(this.downloaded.file)) !== this.downloaded.hash) {
      this.downloaded = undefined;
      this.set({ phase: "error", error: "更新文件已变化，请重新检查并下载" });
      throw new Error("更新文件已变化，请重新检查并下载");
    }
    // Fail while the app is still running if the portable folder is read-only.
    const probe = path.join(
      path.dirname(target),
      `.feicalendar-write-${process.pid}`,
    );
    const handle = await open(probe, "wx");
    await handle.close();
    await rm(probe);
    const manifest = path.join(this.directory, "install.json");
    await writeFile(
      manifest,
      JSON.stringify({
        pid: process.pid,
        processPath: process.execPath,
        source: this.downloaded.file,
        target,
        sha256: this.downloaded.hash,
        version: this.release.version,
        result: path.join(this.directory, "result.json"),
      }),
    );
    return () =>
      new Promise<void>((resolve, reject) => {
        const executable = path.join(
          process.env.SystemRoot || "C:\\Windows",
          "System32",
          "WindowsPowerShell",
          "v1.0",
          "powershell.exe",
        );
        const child = spawn(
          executable,
          [
            "-NoProfile",
            "-NonInteractive",
            "-EncodedCommand",
            Buffer.from(installScript(manifest), "utf16le").toString("base64"),
          ],
          {
            detached: true,
            stdio: "ignore",
            windowsHide: true,
            cwd: this.directory,
            env: Object.fromEntries(
              Object.entries(process.env).filter(
                ([key]) => !key.startsWith("PORTABLE_EXECUTABLE_"),
              ),
            ),
          },
        );
        child.once("error", reject);
        child.once("spawn", () => {
          child.unref();
          this.set({ phase: "installing" });
          resolve();
        });
      });
  }
}
