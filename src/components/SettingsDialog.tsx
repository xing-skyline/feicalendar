import { useEffect, useState } from "react";
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
} from "lucide-react";
import type {
  AppSnapshot,
  AuthChallenge,
  AuthStatus,
  Connection,
} from "../shared/types";

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
  const [auth, setAuth] = useState<AuthStatus>();
  const [challenge, setChallenge] = useState<AuthChallenge>();
  const [connection, setConnection] = useState<Connection>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [removing, setRemoving] = useState("");
  const [appId, setAppId] = useState("");
  const [appSecret, setAppSecret] = useState("");
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
              {snapshot.queue.length > 0 && (
                <span className="count">{snapshot.queue.length}</span>
              )}
            </button>
            <div className="settings-version">FeiCalendar 0.1.0</div>
          </nav>
          <div className="settings-content">
            {tab === "connections" && (
              <>
                <h3>让日程保持同步</h3>
                <p className="muted-text">
                  连接飞书账号，随时查看和安排你的日程。
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
                  <h3>订阅日历</h3>
                  <button
                    className="text-button"
                    onClick={() =>
                      setConnection({
                        id: "",
                        name: "飞书订阅",
                        kind: "caldav",
                        url: "https://caldav.feishu.cn",
                        username: "",
                        password: "",
                      })
                    }
                  >
                    <Plus size={16} />
                    添加订阅
                  </button>
                </div>
                <p className="muted-text">
                  在飞书“设置 → 日历 → CalDAV
                  同步配置”获取服务器、用户名和密码。CalDAV 和 ICS
                  订阅支持单向读取，写回日程需连接上方飞书账号。
                </p>
                {snapshot.connections.map((item) => (
                  <div className="subscription-row" key={item.id}>
                    <Link2 size={18} />
                    <div>
                      <b>{item.name}</b>
                      <small>
                        {item.kind.toUpperCase()} ·{" "}
                        {item.error
                          ? "连接失败"
                          : item.lastSync
                            ? "已同步"
                            : "待同步"}
                      </small>
                    </div>
                    <button
                      className="text-button"
                      onClick={() => setConnection(item)}
                    >
                      编辑
                    </button>
                    <button
                      className="icon-button danger"
                      title="移除订阅"
                      onClick={() => setRemoving(item.id)}
                    >
                      <Trash2 size={16} />
                    </button>
                    {removing === item.id && (
                      <div className="inline-confirm">
                        移除订阅及其本地缓存？
                        <button
                          onClick={() =>
                            void perform(async () => {
                              update(
                                await window.calendar.removeConnection(item.id),
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
                    <div className="form-two">
                      <label>
                        订阅方式
                        <select
                          aria-label="订阅方式"
                          value={connection.kind}
                          onChange={(e) =>
                            setConnection({
                              ...connection,
                              kind: e.target.value as "caldav" | "ics",
                            })
                          }
                        >
                          <option value="caldav">CalDAV 账号</option>
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
                      {connection.kind === "caldav" ? "服务器地址" : "订阅链接"}
                      <input
                        aria-label="订阅地址"
                        required
                        value={connection.url}
                        onChange={(e) =>
                          setConnection({ ...connection, url: e.target.value })
                        }
                        placeholder="https://"
                      />
                    </label>
                    {connection.kind === "caldav" && (
                      <div className="form-two">
                        <label>
                          用户名
                          <input
                            aria-label="CalDAV 用户名"
                            required
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
                            aria-label="CalDAV 密码"
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
                    <small>订阅凭据使用 Windows 本地加密保存。</small>
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
                    <p>应用打开时定期同步日程</p>
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
                    <b>显示周末</b>
                  </div>
                  <input
                    type="checkbox"
                    checked={snapshot.settings.weekends}
                    onChange={(e) =>
                      void configure({ weekends: e.target.checked })
                    }
                  />
                </label>
                <label className="setting-row">
                  <div>
                    <b>桌面提醒</b>
                    <p>应用打开时发送 Windows 日程通知</p>
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
                  <h4>键盘快捷键</h4>
                  <p>
                    <kbd>N</kbd>新建日程 <kbd>T</kbd>回到今天 <kbd>Ctrl K</kbd>
                    搜索日程 <kbd>Esc</kbd>关闭窗口
                  </p>
                </div>
              </>
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
                {!snapshot.queue.length && (
                  <div className="queue-empty">
                    <CheckCircle2 size={30} />
                    <p>所有修改已保存在本地</p>
                    <small>当前没有等待写回飞书的日程</small>
                  </div>
                )}
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
                              <b>飞书版本</b>
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
                              采用飞书版本
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
