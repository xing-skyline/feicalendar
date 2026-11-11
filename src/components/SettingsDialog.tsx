import { useEffect, useState } from "react";
import { version } from "../../package.json";
import {
  X,
  Link2,
  SlidersHorizontal,
  RefreshCw,
  Cloud,
  Plus,
  Trash2,
  CheckCircle2,
  ExternalLink,
  Download,
  AlertCircle,
  CalendarDays,
  GraduationCap,
} from "lucide-react";
import type {
  AppSnapshot,
  AuthChallenge,
  AuthStatus,
  Connection,
} from "../shared/types";
import { hourTime } from "../shared/dates";
import DesktopSettings from "./DesktopSettings";
import UpdateSettings from "./UpdateSettings";
import CaptureSettings from "./CaptureSettings";
import ReminderCenter from "./ReminderCenter";
import RecoverySettings from "./RecoverySettings";
import HolidaySettings from "./HolidaySettings";
import CourseSettings from "./CourseSettings";
import OAuthConnections from "./OAuthConnections";

const connectionPresets = [
  { name: "通用 CalDAV", kind: "caldav", url: "", readOnly: false },
  {
    name: "iCloud 日历",
    kind: "caldav",
    url: "https://caldav.icloud.com",
    readOnly: false,
  },
  { name: "Nextcloud 日历", kind: "caldav", url: "", readOnly: false },
  {
    name: "飞书 CalDAV 订阅",
    kind: "caldav",
    url: "https://caldav.feishu.cn",
    readOnly: true,
  },
  {
    name: "坚果云",
    kind: "webdav",
    url: "https://dav.jianguoyun.com/dav/",
    readOnly: false,
  },
  { name: "Nextcloud / NAS 网盘", kind: "webdav", url: "", readOnly: false },
  { name: "自定义 WebDAV", kind: "webdav", url: "", readOnly: false },
  { name: "ICS 订阅", kind: "ics", url: "", readOnly: true },
] as const;

