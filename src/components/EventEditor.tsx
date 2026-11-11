import { useMemo, useState } from "react";
import {
  X,
  CalendarDays,
  Clock3,
  MapPin,
  AlignLeft,
  Repeat2,
  Bell,
  Trash2,
  ExternalLink,
  Check,
  Copy,
} from "lucide-react";
import type {
  CalendarEvent,
  CalendarSource,
  EventSave,
  EventTemplate,
  AppSnapshot,
} from "../shared/types";
import { templateDraft } from "../shared/capture";
import { meetingLink } from "../shared/meetings";
import { dateKey, inputTime, shiftDate } from "../shared/dates";
import { eventConflicts } from "../shared/availability";

export default function EventEditor({
  initial,
  calendars,
  defaultDurationMinutes,
  onSave,
  onDelete,
  onClose,
  onDuplicate,
  templates = [],
  localReminderMinutes,
  context,
}: {
  initial: CalendarEvent;
  calendars: CalendarSource[];
  defaultDurationMinutes: number;
  onSave: (input: EventSave) => Promise<void>;
  onDelete: (id: string, scope?: "single" | "all") => Promise<void>;
  onClose: () => void;
  onDuplicate: (event: CalendarEvent) => void;
  templates?: EventTemplate[];
  localReminderMinutes?: number[];
  context?: AppSnapshot;
}) {
  const [event, setEvent] = useState(initial);
  const conflicts = useMemo(
    () =>
      context
        ? eventConflicts(context, {
            ...initial,
            id: event.id,
            seriesId: event.seriesId,
            start: event.start,
            end: event.end,
            allDay: event.allDay,
            calendarId: event.calendarId,
          })
        : [],
    [
      context,
      initial,
      event.id,
      event.seriesId,
      event.start,
      event.end,
      event.allDay,
      event.calendarId,
    ],
  );
  const [scope, setScope] = useState<"single" | "all" | "">("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [templateName, setTemplateName] = useState("");
  const [templateForm, setTemplateForm] = useState(false);
  const [templateNotice, setTemplateNotice] = useState("");
  const [localRule, setLocalRule] = useState<number[] | undefined>(
    localReminderMinutes,
  );
  const [reminderNotice, setReminderNotice] = useState("");
  const meeting = meetingLink(event);
  const calendar = calendars.find((item) => item.id === event.calendarId);
  const readOnly = !calendar?.writable;
  const remoteOccurrence = Boolean(
    event.remoteId && calendar?.provider !== "webdav",
  );
  const existing = Boolean(initial.id);
  const repeated = Boolean(
    existing && (initial.recurrence || initial.recurring),
  );
  const patch = (value: Partial<CalendarEvent>) =>
    setEvent((previous) => ({ ...previous, ...value }));
  const perform = async (operation: () => Promise<void>) => {
    if (repeated && !scope) {
      setError("请先选择重复日程的修改范围");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await operation();
      onClose();
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
  const changeAllDay = (allDay: boolean) => {
    patch({
      allDay,
      start: allDay ? dateKey(event.start) : `${event.start}T09:00:00+08:00`,
      end: allDay
        ? shiftDate(dateKey(event.end), 1)
        : new Date(
            new Date(`${shiftDate(event.end, -1)}T09:00:00+08:00`).getTime() +
              defaultDurationMinutes * 60_000,
          ).toISOString(),
    });
  };

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <form
        className="event-editor modal"
        role="dialog"
        aria-modal="true"
        aria-label={existing ? "日程详情" : "新建日程"}
        onSubmit={(e) => {
          e.preventDefault();
          void perform(() =>
            onSave({
              event,
              scope: scope || undefined,
              localReminders: localRule,
            }),
          );
        }}
      >
        <header className="modal-heading">
          <span>
            <span
              className="color-dot"
              style={{ background: calendar?.color }}
            />
            {existing ? "日程详情" : "新建日程"}
          </span>
          <button
            className="icon-button"
            type="button"
            aria-label="关闭日程"
            onClick={onClose}
          >
            <X size={19} />
          </button>
        </header>
        {!existing && templates.length > 0 && (
          <div className="template-controls">
            <select
              aria-label="日程模板"
              value=""
              onChange={(change) => {
                const template = templates.find(
                  (item) => item.id === change.target.value,
                );
                if (template) setEvent(templateDraft(template, event));
              }}
            >
              <option value="">使用常用模板</option>
              {templates
                .filter((item) =>
                  calendars.some(
                    (calendar) =>
                      calendar.id === item.calendarId && calendar.writable,
                  ),
                )
                .map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
            </select>
          </div>
        )}
        <input
          className="event-title-input"
          aria-label="日程标题"
          placeholder="准备做些什么？"
          autoFocus
          value={event.title}
          readOnly={readOnly}
          required
          maxLength={1000}
          onChange={(e) => patch({ title: e.target.value })}
        />
        {conflicts.length > 0 && (
          <details className="conflict-notice">
            <summary>与 {conflicts.length} 项日程或缓冲时间重叠</summary>
            {conflicts.map((item) => (
              <p key={item.id}>
                {item.title} · {inputTime(item.start).replace("T", " ")}
              </p>
            ))}
          </details>
        )}
        <label className="editor-row">
          <CalendarDays size={18} />
          <span>所属日历</span>
          <select
            aria-label="所属日历"
            value={event.calendarId}
            disabled={existing || readOnly}
            onChange={(e) => patch({ calendarId: e.target.value })}
          >
            {calendars
              .filter((item) => item.writable || item.id === event.calendarId)
              .map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                  {item.provider === "feishu" ? " · 飞书" : ""}
                </option>
              ))}
          </select>
        </label>
        <div className="editor-time">
          <Clock3 size={18} />
          <div>
            <label className="toggle-row">
              全天日程
              <input
                type="checkbox"
                checked={event.allDay}
                disabled={readOnly}
                onChange={(e) => changeAllDay(e.target.checked)}
              />
            </label>
            <div className="time-inputs">
              <label>
                开始
                <input
                  aria-label="开始时间"
                  type={event.allDay ? "date" : "datetime-local"}
                  required
                  disabled={readOnly}
                  value={event.allDay ? event.start : inputTime(event.start)}
                  onChange={(e) =>
                    patch({
                      start: event.allDay
                        ? e.target.value
                        : `${e.target.value}:00+08:00`,
                    })
                  }
                />
              </label>
              <label>
                结束
                <input
                  aria-label="结束时间"
                  type={event.allDay ? "date" : "datetime-local"}
                  required
                  disabled={readOnly}
                  value={
                    event.allDay
                      ? shiftDate(event.end, -1)
                      : inputTime(event.end)
                  }
                  onChange={(e) =>
                    patch({
                      end: event.allDay
                        ? shiftDate(e.target.value, 1)
                        : `${e.target.value}:00+08:00`,
                    })
                  }
                />
              </label>
            </div>
            <small>北京时间 · UTC+08:00</small>
          </div>
        </div>
        <label className="editor-row">
          <Repeat2 size={18} />
          <span>重复</span>
          <select
            aria-label="重复规则"
            disabled={readOnly || remoteOccurrence}
            value={event.recurrence}
            onChange={(e) => patch({ recurrence: e.target.value })}
          >
            <option value="">
              {remoteOccurrence && event.recurring ? "远程重复日程" : "不重复"}
            </option>
            <option value="FREQ=DAILY">每天</option>
            <option value="FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR">每个工作日</option>
            <option value="FREQ=WEEKLY">每周</option>
            <option value="FREQ=MONTHLY">每月</option>
            <option value="FREQ=YEARLY">每年</option>
          </select>
        </label>
        {repeated && !readOnly && (
          <fieldset className="scope">
            <legend>本次修改范围</legend>
            {(event.seriesId || event.remoteId) && (
              <label>
                <input
                  type="radio"
                  name="scope"
                  value="single"
                  checked={scope === "single"}
                  onChange={() => setScope("single")}
                />
                仅此次日程
              </label>
            )}
            {!remoteOccurrence && (
              <label>
                <input
                  type="radio"
                  name="scope"
                  value="all"
                  checked={scope === "all"}
                  onChange={() => setScope("all")}
                />
                整个重复系列
              </label>
            )}
            {remoteOccurrence && <small>整个系列可在来源日历中管理。</small>}
          </fieldset>
        )}
        <label className="editor-row">
          <Bell size={18} />
          <span>提醒</span>
          <select
            aria-label="提醒时间"
            value={event.reminder}
            disabled={
              readOnly ||
              Boolean(event.remoteId && calendar?.provider === "feishu")
            }
            onChange={(e) => patch({ reminder: Number(e.target.value) })}
          >
            <option value={-1}>
              {event.remoteId && calendar?.provider === "feishu"
                ? "由飞书管理"
                : "不提醒"}
            </option>
            <option value={0}>日程开始时</option>
            <option value={5}>提前 5 分钟</option>
            <option value={10}>提前 10 分钟</option>
            <option value={15}>提前 15 分钟</option>
            <option value={30}>提前 30 分钟</option>
            <option value={60}>提前 1 小时</option>
          </select>
        </label>
        <label className="editor-row">
          <MapPin size={18} />
          <input
            placeholder="添加地点"
            aria-label="地点"
            value={event.location}
            readOnly={readOnly}
            onChange={(e) => patch({ location: e.target.value })}
          />
        </label>
        <details className="local-reminders">
          <summary>本机多次提醒</summary>
          <label className="toggle-row">
            <input
              type="checkbox"
              checked={localRule !== undefined}
              onChange={(change) =>
                setLocalRule(change.target.checked ? [10] : undefined)
              }
            />
            使用自定义本机提醒
          </label>
          {localRule !== undefined && (
            <div className="reminder-options">
              {[0, 5, 10, 15, 30, 60, 1440].map((minutes) => (
                <label key={minutes}>
                  <input
                    type="checkbox"
                    checked={localRule.includes(minutes)}
                    onChange={(change) =>
                      setLocalRule(
                        change.target.checked
                          ? [...localRule, minutes]
                          : localRule.filter((value) => value !== minutes),
                      )
                    }
                  />
                  {minutes === 0
                    ? "开始时"
                    : minutes === 1440
                      ? "提前一天"
                      : `提前 ${minutes} 分钟`}
                </label>
              ))}
            </div>
          )}
          <small>
            适用于当前电脑，也可用于只读订阅。全天提醒时间在提醒中心设置。
          </small>
          {existing && (
            <button
              type="button"
              className="secondary"
              onClick={() =>
                void window.calendar
                  .reminderRule(event.id, localRule ?? null)
                  .then(() => setReminderNotice("本机提醒已保存"))
                  .catch((error: Error) => setError(error.message))
              }
            >
              保存本机提醒
            </button>
          )}
          {reminderNotice && <p role="status">{reminderNotice}</p>}
        </details>
        <label className="editor-notes">
          <AlignLeft size={18} />
          <textarea
            placeholder="添加日程描述…"
            aria-label="日程描述"
            value={event.description}
            readOnly={readOnly}
            onChange={(e) => patch({ description: e.target.value })}
            rows={4}
          />
        </label>
        {existing && !readOnly && (
          <label className="completed-toggle">
            <input
              type="checkbox"
              checked={event.completed}
              onChange={(e) => patch({ completed: e.target.checked })}
            />
            {calendar?.provider === "webdav"
              ? "标记完成"
              : "标记完成（仅本机）"}
          </label>
        )}
        {readOnly && (
          <p className="info-text">
            此日程为只读，可在来源设置中管理，也可以复制到可写入的日历后编辑。
          </p>
        )}
        {event.error && <p className="error-text">{event.error}</p>}
        {templateForm && (
          <div className="template-controls">
            <input
              aria-label="模板名称"
              placeholder="模板名称"
              value={templateName}
              maxLength={100}
              onChange={(change) => setTemplateName(change.target.value)}
            />
            <button
              type="button"
              className="secondary"
              disabled={busy || !templateName.trim() || !event.title.trim()}
              onClick={() => {
                setBusy(true);
                void window.calendar
                  .saveTemplate({
                    id: "",
                    name: templateName,
                    title: event.title,
                    calendarId: event.calendarId,
                    durationMinutes: Math.round(
                      (new Date(event.end).getTime() -
                        new Date(event.start).getTime()) /
                        60_000,
                    ),
                    allDay: event.allDay,
                    location: event.location,
                    description: event.description,
                    reminder: event.reminder,
                    recurrence: event.recurrence,
                  })
                  .then(() => {
                    setTemplateForm(false);
                    setTemplateNotice(
                      "已保存模板，可在新建日程和快捷录入中使用",
                    );
                  })
                  .catch((error: Error) => setError(error.message))
                  .finally(() => setBusy(false));
              }}
            >
              保存模板
            </button>
          </div>
        )}
        {templateNotice && <p role="status">{templateNotice}</p>}
        {error && (
          <p className="error-text" role="alert">
            {error}
          </p>
        )}
        {confirmDelete && (
          <div className="delete-confirm">
            <p>
              确认删除“{event.title}”？
              {calendar?.provider !== "local" &&
                "这项修改将同步到所属云端日历。"}
            </p>
            <button
              type="button"
              className="danger-button"
              disabled={busy}
              onClick={() =>
                void perform(() => onDelete(event.id, scope || undefined))
              }
            >
              确认删除
            </button>
            <button type="button" onClick={() => setConfirmDelete(false)}>
              保留日程
            </button>
          </div>
        )}
        <footer className="editor-footer">
          <div>
            {!readOnly && (
              <button
                type="button"
                className="text-button"
                onClick={() => {
                  setTemplateName(event.title);
                  setTemplateForm(!templateForm);
                }}
              >
                存为模板
              </button>
            )}
            {meeting && (
              <button
                type="button"
                className="text-button"
                onClick={() => void window.calendar.openExternal(meeting)}
              >
                加入会议
              </button>
            )}
            {existing && !readOnly && (
              <button
                type="button"
                title="删除日程"
                className="icon-button danger"
                onClick={() => setConfirmDelete(true)}
              >
                <Trash2 size={18} />
              </button>
            )}
            {existing && (
              <button
                type="button"
                title="复制日程"
                className="icon-button"
                onClick={() => onDuplicate(event)}
              >
                <Copy size={18} />
              </button>
            )}
            {event.url && (
              <button
                type="button"
                className="text-button"
                onClick={() => void window.calendar.openExternal(event.url!)}
              >
                在飞书中打开
                <ExternalLink size={14} />
              </button>
            )}
          </div>
          <div>
            <button type="button" className="secondary" onClick={onClose}>
              关闭
            </button>
            {!readOnly && (
              <button className="primary" type="submit" disabled={busy}>
                <Check size={16} />
                {busy ? "保存中…" : "保存日程"}
              </button>
            )}
          </div>
        </footer>
      </form>
    </div>
  );
}
