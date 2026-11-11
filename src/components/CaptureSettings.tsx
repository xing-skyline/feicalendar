import { useState } from "react";
import type { AppSnapshot, Settings } from "../shared/types";

export default function CaptureSettings({
  snapshot,
  configure,
  update,
}: {
  snapshot: AppSnapshot;
  configure: (patch: Partial<Settings>) => Promise<void>;
  update: (state: AppSnapshot) => void;
}) {
  const [shortcut, setShortcut] = useState(snapshot.settings.captureShortcut);
  const [error, setError] = useState("");
  return (
    <section className="capture-settings">
      <h4>全局快捷录入</h4>
      <label>
        快捷键
        <input
          aria-label="全局录入快捷键"
          value={shortcut}
          placeholder="CommandOrControl+Alt+N"
          onChange={(event) => setShortcut(event.target.value)}
        />
      </label>
      <small>
        支持 Ctrl、Alt、Shift 与字母组合，用 + 连接。清空后停用全局快捷键。
      </small>
      <button
        className="secondary"
        onClick={() => void configure({ captureShortcut: shortcut.trim() })}
      >
        保存快捷键
      </button>
      {!!snapshot.templates?.length && (
        <>
          <h4>日程模板</h4>
          {snapshot.templates.map((template) => (
            <div className="setting-row" key={template.id}>
              <span>{template.name}</span>
              <button
                className="text-button"
                onClick={() =>
                  void window.calendar
                    .deleteTemplate(template.id)
                    .then(update)
                    .catch((error: Error) => setError(error.message))
                }
              >
                删除模板
              </button>
            </div>
          ))}
        </>
      )}
      {error && <p className="error-text">{error}</p>}
    </section>
  );
}
