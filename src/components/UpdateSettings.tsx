import { useEffect, useState } from "react";
import { Download, RefreshCw, CheckCircle2, ExternalLink } from "lucide-react";
import type { Settings, UpdateStatus } from "../shared/types";
import { version } from "../../package.json";

export default function UpdateSettings({
  settings,
  configure,
}: {
  settings: Settings;
  configure: (patch: Partial<Settings>) => Promise<void>;
}) {
  const [status, setStatus] = useState<UpdateStatus>({
    phase: "idle",
    currentVersion: version,
    canInstall: false,
  });
  const [error, setError] = useState("");
  useEffect(() => {
    void window.calendar
      .updateAction("status")
      .then(setStatus)
      .catch((err: Error) => setError(err.message));
    return window.calendar.onUpdate(setStatus);
  }, []);
  const act = async (action: "check" | "download" | "install") => {
    setError("");
    try {
      setStatus(await window.calendar.updateAction(action));
    } catch (err) {
      setError((err as Error).message);
    }
  };
  const busy = ["checking", "downloading", "installing"].includes(status.phase);
  const available =
    status.version &&
    ["available", "downloading", "ready", "installing"].includes(status.phase);
  return (
    <>
      <h3>软件更新</h3>
      <div className="update-card">
        <div className="update-symbol">
          {status.phase === "latest" ? (
            <CheckCircle2 size={30} />
          ) : (
            <Download size={30} />
          )}
        </div>
        <div>
          <b>飞历 FeiCalendar</b>
          <p>当前版本 {status.currentVersion}</p>
          {available && <strong>发现新版本 {status.version}</strong>}
          {status.phase === "latest" && <strong>当前已是最新正式版本</strong>}
        </div>
      </div>
      <label className="setting-row">
        <div>
          <b>自动检查更新</b>
          <p>启动后及运行期间每天检查一次 GitHub Releases</p>
        </div>
        <input
          type="checkbox"
          aria-label="自动检查更新"
          checked={settings.autoCheckUpdates}
          onChange={(event) =>
            void configure({ autoCheckUpdates: event.target.checked })
          }
        />
      </label>
      <p className="muted-text">
        新版由项目 GitHub
        发布。下载完成后点击“退出并升级”，飞历会保存数据、替换便携版程序并重新打开。
      </p>
      {status.checkedAt && (
        <p className="muted-text">
          上次检查 {new Date(status.checkedAt).toLocaleString("zh-CN")}
        </p>
      )}
      {(status.error || error) && (
        <p className="error-box" role="alert">
          {error || status.error}
        </p>
      )}
      {status.phase === "downloading" && (
        <div className="update-progress">
          <progress max="100" value={status.progress || 0} />
          <span>下载中 {status.progress || 0}%</span>
        </div>
      )}
      {status.phase === "ready" && (
        <p className="update-ready">
          下载完成，SHA-256 校验通过。升级前会保留原程序副本。
        </p>
      )}
      {status.phase === "installing" && <p>正在退出并升级，请稍候…</p>}
      <div className="form-actions">
        <button
          className="secondary"
          disabled={busy || status.phase === "ready"}
          onClick={() => void act("check")}
        >
          <RefreshCw size={15} />
          {status.phase === "checking" ? "正在检查…" : "检查更新"}
        </button>
        {status.phase === "available" && (
          <button
            className="primary"
            disabled={!status.canInstall}
            onClick={() => void act("download")}
          >
            <Download size={15} />
            下载 {status.version}
          </button>
        )}
        {status.phase === "error" && status.version && (
          <button className="secondary" onClick={() => void act("check")}>
            重新检查
          </button>
        )}
        {status.phase === "ready" && (
          <button
            className="primary"
            disabled={!status.canInstall}
            onClick={() => void act("install")}
          >
            退出并升级
          </button>
        )}
      </div>
      {!status.canInstall && (
        <p className="muted-text">
          应用内替换程序适用于 Windows x64
          便携版。当前运行方式可前往发布页下载。
        </p>
      )}
      <button
        className="text-button"
        onClick={() =>
          void window.calendar.openExternal(
            status.url ||
              "https://github.com/xing-skyline/feicalendar/releases/latest",
          )
        }
      >
        <ExternalLink size={15} /> 查看 GitHub 发布页
      </button>
      {status.notes && (
        <details className="update-notes" open={Boolean(available)}>
          <summary>版本说明</summary>
          <pre>{status.notes}</pre>
        </details>
      )}
    </>
  );
}