export default function SettingsDialog({
  snapshot,
  initialTab = "connections",
  update,
  onSync,
  onClose,
}: {
  snapshot: AppSnapshot;
  initialTab?: string;
  update: (snapshot: AppSnapshot) => void;
  onSync: () => Promise<void>;
  onClose: () => void;
}) {
  const [tab, setTab] = useState(initialTab);
  useEffect(() => setTab(initialTab), [initialTab]);
  const [auth, setAuth] = useState<AuthStatus>();
  const [challenge, setChallenge] = useState<AuthChallenge>();
  const [connection, setConnection] = useState<Connection>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [removing, setRemoving] = useState("");
  const [appId, setAppId] = useState("");
  const [appSecret, setAppSecret] = useState("");
  const [teachingDate, setTeachingDate] = useState(
    snapshot.settings.teachingStartDate,
  );
  const [teachingCount, setTeachingCount] = useState(
    String(snapshot.settings.teachingWeeks),
  );
  const pendingCount =
    snapshot.queue.length +
    snapshot.connections.filter((item) => item.teachingConflict).length;
  useEffect(() => {
    void window.calendar.authStatus().then(setAuth);
  }, []);
  const perform = async (operation: () => Promise<void>) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await operation();
    } catch (error) {
      setError(
        (error as Error).message.replace(
          /^Error invoking remote method '[^']+': Error: /,
          "",
        ),
      );
    } finally {
      setBusy(false);
    }
  };
  const configure = (patch: Parameters<typeof window.calendar.settings>[0]) =>
    perform(async () => update(await window.calendar.settings(patch)));
  const finish = async () => {
    const status = await window.calendar.authFinish(challenge!.deviceCode);
    setAuth(status);
    if (!status.available) throw new Error(status.message);
    update(await window.calendar.settings({ feishuEnabled: true }));
    setChallenge(undefined);
    await onSync();
    setNotice("飞书账号已连接，日历同步已完成。");
  };

  return (
    <div className="modal-backdrop">
      <section
        className="settings-modal modal"
        role="dialog"
        aria-modal="true"
        aria-label="设置"
      >
        <header className="modal-heading">
          <h2>设置</h2>
          <button
            className="icon-button"
            aria-label="关闭设置"
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </header>
        <div className="settings-layout">
          <nav className="settings-nav">
            <button
              className={tab === "courses" ? "active" : ""}
              onClick={() => setTab("courses")}
            >
              <GraduationCap size={17} />
              学期与课程
            </button>
            <button
              className={tab === "holidays" ? "active" : ""}
              onClick={() => setTab("holidays")}
            >
              <CalendarDays size={17} />
              农历与纪念日
            </button>
            <button
              className={tab === "recovery" ? "active" : ""}
              onClick={() => setTab("recovery")}
            >
              <Trash2 size={17} />
              回收站与备份
            </button>
            <button
              className={tab === "reminders" ? "active" : ""}
              onClick={() => setTab("reminders")}
            >
              <AlertCircle size={17} />
              提醒中心
            </button>
            <button
              className={tab === "connections" ? "active" : ""}
              onClick={() => setTab("connections")}
            >
              <Link2 size={17} />
              日历连接
            </button>
            <button
              className={tab === "general" ? "active" : ""}
              onClick={() => setTab("general")}
            >
              <SlidersHorizontal size={17} />
              通用设置
            </button>
            <button
              className={tab === "sync" ? "active" : ""}
              onClick={() => setTab("sync")}
            >
              <RefreshCw size={17} />
              同步记录
              {pendingCount > 0 && (
                <span className="count">{pendingCount}</span>
              )}
            </button>
            <button
              className={tab === "display" ? "active" : ""}
              onClick={() => setTab("display")}
            >
              <CalendarDays size={17} />
              日历显示
            </button>
            <button
              className={tab === "teaching" ? "active" : ""}
              onClick={() => setTab("teaching")}
            >
              <GraduationCap size={17} />
              教学周
            </button>
            <button
              className={tab === "desktop" ? "active" : ""}
              onClick={() => setTab("desktop")}
            >
              <CalendarDays size={17} />
              桌面日历
            </button>
            <button
              className={tab === "updates" ? "active" : ""}
              onClick={() => setTab("updates")}
            >
              <Download size={17} />
              软件更新
            </button>
            <div className="settings-version">FeiCalendar {version}</div>
          </nav>
          <div className="settings-content">
            {tab === "courses" && (
              <CourseSettings snapshot={snapshot} update={update} />
            )}
            {tab === "holidays" && (
              <HolidaySettings
                snapshot={snapshot}
                update={update}
                configure={configure}
              />
            )}
            {tab === "recovery" && (
              <RecoverySettings snapshot={snapshot} update={update} />
            )}
            {tab === "reminders" && (
              <ReminderCenter
                snapshot={snapshot}
                configure={configure}
                update={update}
              />
            )}
            {tab === "desktop" && (
              <DesktopSettings
                calendars={snapshot.calendars}
                settings={snapshot.settings}
                configure={configure}
              />
            )}
            {tab === "updates" && (
              <UpdateSettings
                settings={snapshot.settings}
                configure={configure}
              />
            )}
            {tab === "connections" && (
              <>
                <h3>让日程保持同步</h3>
                <p className="muted-text">
                  多个账号和同步方式可以同时启用，日程按所属日历同步到对应服务。
                </p>
                <div className="connection-card">
                  <div className="connection-header">
                    <span className="feishu-logo">
                      <Cloud size={24} />
                    </span>
                    <div>
                      <b>飞书日历</b>
                      <p>开放接口 · 双向同步</p>
                    </div>
                    <span
                      className={`connection-state ${auth?.available ? "online" : ""}`}
                    >
                      {auth?.available ? "已授权" : "待授权"}
                    </span>
                  </div>
                  <p className="connection-description">
                    {auth?.available
                      ? `${auth.name || "飞书用户"} · 新建、修改和删除日程可同步到飞书。`
                      : "使用飞书用户身份连接，授权后选择默认日历即可写回日程。"}
                  </p>
                  <div className="connection-actions">
                    <button
                      className="primary"
                      disabled={busy}
                      onClick={() =>
                        void perform(async () => {
                          if (auth?.available) {
                            update(
                              await window.calendar.settings({
                                feishuEnabled: true,
                              }),
                            );
                            await onSync();
                          } else
                            setChallenge(await window.calendar.authStart());
                        })
                      }
                    >
                      {busy
                        ? "处理中…"
                        : auth?.available
                          ? "连接并同步"
                          : "授权飞书账号"}
                    </button>
                    {auth?.available && (
                      <button
                        className="text-button"
                        disabled={busy}
                        onClick={() =>
                          void perform(async () =>
                            setChallenge(await window.calendar.authStart()),
                          )
                        }
                      >
                        重新授权
                      </button>
                    )}
                    {snapshot.settings.feishuEnabled && (
                      <label className="inline-check">
                        <input
                          type="checkbox"
                          checked={snapshot.settings.feishuEnabled}
                          onChange={(e) =>
                            void configure({ feishuEnabled: e.target.checked })
                          }
                        />
                        启用同步
                      </label>
                    )}
                  </div>
                </div>
                <details className="app-config">
                  <summary>配置飞书自建应用</summary>
                  <p className="muted-text">
                    填写已启用并发布日历权限的应用。保存后会更新本机 lark-cli
                    的应用配置，需要重新授权飞书账号。
                  </p>
                  <button
                    className="text-button"
                    onClick={() =>
                      void window.calendar.openExternal(
                        "https://open.feishu.cn/app",
                      )
                    }
                  >
                    打开飞书开放平台
                    <ExternalLink size={14} />
                  </button>
                  <form
                    className="subscription-form"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void perform(async () => {
                        await window.calendar.configureApp(
                          appId.trim(),
                          appSecret.trim(),
                        );
                        setAppSecret("");
                        setChallenge(undefined);
                        setAuth(await window.calendar.authStatus());
                        setNotice("应用配置已保存，请点击上方“授权飞书账号”。");
                      });
                    }}
                  >
                    <label>
                      App ID
                      <input
                        aria-label="飞书 App ID"
                        required
                        placeholder="cli_…"
                        value={appId}
                        onChange={(e) => setAppId(e.target.value)}
                      />
                    </label>
                    <label>
                      App Secret
                      <input
                        aria-label="飞书 App Secret"
                        type="password"
                        required
                        autoComplete="new-password"
                        value={appSecret}
                        onChange={(e) => setAppSecret(e.target.value)}
                      />
                    </label>
                    <button className="primary" disabled={busy}>
                      保存应用配置
                    </button>
                  </form>
                </details>
                {challenge && (
                  <div className="auth-panel">
                    <p>打开授权页面，或使用飞书扫描二维码。</p>
                    <button
                      className="text-button"
                      onClick={() =>
                        void window.calendar.openExternal(challenge.url)
                      }
                    >
                      打开飞书授权页面
                      <ExternalLink size={14} />
                    </button>
                    <img
                      src={challenge.qr}
                      alt="飞书授权二维码"
                      width={180}
                      height={180}
                    />
                    <button
                      className="primary"
                      disabled={busy}
                      onClick={() => void perform(finish)}
                    >
                      {busy ? "正在完成授权…" : "我已授权，完成连接"}
                    </button>
                  </div>
                )}
                <div className="section-heading">
                  <h3>更多同步来源</h3>
                  <button
                    className="text-button"
                    onClick={() =>
                      setConnection({
                        id: "",
                        name: "通用 CalDAV",
                        kind: "caldav",
                        url: "",
                        username: "",
                        password: "",
                        enabled: true,
                        readOnly: false,
                        syncTeaching: true,
                      })
                    }
                  >
                    <Plus size={16} />
                    添加连接
                  </button>
                </div>
                <p className="muted-text">
                  CalDAV 可与手机日历共同编辑。WebDAV
                  为多个飞历客户端同步日程和教学周。
                  每个连接独立保存，可分别暂停和恢复。
                </p>
                <OAuthConnections
                  snapshot={snapshot}
                  update={update}
                  onSync={onSync}
                />
                {snapshot.connections
                  .filter(
                    (item) => !["google", "microsoft"].includes(item.kind),
                  )
                  .map((item) => (
                    <div className="subscription-row" key={item.id}>
                      <Link2 size={18} />
                      <div>
                        <b>{item.name}</b>
                        <small>
                          {item.kind.toUpperCase()} ·{" "}
                          {item.teachingConflict
                            ? "配置冲突"
                            : item.enabled === false
                              ? "已暂停"
                              : item.error
                                ? "连接失败"
                                : item.lastSync
                                  ? "已同步"
                                  : "待同步"}
                        </small>
                        {item.error && (
                          <small className="error-text">{item.error}</small>
                        )}
                      </div>
                      <label className="inline-check">
                        <input
                          type="checkbox"
                          aria-label={`启用 ${item.name}`}
                          checked={item.enabled !== false}
                          disabled={busy}
                          onChange={(e) =>
                            void perform(async () => {
                              update(
                                await window.calendar.saveConnection({
                                  ...item,
                                  enabled: e.target.checked,
                                }),
                              );
                            })
                          }
                        />
                        启用
                      </label>
                      <button
                        className="text-button"
                        onClick={() => setConnection(item)}
                      >
                        编辑
                      </button>
                      <button
                        className="icon-button danger"
                        title="移除连接"
                        onClick={() => setRemoving(item.id)}
                      >
                        <Trash2 size={16} />
                      </button>
                      {removing === item.id && (
                        <div className="inline-confirm">
                          移除此连接及本地缓存？云端日程会保留。
                          <button
                            onClick={() =>
                              void perform(async () => {
                                update(
                                  await window.calendar.removeConnection(
                                    item.id,
                                  ),
                                );
                                setRemoving("");
                              })
                            }
                          >
                            确认移除
                          </button>
                          <button onClick={() => setRemoving("")}>取消</button>
                        </div>
                      )}
                    </div>
                  ))}
                {connection && (
                  <form
                    className="subscription-form"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void perform(async () => {
                        update(
                          await window.calendar.saveConnection(connection),
                        );
                        setConnection(undefined);
                        await onSync();
                      });
                    }}
                  >
                    {!connection.id && (
                      <label>
                        服务预设
                        <select
                          aria-label="服务预设"
                          defaultValue="0"
                          onChange={(e) => {
                            const preset =
                              connectionPresets[Number(e.target.value)];
                            setConnection({ ...connection, ...preset });
                          }}
                        >
                          {connectionPresets.map((preset, index) => (
                            <option key={preset.name} value={index}>
                              {preset.name}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                    <div className="form-two">
                      <label>
                        连接方式
                        <select
                          aria-label="订阅方式"
                          value={connection.kind}
                          disabled={Boolean(connection.id)}
                          onChange={(e) =>
                            setConnection({
                              ...connection,
                              kind: e.target.value as Connection["kind"],
                            })
                          }
                        >
                          <option value="caldav">CalDAV 账号</option>
                          <option value="webdav">WebDAV 网盘</option>
                          <option value="ics">ICS / Webcal 链接</option>
                        </select>
                      </label>
                      <label>
                        日历名称
                        <input
                          aria-label="订阅名称"
                          required
                          value={connection.name}
                          onChange={(e) =>
                            setConnection({
                              ...connection,
                              name: e.target.value,
                            })
                          }
                        />
                      </label>
                    </div>
                    <label>
                      {connection.kind === "ics" ? "订阅链接" : "服务器地址"}
                      <input
                        aria-label="订阅地址"
                        required
                        readOnly={Boolean(
                          connection.id && connection.kind !== "ics",
                        )}
                        value={connection.url}
                        onChange={(e) =>
                          setConnection({ ...connection, url: e.target.value })
                        }
                        placeholder="https://"
                      />
                    </label>
                    {connection.kind !== "ics" && (
                      <div className="form-two">
                        <label>
                          用户名
                          <input
                            aria-label="同步用户名"
                            required
                            readOnly={Boolean(connection.id)}
                            value={connection.username}
                            autoComplete="off"
                            onChange={(e) =>
                              setConnection({
                                ...connection,
                                username: e.target.value,
                              })
                            }
                          />
                        </label>
                        <label>
                          密码
                          <input
                            aria-label="同步密码"
                            type="password"
                            required={!connection.hasPassword}
                            value={connection.password || ""}
                            placeholder={
                              connection.hasPassword
                                ? "已保存，留空继续使用"
                                : ""
                            }
                            autoComplete="new-password"
                            onChange={(e) =>
                              setConnection({
                                ...connection,
                                password: e.target.value,
                              })
                            }
                          />
                        </label>
                      </div>
                    )}
                    {connection.kind === "caldav" && (
                      <label className="inline-check">
                        <input
                          type="checkbox"
                          aria-label="以只读方式连接"
                          checked={connection.readOnly !== false}
                          onChange={(e) =>
                            setConnection({
                              ...connection,
                              readOnly: e.target.checked,
                            })
                          }
                        />
                        以只读方式连接
                      </label>
                    )}
                    {connection.kind === "webdav" && (
                      <>
                        <p className="muted-text">
                          在服务器地址下的 FeiCalendar
                          文件夹保存此连接的日历。其他飞历客户端填写同一地址即可同步。手机系统日历可通过
                          CalDAV 连接。
                        </p>
                        <label className="inline-check">
                          <input
                            type="checkbox"
                            aria-label="同步教学周配置"
                            checked={Boolean(connection.syncTeaching)}
                            onChange={(e) =>
                              setConnection({
                                ...connection,
                                syncTeaching: e.target.checked,
                              })
                            }
                          />
                          同步教学周配置
                        </label>
                      </>
                    )}
                    <small>
                      填写服务商提供的应用密码。连接凭据使用 Windows
                      本地加密保存，每台设备单独配置。
                    </small>
                    <div className="form-actions">
                      <button
                        type="button"
                        className="secondary"
                        onClick={() => setConnection(undefined)}
                      >
                        取消
                      </button>
                      <button className="primary" disabled={busy}>
                        保存并同步
                      </button>
                    </div>
                  </form>
                )}
              </>
            )}
            {tab === "general" && (
              <>
                <h3>按你的习惯安排日程</h3>
                <label className="setting-row">
                  <div>
                    <b>关闭窗口后最小化到托盘</b>
                    <p>后台继续同步和提醒，通过托盘右键菜单退出</p>
                  </div>
                  <input
                    type="checkbox"
                    aria-label="关闭窗口后最小化到托盘"
                    checked={snapshot.settings.closeToTray}
                    onChange={(e) =>
                      void configure({ closeToTray: e.target.checked })
                    }
                  />
                </label>
                <label className="setting-row">
                  <div>
                    <b>默认日历</b>
                    <p>新建日程时使用的日历</p>
                  </div>
                  <select
                    aria-label="默认日历"
                    value={snapshot.settings.defaultCalendarId}
                    onChange={(e) =>
                      void configure({ defaultCalendarId: e.target.value })
                    }
                  >
                    {snapshot.calendars
                      .filter((item) => item.writable)
                      .map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name}
                        </option>
                      ))}
                  </select>
                </label>
                <label className="setting-row">
                  <div>
                    <b>新日程默认时长</b>
                    <p>新建或点击时间格时使用，拖选时按所选范围安排</p>
                  </div>
                  <select
                    aria-label="新日程默认时长"
                    value={snapshot.settings.defaultDurationMinutes}
                    onChange={(e) =>
                      void configure({
                        defaultDurationMinutes: Number(e.target.value),
                      })
                    }
                  >
                    {[15, 30, 45, 60, 90, 120, 180, 240].map((minutes) => (
                      <option key={minutes} value={minutes}>
                        {minutes} 分钟
                      </option>
                    ))}
                  </select>
                </label>
                <label className="setting-row">
                  <div>
                    <b>新日程默认提醒</b>
                    <p>提前提醒时间可在每条日程中单独调整</p>
                  </div>
                  <select
                    aria-label="新日程默认提醒"
                    value={snapshot.settings.defaultReminder}
                    onChange={(e) =>
                      void configure({
                        defaultReminder: Number(e.target.value),
                      })
                    }
                  >
                    <option value={-1}>不提醒</option>
                    <option value={0}>日程开始时</option>
                    {[5, 10, 15, 30, 60].map((minutes) => (
                      <option key={minutes} value={minutes}>
                        提前 {minutes} 分钟
                      </option>
                    ))}
                  </select>
                </label>
                <label className="setting-row">
                  <div>
                    <b>外观</b>
                    <p>选择适合工作环境的主题</p>
                  </div>
                  <select
                    aria-label="外观"
                    value={snapshot.settings.theme}
                    onChange={(e) =>
                      void configure({
                        theme: e.target.value as "light" | "dark" | "system",
                      })
                    }
                  >
                    <option value="light">浅色</option>
                    <option value="dark">深色</option>
                    <option value="system">跟随系统</option>
                  </select>
                </label>
                <label className="setting-row">
                  <div>
                    <b>自动同步</b>
                    <p>应用运行期间定期同步，托盘后台运行时也会继续</p>
                  </div>
                  <input
                    type="checkbox"
                    checked={snapshot.settings.autoSync}
                    onChange={(e) =>
                      void configure({ autoSync: e.target.checked })
                    }
                  />
                </label>
                <label className="setting-row">
                  <div>
                    <b>同步间隔</b>
                  </div>
                  <select
                    value={snapshot.settings.syncMinutes}
                    onChange={(e) =>
                      void configure({ syncMinutes: Number(e.target.value) })
                    }
                  >
                    {[1, 5, 10, 15, 30, 60].map((number) => (
                      <option key={number} value={number}>
                        {number} 分钟
                      </option>
                    ))}
                  </select>
                </label>
                <label className="setting-row">
                  <div>
                    <b>桌面提醒</b>
                    <p>应用运行期间发送 Windows 通知，托盘状态下也可提醒</p>
                  </div>
                  <input
                    type="checkbox"
                    checked={snapshot.settings.reminders}
                    onChange={(e) =>
                      void configure({ reminders: e.target.checked })
                    }
                  />
                </label>
                <div className="setting-row">
                  <div>
                    <b>导出日程</b>
                    <p>将本地日程和已缓存的订阅导出为 ICS 文件</p>
                  </div>
                  <button
                    className="secondary"
                    onClick={() =>
                      void perform(async () => {
                        const file = await window.calendar.exportCalendar();
                        if (file) setNotice(`已导出到 ${file}`);
                      })
                    }
                  >
                    <Download size={15} />
                    导出
                  </button>
                </div>
                <div className="shortcut-guide">
                  <CaptureSettings
                    snapshot={snapshot}
                    configure={configure}
                    update={update}
                  />
                  <h4>键盘快捷键</h4>
                  <p>
                    <kbd>N</kbd>新建日程 <kbd>T</kbd>回到今天 <kbd>Ctrl K</kbd>
                    搜索日程 <kbd>Esc</kbd>关闭弹窗
                  </p>
                </div>
              </>
            )}
            {tab === "display" && (
              <>
                <h3>日历显示</h3>
                <label className="setting-row">
                  <div>
                    <b>每周起始日</b>
                    <p>同时应用到主日历、迷你月历和教学周</p>
                  </div>
                  <select
                    aria-label="每周起始日"
                    value={snapshot.settings.weekStartsOn}
                    onChange={(e) =>
                      void configure({
                        weekStartsOn: Number(e.target.value) as 0 | 1 | 6,
                      })
                    }
                  >
                    <option value={1}>星期一</option>
                    <option value={0}>星期日</option>
                    <option value={6}>星期六</option>
                  </select>
                </label>
                <label className="setting-row">
                  <div>
                    <b>时间格式</b>
                    <p>应用到日历时间轴、日程列表和搜索结果</p>
                  </div>
                  <select
                    aria-label="时间格式"
                    value={snapshot.settings.hour12 ? "12" : "24"}
                    onChange={(e) =>
                      void configure({ hour12: e.target.value === "12" })
                    }
                  >
                    <option value="24">24 小时制</option>
                    <option value="12">12 小时制</option>
                  </select>
                </label>
                <div className="setting-row">
                  <div>
                    <b>日历显示时段</b>
                    <p>日、三日和周视图的时间轴范围</p>
                  </div>
                  <div className="time-range-settings">
                    <select
                      aria-label="显示开始时间"
                      value={snapshot.settings.dayStartHour}
                      onChange={(e) =>
                        void configure({ dayStartHour: Number(e.target.value) })
                      }
                    >
                      {Array.from(
                        { length: snapshot.settings.dayEndHour },
                        (_, hour) => (
                          <option key={hour} value={hour}>
                            {hourTime(hour)}
                          </option>
                        ),
                      )}
                    </select>
                    <span>至</span>
                    <select
                      aria-label="显示结束时间"
                      value={snapshot.settings.dayEndHour}
                      onChange={(e) =>
                        void configure({ dayEndHour: Number(e.target.value) })
                      }
                    >
                      {Array.from(
                        { length: 24 - snapshot.settings.dayStartHour },
                        (_, index) =>
                          snapshot.settings.dayStartHour + index + 1,
                      ).map((hour) => (
                        <option key={hour} value={hour}>
                          {hourTime(hour)}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <label className="setting-row">
                  <div>
                    <b>显示周末</b>
                  </div>
                  <input
                    type="checkbox"
                    aria-label="显示周末"
                    checked={snapshot.settings.weekends}
                    onChange={(e) =>
                      void configure({ weekends: e.target.checked })
                    }
                  />
                </label>
              </>
            )}
            {tab === "teaching" && (
              <form
                className="teaching-settings"
                onSubmit={(event) => {
                  event.preventDefault();
                  void perform(async () => {
                    update(
                      await window.calendar.settings({
                        teachingStartDate: teachingDate,
                        teachingWeeks: Number(teachingCount),
                      }),
                    );
                    setNotice("教学周设置已保存");
                  });
                }}
              >
                <h3>教学周</h3>
                <p className="muted-text">
                  所选日期所在周记为第 1
                  周，按照“每周起始日”划分。月历会逐周显示编号。
                </p>
                <label className="setting-row">
                  <div>
                    <b>第一教学周的日期</b>
                    <p>选择第一周内任意一天，留空可关闭教学周显示</p>
                  </div>
                  <input
                    type="date"
                    aria-label="第一教学周的日期"
                    value={teachingDate}
                    onChange={(e) => setTeachingDate(e.target.value)}
                  />
                </label>
                <label className="setting-row">
                  <div>
                    <b>教学周总数</b>
                    <p>超出设定范围的日期留空</p>
                  </div>
                  <input
                    type="number"
                    aria-label="教学周总数"
                    min={1}
                    max={104}
                    required
                    value={teachingCount}
                    onChange={(e) => setTeachingCount(e.target.value)}
                  />
                </label>
                <div className="form-actions">
                  <button type="submit" className="primary" disabled={busy}>
                    保存教学周设置
                  </button>
                </div>
              </form>
            )}
            {tab === "sync" && (
              <>
                <h3>同步记录</h3>
                <p className="muted-text">
                  {snapshot.lastSync
                    ? `最近成功同步于 ${new Date(snapshot.lastSync).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}`
                    : "连接日历后，成功同步时间会显示在这里。"}
                </p>
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={() => void perform(onSync)}
                >
                  <RefreshCw size={15} />
                  立即同步 / 重试
                </button>
                {snapshot.syncError && (
                  <div className="sync-error">
                    <AlertCircle size={18} />
                    <p>{snapshot.syncError}</p>
                  </div>
                )}
                {!pendingCount && (
                  <div className="queue-empty">
                    <CheckCircle2 size={30} />
                    <p>所有修改已保存在本地</p>
                    <small>当前没有等待写回云端的日程</small>
                  </div>
                )}
                {snapshot.connections
                  .filter((item) => item.teachingConflict)
                  .map((item) => (
                    <article className="queue-item" key={`teaching-${item.id}`}>
                      <b>{item.name} · 教学周配置冲突</b>
                      <div className="conflict-comparison">
                        <div>
                          <b>本机配置</b>
                          <p>
                            {snapshot.settings.teachingStartDate || "未启用"} ·{" "}
                            {snapshot.settings.teachingWeeks} 周
                          </p>
                        </div>
                        <div>
                          <b>云端配置</b>
                          <p>
                            {item.teachingConflict!.teachingStartDate ||
                              "未启用"}{" "}
                            · {item.teachingConflict!.teachingWeeks} 周
                          </p>
                        </div>
                      </div>
                      <div className="form-actions">
                        {(["remote", "local"] as const).map((choice) => (
                          <button
                            key={choice}
                            className="secondary"
                            disabled={busy}
                            onClick={() =>
                              void perform(async () => {
                                update(
                                  await window.calendar.resolveTeachingConflict(
                                    item.id,
                                    choice,
                                  ),
                                );
                                await onSync();
                              })
                            }
                          >
                            {choice === "remote"
                              ? "使用云端教学周"
                              : "使用本机教学周"}
                          </button>
                        ))}
                      </div>
                    </article>
                  ))}
                {snapshot.queue.map((change) => {
                  const event = snapshot.events.find(
                    (item) => item.id === change.eventId,
                  );
                  return (
                    <article className="queue-item" key={change.id}>
                      <b>{event?.title || "日程"}</b>
                      <small>
                        {
                          { create: "新建", update: "修改", delete: "删除" }[
                            change.action
                          ]
                        }{" "}
                        ·{" "}
                        {
                          {
                            pending: "待同步",
                            error: "同步失败",
                            conflict: "版本冲突",
                          }[change.status]
                        }
                      </small>
                      {change.error && (
                        <p className="error-text">{change.error}</p>
                      )}
                      {change.remote && (
                        <>
                          <div className="conflict-comparison">
                            <div>
                              <b>本地版本</b>
                              <p>{event?.title}</p>
                              <small>{event?.start}</small>
                            </div>
                            <div>
                              <b>云端版本</b>
                              <p>
                                {change.remote.deleted
                                  ? "已删除"
                                  : change.remote.title}
                              </p>
                              <small>{change.remote.start}</small>
                            </div>
                          </div>
                          <div className="form-actions">
                            <button
                              className="secondary"
                              disabled={busy}
                              onClick={() =>
                                void perform(async () =>
                                  update(
                                    await window.calendar.resolveConflict(
                                      change.id,
                                      "remote",
                                    ),
                                  ),
                                )
                              }
                            >
                              采用云端版本
                            </button>
                            <button
                              className="primary"
                              disabled={busy}
                              onClick={() =>
                                void perform(async () => {
                                  update(
                                    await window.calendar.resolveConflict(
                                      change.id,
                                      "local",
                                    ),
                                  );
                                  await onSync();
                                })
                              }
                            >
                              保留本地并同步
                            </button>
                          </div>
                        </>
                      )}
                    </article>
                  );
                })}
              </>
            )}
            {error && (
              <p className="error-text" role="alert">
                {error}
              </p>
            )}
            {notice && (
              <p className="success-text" role="status">
                {notice}
              </p>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
