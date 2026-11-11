import { useEffect, useState } from "react";
import { Plus, X, Zap } from "lucide-react";
import type { AppSnapshot, CalendarEvent } from "../shared/types";
import { eventDraft, parseCapture, templateDraft } from "../shared/capture";
import { inputTime } from "../shared/dates";

export default function QuickCapture() {
  const [snapshot, setSnapshot] = useState<AppSnapshot>();
  const [draft, setDraft] = useState<CalendarEvent>();
  const [input, setInput] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void window.calendar.snapshot().then((state) => {
      setSnapshot(state);
      setDraft(eventDraft(state));
    });
    const unsubscribe = window.calendar.onChanged(setSnapshot);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") void window.calendar.quickCapture("close");
    };
    window.addEventListener("keydown", onKey);
    return () => {
      unsubscribe();
      window.removeEventListener("keydown", onKey);
    };
  }, []);
  const patch = (value: Partial<CalendarEvent>) =>
    setDraft((previous) => previous && { ...previous, ...value });
  if (!snapshot || !draft)
    return <main className="loading">正在打开快捷录入…</main>;
  return (
    <main className="quick-capture">
      <header className="capture-heading">
        <h2>
          <Zap size={19} /> 快捷录入
        </h2>
        <button
          className="icon-button"
          aria-label="关闭快捷录入"
          onClick={() => void window.calendar.quickCapture("close")}
        >
          <X size={19} />
        </button>
      </header>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          try {
            setDraft(parseCapture(input, draft));
            setError("");
          } catch (error) {
            setError((error as Error).message);
          }
        }}
      >
        <label>
          一句话安排日程
          <input
            autoFocus
            aria-label="一句话安排日程"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="下周三下午两点开组会，持续一小时"
            maxLength={2000}
          />
        </label>
        <button type="submit" className="secondary">
          识别时间
        </button>
      </form>
      {!!snapshot.templates?.length && (
        <label>
          使用模板
          <select
            aria-label="快捷录入模板"
            value=""
            onChange={(event) => {
              const template = snapshot.templates?.find(
                (item) => item.id === event.target.value,
              );
              if (template) setDraft(templateDraft(template, draft));
            }}
          >
            <option value="">选择常用日程</option>
            {snapshot.templates
              .filter((template) =>
                snapshot.calendars.some(
                  (calendar) =>
                    calendar.id === template.calendarId && calendar.writable,
                ),
              )
              .map((template) => (
                <option key={template.id} value={template.id}>
                  {template.name}
                </option>
              ))}
          </select>
        </label>
      )}
      <form
        className="capture-details"
        onSubmit={(event) => {
          event.preventDefault();
          setBusy(true);
          setError("");
          void window.calendar
            .saveEvent({ event: draft })
            .then(async (state) => {
              setDraft(eventDraft(state));
              setInput("");
              await window.calendar.quickCapture("close");
            })
            .catch((error: Error) => setError(error.message))
            .finally(() => setBusy(false));
        }}
      >
        <label>
          标题
          <input
            aria-label="快捷日程标题"
            value={draft.title}
            required
            maxLength={1000}
            onChange={(event) => patch({ title: event.target.value })}
          />
        </label>
        <div className="time-inputs">
          <label>
            开始
            <input
              aria-label="快捷开始时间"
              type={draft.allDay ? "date" : "datetime-local"}
              value={draft.allDay ? draft.start : inputTime(draft.start)}
              required
              onChange={(event) =>
                patch({
                  start: draft.allDay
                    ? event.target.value
                    : `${event.target.value}:00+08:00`,
                })
              }
            />
          </label>
          <label>
            结束
            <input
              aria-label="快捷结束时间"
              type={draft.allDay ? "date" : "datetime-local"}
              value={draft.allDay ? draft.end : inputTime(draft.end)}
              required
              onChange={(event) =>
                patch({
                  end: draft.allDay
                    ? event.target.value
                    : `${event.target.value}:00+08:00`,
                })
              }
            />
          </label>
        </div>
        {draft.allDay && <small>全天日程的结束日期为不包含的下一天。</small>}
        <label>
          所属日历
          <select
            aria-label="快捷所属日历"
            value={draft.calendarId}
            onChange={(event) => patch({ calendarId: event.target.value })}
          >
            {snapshot.calendars
              .filter((calendar) => calendar.writable)
              .map((calendar) => (
                <option value={calendar.id} key={calendar.id}>
                  {calendar.name}
                </option>
              ))}
          </select>
        </label>
        <label>
          地点
          <input
            aria-label="快捷地点"
            value={draft.location}
            onChange={(event) => patch({ location: event.target.value })}
          />
        </label>
        {error && (
          <p className="error-text" role="alert">
            {error}
          </p>
        )}
        <footer className="form-actions">
          <button type="submit" className="primary" disabled={busy}>
            <Plus size={16} />
            {busy ? "保存中…" : "添加日程"}
          </button>
        </footer>
      </form>
    </main>
  );
}
