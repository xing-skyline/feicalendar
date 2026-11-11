import { useEffect, useState } from "react";
import type {
  AppSnapshot,
  BackupSummary,
  BackupPreview,
} from "../shared/types";
import { inputTime } from "../shared/dates";

export default function RecoverySettings({
  snapshot,
  update,
}: {
  snapshot: AppSnapshot;
  update: (snapshot: AppSnapshot) => void;
}) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [backups, setBackups] = useState<BackupSummary[]>([]);
  const [selected, setSelected] = useState("");
  const [password, setPassword] = useState("");
  const [notice, setNotice] = useState("");
  const [includeCloud, setIncludeCloud] = useState(false);
  const [deleteMissing, setDeleteMissing] = useState(false);
  const [preview, setPreview] = useState<BackupPreview>();
  useEffect(() => {
    void window.calendar
      .backupList()
      .then(setBackups)
      .catch((error: Error) => setError(error.message));
  }, []);
  const perform = async (operation: () => Promise<void>) => {
    setBusy(true);
    setError("");
    setNotice("");
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
      <h3>回收站与恢复</h3>
      <p className="muted-text">
        删除的日程保留 30
        天。相关日程没有后续修改时恢复原记录，否则恢复为副本。云端日历的恢复会进入同步队列。
      </p>
      {!(snapshot.trash || []).length && <p>回收站为空。</p>}
      {(snapshot.trash || [])
        .slice()
        .reverse()
        .map((entry) => (
          <article className="reminder-card" key={entry.id}>
            <strong>{entry.event.title}</strong>
            <small>
              {inputTime(entry.event.start).replace("T", " ")} · 删除于{" "}
              {inputTime(entry.deletedAt).replace("T", " ")}
            </small>
            <button
              className="secondary"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                setError("");
                void window.calendar
                  .restoreTrash(entry.id)
                  .then(update)
                  .catch((error: Error) => setError(error.message))
                  .finally(() => setBusy(false));
              }}
            >
              恢复日程
            </button>
          </article>
        ))}
      {error && <p className="error-text">{error}</p>}
      <h3>备份</h3>
      <p className="muted-text">
        每天首次保存时生成快照，保留最近 30
        个备份日。恢复预览会列出新增、修改和删除的日程。连接凭据在各设备上单独配置。
      </p>
      {snapshot.backupError && (
        <p className="error-text">{snapshot.backupError}</p>
      )}
      <label>
        备份密码
        <input
          type="password"
          aria-label="备份密码"
          value={password}
          autoComplete="new-password"
          minLength={8}
          onChange={(event) => setPassword(event.target.value)}
          placeholder="至少 8 个字符"
        />
      </label>
      <div className="connection-actions">
        <button
          className="secondary"
          disabled={busy || password.length < 8}
          onClick={() =>
            void perform(async () => {
              const file = await window.calendar.backupExport(password);
              if (file) {
                setPassword("");
                setNotice(`已导出加密备份到 ${file}`);
              }
            })
          }
        >
          导出加密备份
        </button>
        <button
          className="secondary"
          disabled={busy || password.length < 8}
          onClick={() =>
            void perform(async () => {
              const backup = await window.calendar.backupImport(password);
              if (backup) {
                setPassword("");
                setBackups((items) => [
                  ...items.filter((item) => !item.id.startsWith("import-")),
                  backup,
                ]);
                setSelected(backup.id);
                setPreview(undefined);
              }
            })
          }
        >
          导入加密备份
        </button>
      </div>
      <label>
        选择恢复快照
        <select
          aria-label="选择恢复快照"
          value={selected}
          onChange={(event) => {
            setSelected(event.target.value);
            setPreview(undefined);
          }}
        >
          <option value="">选择备份</option>
          {backups.map((backup) => (
            <option key={backup.id} value={backup.id}>
              {backup.name} · {backup.events} 条日程
            </option>
          ))}
        </select>
      </label>
      <label className="toggle-row">
        <input
          type="checkbox"
          checked={includeCloud}
          onChange={(event) => {
            setIncludeCloud(event.target.checked);
            setPreview(undefined);
          }}
        />
        包含已连接的可写云端日历
      </label>
      <label className="toggle-row">
        <input
          type="checkbox"
          checked={deleteMissing}
          onChange={(event) => {
            setDeleteMissing(event.target.checked);
            setPreview(undefined);
          }}
        />
        删除当前日历中备份未包含的日程
      </label>
      <button
        className="secondary"
        disabled={!selected || busy}
        onClick={() =>
          void perform(async () =>
            setPreview(
              await window.calendar.backupPreview(selected, {
                includeCloud,
                deleteMissing,
              }),
            ),
          )
        }
      >
        预览恢复差异
      </button>
      {preview && (
        <div className="restore-preview">
          <h4>将处理 {preview.changes.length} 项</h4>
          <p>跳过 {preview.skipped} 条未选中的云端、只读或未连接日历记录。</p>
          <div className="restore-change-list">
            {preview.changes.map((change, index) => (
              <p key={index}>
                {
                  { create: "新增", update: "修改", delete: "删除" }[
                    change.action
                  ]
                }{" "}
                · {change.title} · {inputTime(change.start).replace("T", " ")} ·{" "}
                {change.calendar}
                {change.cloud ? "（将写回云端）" : ""}
              </p>
            ))}
          </div>
          <button
            className="primary"
            disabled={busy || !preview.changes.length}
            onClick={() =>
              void perform(async () => {
                update(await window.calendar.backupRestore(preview.token));
                setPreview(undefined);
                setNotice("恢复已保存，云端修改将按同步设置处理");
              })
            }
          >
            确认恢复这些日程
          </button>
        </div>
      )}
      {notice && <p role="status">{notice}</p>}
    </section>
  );
}
