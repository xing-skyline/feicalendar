import { useState } from "react";
import type { AppSnapshot, OAuthInput } from "../shared/types";

export default function OAuthConnections({
  snapshot,
  update,
  onSync,
}: {
  snapshot: AppSnapshot;
  update: (state: AppSnapshot) => void;
  onSync: () => Promise<void>;
}) {
  const [input, setInput] = useState<OAuthInput>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [removing, setRemoving] = useState("");
  const perform = async (operation: () => Promise<void>) => {
    setError("");
    setBusy(true);
    try {
      await operation();
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section>
      <h3>Google 与 Microsoft 日历</h3>
      <p className="muted-text">
        使用系统浏览器授权，多账号可同时连接。访问令牌会自动刷新，账号撤销授权或组织策略变化后需要重新连接。
      </p>
      <div className="connection-actions">
        {(["google", "microsoft"] as const).map((kind) => (
          <button
            key={kind}
            className="secondary"
            disabled={busy}
            onClick={() =>
              setInput({
                id: "",
                name: kind === "google" ? "Google Calendar" : "Microsoft 365",
                kind,
                clientId: "",
                clientSecret: "",
                tenant: "common",
              })
            }
          >
            添加 {kind === "google" ? "Google" : "Microsoft"} 账号
          </button>
        ))}
      </div>
      {(snapshot.connections || [])
        .filter((connection) =>
          ["google", "microsoft"].includes(connection.kind),
        )
        .map((connection) => (
          <article className="reminder-card" key={connection.id}>
            <strong>{connection.name}</strong>
            <small>
              {connection.username} ·{" "}
              {connection.enabled === false
                ? "已暂停"
                : connection.error ||
                  (connection.lastSync ? "已同步" : "待同步")}
            </small>
            <div className="connection-actions">
              <label className="inline-check">
                <input
                  type="checkbox"
                  checked={connection.enabled !== false}
                  disabled={busy}
                  onChange={(event) =>
                    void perform(async () =>
                      update(
                        await window.calendar.saveConnection({
                          ...connection,
                          enabled: event.target.checked,
                        }),
                      ),
                    )
                  }
                />
                启用
              </label>
              <label className="inline-check">
                <input
                  type="checkbox"
                  checked={Boolean(connection.readOnly)}
                  disabled={busy}
                  onChange={(event) => {
                    const readOnly = event.target.checked;
                    void perform(async () =>
                      update(
                        await window.calendar.saveConnection({
                          ...connection,
                          readOnly,
                        }),
                      ),
                    );
                  }}
                />
                只读
              </label>
              <button
                disabled={busy}
                onClick={() =>
                  setInput({
                    id: connection.id,
                    kind: connection.kind as OAuthInput["kind"],
                    name: connection.name,
                    clientId: connection.oauthClientId || "",
                    clientSecret: "",
                    tenant: connection.oauthTenant || "common",
                  })
                }
              >
                重新授权
              </button>
              <button
                className="text-button danger"
                disabled={busy}
                onClick={() => setRemoving(connection.id)}
              >
                移除
              </button>
            </div>
            {removing === connection.id && (
              <div className="inline-confirm">
                <span>移除账号在本机的连接和缓存？</span>
                <button
                  disabled={busy}
                  onClick={() =>
                    void perform(async () => {
                      update(
                        await window.calendar.removeConnection(connection.id),
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
          </article>
        ))}
      {input && (
        <form
          className="stacked-form course-form"
          onSubmit={(event) => {
            event.preventDefault();
            void perform(async () => {
              update(await window.calendar.oauthConnect(input));
              setInput(undefined);
              await onSync();
            });
          }}
        >
          <h4>
            {input.kind === "google"
              ? "Google 桌面应用授权"
              : "Microsoft 桌面应用授权"}
          </h4>
          <p className="muted-text">
            当前使用自行注册的 OAuth 应用。
            {input.kind === "google"
              ? "在 Google Cloud 启用 Calendar API，创建“桌面应用”OAuth 客户端，并将账号加入测试用户或完成应用发布。"
              : "在 Microsoft Entra 注册支持个人或组织账号的应用，添加“移动和桌面应用”平台，将重定向 URI 设为 http://localhost。"}
          </p>
          <button
            type="button"
            className="text-button"
            onClick={() =>
              void window.calendar
                .openExternal(
                  input.kind === "google"
                    ? "https://console.cloud.google.com/apis/credentials"
                    : "https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade",
                )
                .catch((error: Error) => setError(error.message))
            }
          >
            打开应用注册页面
          </button>
          <label>
            连接名称
            <input
              required
              value={input.name}
              disabled={busy}
              onChange={(event) =>
                setInput({ ...input, name: event.target.value })
              }
            />
          </label>
          <label>
            Client ID
            <input
              required
              value={input.clientId}
              disabled={busy}
              autoComplete="off"
              onChange={(event) =>
                setInput({ ...input, clientId: event.target.value })
              }
            />
          </label>
          {input.kind === "google" ? (
            <label>
              Client Secret
              <input
                type="password"
                value={input.clientSecret}
                placeholder={
                  input.id
                    ? "留空使用已保存的应用配置"
                    : "Google 桌面应用的客户端密钥"
                }
                disabled={busy}
                autoComplete="off"
                onChange={(event) =>
                  setInput({ ...input, clientSecret: event.target.value })
                }
              />
            </label>
          ) : (
            <label>
              租户
              <input
                value={input.tenant}
                required
                disabled={busy}
                onChange={(event) =>
                  setInput({ ...input, tenant: event.target.value })
                }
              />
              <small>通用账号填写 common，组织账号也可填写租户 ID。</small>
            </label>
          )}
          <div className="connection-actions">
            <button type="submit" className="primary" disabled={busy}>
              {busy ? "等待浏览器授权…" : "打开浏览器授权"}
            </button>
            <button
              type="button"
              onClick={() => {
                if (busy) void window.calendar.oauthCancel();
                else setInput(undefined);
              }}
            >
              {busy ? "取消授权" : "关闭"}
            </button>
          </div>
        </form>
      )}
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
